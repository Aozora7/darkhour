import type { SleepRecord } from "../api/types";
import type { RawSleepRecordV12 } from "../api/fitbitTypes";
import type { GoogleHealthSleepDataPoint, GoogleHealthSleepPage } from "../api/googlehealth/types";
import { parseGoogleHealthDataPoint, parseGoogleHealthDataPoints } from "../api/googlehealth/parse";
import {
    explicitOffsetMinutes,
    hostOffsetAt,
    resolveWallOffset,
    toInstant,
    type OffsetMinutes,
} from "../utils/zonedTime";
import { calculateSleepScore } from "../models/calculateSleepScore";

/**
 * Recover the zone a legacy v1.2 timestamp was written in.
 *
 * Fitbit v1.2 `startTime`/`endTime` carry a real zone designator, so the offset
 * is recoverable. Zone-less values return `undefined` for the caller to handle.
 */
function legacyOffset(timestamp: string | undefined): OffsetMinutes | undefined {
    return timestamp ? explicitOffsetMinutes(timestamp) : undefined;
}

function parseV12Record(raw: RawSleepRecordV12): SleepRecord {
    const startOffset = legacyOffset(raw.startTime) ?? resolveWallOffset(raw.startTime);
    const endOffset = legacyOffset(raw.endTime) ?? startOffset;

    const record: SleepRecord = {
        logId: typeof raw.logId === "number" ? raw.logId : Number(raw.logId),
        dateOfSleep: raw.dateOfSleep,
        startTime: toInstant(raw.startTime, startOffset),
        endTime: toInstant(raw.endTime, endOffset),
        startTimeOffsetMinutes: startOffset,
        endTimeOffsetMinutes: endOffset,
        durationMs: raw.duration,
        durationHours: raw.duration / 3_600_000,
        efficiency: raw.efficiency,
        minutesAsleep: raw.minutesAsleep,
        minutesAwake: raw.minutesAwake,
        isMainSleep: raw.isMainSleep,
    };

    if (raw.levels) {
        // v1.2 "stages" type has deep/light/rem/wake summary;
        // v1.2 "classic" type has asleep/restless/awake instead — no stage data
        const s = raw.levels.summary;
        if (s && "deep" in s && s.deep && "light" in s && s.light && "rem" in s && s.rem && "wake" in s && s.wake) {
            record.stages = {
                deep: s.deep.minutes,
                light: s.light.minutes,
                rem: s.rem.minutes,
                wake: s.wake.minutes,
            };
        }
        if (raw.levels.data) {
            record.stageData = raw.levels.data;
        }
    }

    record.sleepScore = calculateSleepScore(record);

    return record;
}

/**
 * Re-hydrate a record from our own export format (SleepRecord serialized to JSON).
 * startTime/endTime are ISO strings that need to become Date objects.
 *
 * Exports written before offset tracking carry no zone metadata. `Date#toJSON`
 * already wrote an unambiguous *instant*, so the recorded wall clock is simply
 * unrecoverable — we adopt the browser's zone, which is exactly the frame those
 * files were interpreted in before. Nothing shifts, and `dateOfSleep` is kept
 * verbatim so day-based grouping and filtering stay identical.
 */
function parseExportedRecord(raw: Record<string, unknown>): SleepRecord {
    const startTime = new Date(raw.startTime as string);
    const endTime = new Date(raw.endTime as string);

    // DST-aware host offset for the record's own date, matching the frame these
    // files were originally interpreted in.
    const startOffset = (raw.startTimeOffsetMinutes as OffsetMinutes | undefined) ?? hostOffsetAt(startTime.getTime());
    const rawEndOffset = raw.endTimeOffsetMinutes as OffsetMinutes | undefined;
    const endOffset = rawEndOffset ?? startOffset;

    return {
        logId: raw.logId as number,
        dateOfSleep: raw.dateOfSleep as string,
        startTime,
        endTime,
        startTimeOffsetMinutes: startOffset,
        endTimeOffsetMinutes: endOffset,
        durationMs: raw.durationMs as number,
        durationHours: raw.durationHours as number,
        efficiency: raw.efficiency as number,
        minutesAsleep: raw.minutesAsleep as number,
        minutesAwake: raw.minutesAwake as number,
        isMainSleep: (raw.isMainSleep as boolean) ?? true,
        sleepScore: (raw.sleepScore as number) ?? 0,
        stages: raw.stages as SleepRecord["stages"],
        stageData: raw.stageData as SleepRecord["stageData"],
    };
}

