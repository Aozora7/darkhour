import type { SleepLevelEntry, SleepRecord, SleepStageLevel, SleepStages } from "../types";
import type { GoogleHealthSleepDataPoint, GoogleHealthSleepStage } from "./types";
import { dataPointId } from "./types";
import {
    browserOffsetMinutes,
    parseUtcOffset,
    resolveWallOffset,
    toInstant,
    zonedDateStr,
    type OffsetMinutes,
} from "../../utils/zonedTime";

/**
 * Resolve the zone an interval was recorded in.
 *
 * The API normally supplies both offsets, but `endUtcOffset` is occasionally
 * missing, so we fall back to the start offset and finally to the browser zone.
 */
function resolveOffsets(interval: GoogleHealthSleepDataPoint["sleep"]["interval"]): {
    start: OffsetMinutes;
    end: OffsetMinutes;
} {
    const start =
        parseUtcOffset(interval?.startUtcOffset) ??
        (interval?.startTime ? resolveWallOffset(interval.startTime) : browserOffsetMinutes());
    const end = parseUtcOffset(interval?.endUtcOffset) ?? start;
    return { start, end };
}

function parseStageLevel(type: string): SleepStageLevel {
    if (type === "LIGHT") return "light";
    if (type === "DEEP") return "deep";
    if (type === "REM") return "rem";
    return "wake";
}

function buildStageData(
    stages: GoogleHealthSleepStage[] | undefined,
    fallbackOffset: OffsetMinutes
): SleepLevelEntry[] {
    if (!stages || stages.length === 0) return [];
    return stages
        .map((s) => {
            const offset = parseUtcOffset(s.startUtcOffset) ?? fallbackOffset;
            // Normalise to an absolute instant so downstream rendering never has
            // to guess which zone a zone-less wall-clock string belongs to.
            const startMs = toInstant(s.startTime, offset).getTime();
            const endMs = toInstant(s.endTime, parseUtcOffset(s.endUtcOffset) ?? offset).getTime();
            const seconds = Math.max(0, Math.round((endMs - startMs) / 1000));
            return {
                dateTime: new Date(startMs).toISOString(),
                level: parseStageLevel(s.type),
                seconds,
            };
        })
        .filter((x) => x.seconds > 0);
}

function buildStagesSummary(dataPoint: GoogleHealthSleepDataPoint): SleepStages | undefined {
    const summary = dataPoint.sleep?.summary?.stagesSummary;
    if (!summary || summary.length === 0) return undefined;

    const getMins = (type: string) => {
        const entry = summary.find((x) => x.type === type);
        return entry ? Number.parseInt(entry.minutes, 10) || 0 : 0;
    };

    const deep = getMins("DEEP");
    const light = getMins("LIGHT");
    const rem = getMins("REM");
    const wake = getMins("AWAKE") + getMins("OUT_OF_BED");

    if (deep + light + rem + wake === 0) return undefined;
    return { deep, light, rem, wake };
}

function deriveLogId(dataPoint: GoogleHealthSleepDataPoint, startTime: Date): number {
    // `reconcile` identifies records via `dataPointName`, `list` via `name`.
    const id = dataPointId(dataPoint);
    if (!id) return startTime.getTime();

    const last = id.split("/").pop() ?? "";
    // Guard against `Number("")` === 0, which would collapse every id-less
    // record onto logId 0 and silently drop all but one of them.
    const parsed = Number(last);
    return last !== "" && Number.isFinite(parsed) && Number.isSafeInteger(parsed) ? parsed : startTime.getTime();
}

export function parseGoogleHealthDataPoints(dataPoints: GoogleHealthSleepDataPoint[]): SleepRecord[] {
    return dataPoints.map((dp) => {
        return parseGoogleHealthDataPoint(dp);
    });
}
export function parseGoogleHealthDataPoint(dp: GoogleHealthSleepDataPoint): SleepRecord {
    const interval = dp.sleep?.interval;
    const { start: startOffset, end: endOffset } = resolveOffsets(interval);

    // Wall-clock + recorded offset -> absolute instant. This is the step that was
    // previously missing: `new Date(startTime)` silently used the browser's zone.
    const start = interval?.startTime ? toInstant(interval.startTime, startOffset) : new Date(0);
    const end = interval?.endTime ? toInstant(interval.endTime, endOffset) : new Date(0);
    const durationMs = Math.max(0, end.getTime() - start.getTime());

    const minutesAsleep = Number.parseInt(dp.sleep?.summary?.minutesAsleep ?? "0", 10) || 0;
    const minutesAwake = Number.parseInt(dp.sleep?.summary?.minutesAwake ?? "0", 10) || 0;

    const record: SleepRecord = {
        logId: deriveLogId(dp, start),
        dateOfSleep: zonedDateStr(start.getTime(), startOffset),
        startTime: start,
        endTime: end,
        startTimeOffsetMinutes: startOffset,
        endTimeOffsetMinutes: endOffset,
        durationMs,
        durationHours: durationMs / 3600000,
        // Google Health doesn't provide an efficiency score; approximate.
        efficiency:
            durationMs > 0 ? Math.max(0, Math.min(100, Math.round((minutesAsleep * 60000 * 100) / durationMs))) : 0,
        minutesAsleep,
        minutesAwake,
        // The REST reference names this `metadata.mainSleep`; the Endpoints guide's
        // sample payload uses `main`. The legacy top-level `isMainSleep` is not
        // populated by the live API at all.
        isMainSleep: dp.sleep?.metadata?.mainSleep ?? dp.sleep?.metadata?.main ?? dp.sleep?.isMainSleep ?? true,
        sleepScore: 0,
    };

    const stages = buildStagesSummary(dp);
    if (stages) record.stages = stages;

    record.stageData = buildStageData(dp.sleep?.stages, startOffset);

    return record;
}
