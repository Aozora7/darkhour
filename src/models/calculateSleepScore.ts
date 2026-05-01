import type { SleepRecord } from "../api/types";

export function calculateSleepScore(record: SleepRecord): number {
    // Regression weights derived from fitting to a dataset of Fitbit sleep records with known quality scores.
    const INTERCEPT = 66.60654843292923;
    const W_DURATION = 9.071460795887447;
    const W_DEEP_PLUS_REM = 0.1110083920616658;
    const W_WAKE_PCT = -102.526819077646;

    const asleepHours = record.minutesAsleep / 60;

    // Feature 1: Piecewise duration score (0-1)
    // Ramps from 0→0.5 for 0-4h, 0.5→1.0 for 4-7h, plateau at 7-9h, decline 9-12h
    let durationScore;
    if (asleepHours < 4) {
        durationScore = (asleepHours / 4) * 0.5;
    } else if (asleepHours < 7) {
        durationScore = 0.5 + ((asleepHours - 4) / 3) * 0.5;
    } else if (asleepHours <= 9) {
        durationScore = 1.0;
    } else if (asleepHours < 12) {
        durationScore = 1.0 - (asleepHours - 9) / 3;
    } else {
        durationScore = 0;
    }

    // Feature 2: Deep + REM minutes
    let deepPlusRemMinutes;
    if (record.stages) {
        deepPlusRemMinutes = record.stages.deep + record.stages.rem;
    } else {
        // Classic records: estimate deep ~17% and REM ~22% of asleep time
        deepPlusRemMinutes = record.minutesAsleep * 0.39;
    }

    // Feature 3: Wake percentage (wake minutes / time in bed)
    const timeInBed = record.durationMs / 60000;
    let wakePct;
    if (record.stages) {
        wakePct = timeInBed > 0 ? record.stages.wake / timeInBed : 0;
    } else {
        // Fallback for missing stage data
        wakePct = timeInBed > 0 ? record.minutesAwake / timeInBed : 0.15;
    }

    // Linear combination
    const raw = INTERCEPT + W_DURATION * durationScore + W_DEEP_PLUS_REM * deepPlusRemMinutes + W_WAKE_PCT * wakePct;

    return Math.round(Math.max(0, Math.min(100, raw))) / 100;
}
