import type { SleepLevelEntry, SleepStageLevel } from "./fitbitTypes";

export type { SleepLevelEntry, SleepStageLevel };

// ─── Unified internal types ────────────────────────────────────────

export interface SleepStages {
    deep: number; // minutes
    light: number;
    rem: number;
    wake: number;
}

/**
 * Processed sleep record used throughout the app.
 *
 * `startTime`/`endTime` are absolute instants. The zone each one was *recorded*
 * in is kept alongside them, because the actogram and the circadian models need
 * the subject's own wall clock (their local midnight) — not the viewer's — to
 * place a sleep episode on a day and to measure phase.
 */
export interface SleepRecord {
    logId: number;
    /** Calendar day of sleep onset, in `startTimeOffsetMinutes`. */
    dateOfSleep: string;
    startTime: Date;
    endTime: Date;
    /**
     * Minutes east of UTC of the zone `startTime` was recorded in (UTC+8 is
     * `480`). Falls back to the browser's zone for legacy data that predates
     * offset tracking, which preserves that data's original placement.
     */
    startTimeOffsetMinutes: number;
    /**
     * As above for `endTime`. Differs from `startTimeOffsetMinutes` only when a
     * sleep episode spans a DST change or a flight.
     */
    endTimeOffsetMinutes: number;
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
