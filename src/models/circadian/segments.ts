// Segment splitting for data with gaps (algorithm-agnostic)
import type { SleepRecord } from "../../api/types";
import { GAP_THRESHOLD_DAYS } from "./types";
import { MS_PER_DAY, hostOffsetAt, zonedDayStartMs } from "../../utils/zonedTime";

/** Instant of the record's own local midnight. */
function dayStartMs(record: SleepRecord): number {
    return zonedDayStartMs(
        record.dateOfSleep,
        record.startTimeOffsetMinutes ?? hostOffsetAt(record.startTime.getTime())
    );
}

export function splitIntoSegments(records: SleepRecord[]): SleepRecord[][] {
    if (records.length === 0) return [];
    const sorted = [...records].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    const segments: SleepRecord[][] = [[sorted[0]!]];
    let latestDateMs = dayStartMs(sorted[0]!);

    for (let i = 1; i < sorted.length; i++) {
        const currDateMs = dayStartMs(sorted[i]!);
        const gapDays = Math.round((currDateMs - latestDateMs) / MS_PER_DAY);
        if (gapDays > GAP_THRESHOLD_DAYS) {
            segments.push([sorted[i]!]);
        } else {
            segments[segments.length - 1]!.push(sorted[i]!);
        }
        latestDateMs = Math.max(latestDateMs, currDateMs);
    }
    return segments;
}
