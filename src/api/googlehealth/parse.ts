import type { SleepLevelEntry, SleepRecord, SleepStageLevel, SleepStages } from "../types";
import type { GoogleHealthSleepDataPoint, GoogleHealthSleepStage } from "./types";

function formatLocalDate(d: Date): string {
    return (
        d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0")
    );
}

function parseStageLevel(type: string): SleepStageLevel {
    if (type === "LIGHT") return "light";
    if (type === "DEEP") return "deep";
    if (type === "REM") return "rem";
    return "wake";
}

function buildStageData(stages: GoogleHealthSleepStage[] | undefined): SleepLevelEntry[] {
    if (!stages || stages.length === 0) return [];
    return stages
        .map((s) => {
            const start = new Date(s.startTime).getTime();
            const end = new Date(s.endTime).getTime();
            const seconds = Math.max(0, Math.round((end - start) / 1000));
            return {
                dateTime: s.startTime,
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
    const parts = dataPoint.name ? dataPoint.name.split("/") : [];
    const last = parts[parts.length - 1] ?? "";
    const parsed = Number(last);
    return Number.isFinite(parsed) ? parsed : startTime.getTime();
}

export function parseGoogleHealthDataPoints(dataPoints: GoogleHealthSleepDataPoint[]): SleepRecord[] {
    return dataPoints.map((dp) => {
        return parseGoogleHealthDataPoint(dp);
    });
}
export function parseGoogleHealthDataPoint(dp: GoogleHealthSleepDataPoint): SleepRecord {
    const start = dp.sleep?.interval?.startTime ? new Date(dp.sleep.interval.startTime) : new Date(0);
    const end = dp.sleep?.interval?.endTime ? new Date(dp.sleep.interval.endTime) : new Date(0);
    const durationMs = Math.max(0, end.getTime() - start.getTime());

    const minutesAsleep = Number.parseInt(dp.sleep?.summary?.minutesAsleep ?? "0", 10) || 0;
    const minutesAwake = Number.parseInt(dp.sleep?.summary?.minutesAwake ?? "0", 10) || 0;

    const record: SleepRecord = {
        logId: deriveLogId(dp, start),
        dateOfSleep: formatLocalDate(start),
        startTime: start,
        endTime: end,
        durationMs,
        durationHours: durationMs / 3600000,
        // Google Health doesn't provide an efficiency score; approximate.
        efficiency: durationMs > 0
            ? Math.max(0, Math.min(100, Math.round((minutesAsleep * 60000 * 100) / durationMs)))
            : 0,
        minutesAsleep,
        minutesAwake,
        isMainSleep: dp.sleep?.isMainSleep ?? true,
        sleepScore: 0,
    };

    const stages = buildStagesSummary(dp);
    if (stages) record.stages = stages;

    record.stageData = buildStageData(dp.sleep?.stages);

    return record;
}