/**
 * Detect whether a raw record is our internal export or v1.2 format and parse accordingly.
 */
function parseAnyRecord(raw: Record<string, unknown>): SleepRecord {
    // Our own exported format uses "durationMs" instead of "duration"
    if ("durationMs" in raw) {
        return parseExportedRecord(raw);
    }
    if ("levels" in raw || "type" in raw) {
        return parseV12Record(raw as unknown as RawSleepRecordV12);
    }
    // Google Health data points: `list` responses carry `name`, `reconcile`
    // responses carry `dataPointName`, and both have a `sleep` object.
    if ("sleep" in raw && ("name" in raw || "dataPointName" in raw)) {
        return parseGoogleHealthDataPoint(raw as unknown as GoogleHealthSleepDataPoint);
    }
    throw new Error("Unrecognized sleep record format: expected v1.2 (stages) data");
}

/**
 * Parse sleep data from a JSON-parsed value. Handles multiple formats:
 * - v1.2 single-page: { sleep: [...], pagination: {...} }
 * - v1.2 multi-page: [ { sleep: [...], pagination: {...} }, ... ]
 * - Flat array of records: [ { dateOfSleep, ... }, ... ]
 *
 * Pure function — no browser APIs required.
 */
export function parseSleepData(data: unknown): SleepRecord[] {
    let allRecords: SleepRecord[] = [];

    if (Array.isArray(data)) {
        if (data.length === 0) return [];

        const first = data[0] as Record<string, unknown>;
        if ("dataPoints" in first) {
            // Array of Google Health pages
            const dataPoints = data.flatMap((page) => (page as unknown as GoogleHealthSleepPage).dataPoints ?? []);
            allRecords = parseGoogleHealthDataPoints(dataPoints as GoogleHealthSleepDataPoint[]);
        } else if (
            "sleep" in first &&
            !Array.isArray(first.sleep) &&
            typeof first.sleep === "object" &&
            "interval" in (first.sleep as Record<string, unknown>)
        ) {
            // Array of GoogleHealthSleepDataPoint
            allRecords = parseGoogleHealthDataPoints(data as GoogleHealthSleepDataPoint[]);
        } else if ("sleep" in first && Array.isArray(first.sleep)) {
            // Array of Fitbit pages
            const rawRecords = data.flatMap(
                (page: Record<string, unknown>) => (page.sleep as Record<string, unknown>[]) ?? []
            );
            allRecords = rawRecords.map(parseAnyRecord);
        } else {
            // Flat array of records
            allRecords = data.map((x) => parseAnyRecord(x as Record<string, unknown>));
        }
    } else if (typeof data === "object" && data !== null) {
        const obj = data as Record<string, unknown>;
        if ("dataPoints" in obj) {
            // Single Google Health page
            allRecords = parseGoogleHealthDataPoints((obj.dataPoints as GoogleHealthSleepDataPoint[]) ?? []);
        } else if ("sleep" in obj && Array.isArray(obj.sleep)) {
            // Single Fitbit page
            const rawRecords = obj.sleep as Record<string, unknown>[];
            allRecords = rawRecords.map(parseAnyRecord);
        } else {
            throw new Error("Unrecognized sleep data format");
        }
    } else {
        throw new Error("Unrecognized sleep data format");
    }

    // Sort by start time ascending (oldest first)
    allRecords.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

    // Deduplicate by logId
    const seen = new Set<number>();
    return allRecords.filter((r) => {
        if (seen.has(r.logId)) return false;
        seen.add(r.logId);
        return true;
    });
}

/**
 * Load sleep data from a local JSON file via fetch, then parse.
 */
export async function loadLocalData(url: string): Promise<SleepRecord[]> {
    const response = await fetch(url);
    const data: unknown = await response.json();
    return parseSleepData(data);
}
