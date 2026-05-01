import type { SleepLevelEntry, SleepStageLevel } from "./fitbitTypes";

export type { SleepLevelEntry, SleepStageLevel };

// ─── Unified internal types ────────────────────────────────────────

export interface SleepStages {
    deep: number; // minutes
    light: number;
    rem: number;
    wake: number;
}

/** Processed sleep record used throughout the app */
export interface SleepRecord {
    logId: number;
    dateOfSleep: string;
    startTime: Date;
    endTime: Date;
    durationMs: number;
    durationHours: number;
    efficiency: number;
    minutesAsleep: number;
    minutesAwake: number;
    isMainSleep: boolean;
    sleepScore?: number;

    /** v1.2 stage summary (present when original type === "stages") */
    stages?: SleepStages;
    /** v1.2 per-interval stage data for rendering (present when original has levels) */
    stageData?: SleepLevelEntry[];
}
