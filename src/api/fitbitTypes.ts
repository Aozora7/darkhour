// ─── Legacy sleep record format (v1.2 stages/classic) ──────────────

export type SleepStageLevel = "wake" | "light" | "deep" | "rem";

export interface SleepLevelEntry {
    dateTime: string; // ISO datetime
    level: SleepStageLevel;
    seconds: number;
}

export interface SleepStageSummaryEntry {
    count: number;
    minutes: number;
    thirtyDayAvgMinutes: number;
}

export interface SleepStageSummary {
    deep: SleepStageSummaryEntry;
    light: SleepStageSummaryEntry;
    rem: SleepStageSummaryEntry;
    wake: SleepStageSummaryEntry;
}

export interface SleepLevels {
    data: SleepLevelEntry[];
    shortData: SleepLevelEntry[];
    summary: SleepStageSummary;
}

export interface RawSleepRecordV12 {
    dateOfSleep: string;
    duration: number;
    efficiency: number;
    startTime: string;
    endTime: string;
    infoCode: number;
    isMainSleep: boolean;
    levels: SleepLevels;
    logId: number;
    logType: string;
    minutesAfterWakeup: number;
    minutesAsleep: number;
    minutesAwake: number;
    minutesToFallAsleep: number;
    timeInBed: number;
    type: "stages" | "classic";
}
