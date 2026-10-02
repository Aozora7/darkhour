import type { SleepRecord } from "../api/types";
import {
    addDaysToDateStr,
    MS_PER_DAY,
    MS_PER_HOUR,
    referenceOffset,
    zonedDateStr,
    zonedDateTimeStr,
    zonedDayStartMs,
} from "../utils/zonedTime";

/** A single sleep block positioned within a row's time window */
export interface SleepBlock {
    /** Fractional hour start within the row (0 to rowWidth) */
    startHour: number;
    /** Fractional hour end within the row (0 to rowWidth) */
    endHour: number;
    /** Absolute instant the block starts, for sub-hour-accurate stage rendering */
    startMs: number;
    /** Absolute instant the block ends */
    endMs: number;
    /** Original record reference (carries stageData) */
    record: SleepRecord;
}

/** One row in the actogram */
export interface ActogramRow {
    /** Label string — "YYYY-MM-DD" for calendar mode, "YYYY-MM-DD HH:mm" for tau mode */
    date: string;
    /** Sleep blocks clipped to this row's time window */
    blocks: SleepBlock[];
    /** Absolute start time of this row in ms */
    startMs: number;
}

/**
 * Build actogram row data from sleep records.
 * Each calendar day in the range gets a row with any overlapping sleep blocks
 * clipped to the [0, 24) hour window of that day.
 *
 * Days are delimited in the dataset's own reference offset (see
 * `referenceOffset`), not the viewer's, so the actogram looks identical wherever
 * it is opened and travel periods don't appear as phase jumps. A fixed offset
 * also makes every day exactly 24 h, which removes the DST skew the previous
 * local-midnight arithmetic was subject to.
 *
 * @param extraDays - Number of empty forecast days to append after the data range
 * @param sortDirection - "newest" for newest-first (default), "oldest" for oldest-first
 */
export function buildActogramRows(
    records: SleepRecord[],
    extraDays = 0,
    sortDirection: "newest" | "oldest" = "newest"
): ActogramRow[] {
    if (records.length === 0) return [];

    const offset = referenceOffset(records);
    const first = records[0]!;
    const last = records[records.length - 1]!;
    // Generate all calendar days in the reference frame, plus forecast days
    const rows: ActogramRow[] = [];
    const firstDay = zonedDateStr(first.startTime.getTime(), offset);
    const totalDays =
        Math.round(
            (zonedDayStartMs(zonedDateStr(last.endTime.getTime(), offset), offset) -
                zonedDayStartMs(firstDay, offset)) /
                MS_PER_DAY
        ) + 1;

    for (let i = 0; i < totalDays + extraDays; i++) {
        const date = addDaysToDateStr(firstDay, i);
        rows.push({ date, blocks: [], startMs: zonedDayStartMs(date, offset) });
    }

    // Map date string to row index for fast lookup
    const dateIndex = new Map<string, number>();
    rows.forEach((row, i) => dateIndex.set(row.date, i));

    // Place each sleep record into overlapping day rows
    const originMs = rows[0]!.startMs;
    for (const record of records) {
        const sleepStart = record.startTime.getTime();
        const sleepEnd = record.endTime.getTime();

        // Rows are uniformly spaced from `originMs`, so the overlapping range is
        // a direct division. `sleepEnd - 1` keeps a block that ends exactly at
        // midnight off the following day.
        const firstRow = Math.max(0, Math.floor((sleepStart - originMs) / MS_PER_DAY));
        const lastRow = Math.min(rows.length - 1, Math.floor((sleepEnd - 1 - originMs) / MS_PER_DAY));

        for (let i = firstRow; i <= lastRow; i++) {
            const dayMidnight = rows[i]!.startMs;
            const blockStart = Math.max(sleepStart, dayMidnight);
            const blockEnd = Math.min(sleepEnd, dayMidnight + MS_PER_DAY);

            if (blockEnd > blockStart) {
                rows[i]!.blocks.push({
                    startHour: (blockStart - dayMidnight) / MS_PER_HOUR,
                    endHour: (blockEnd - dayMidnight) / MS_PER_HOUR,
                    startMs: blockStart,
                    endMs: blockEnd,
                    record,
                });
            }
        }
    }

    // Apply sort direction
    if (sortDirection === "newest") rows.reverse();

    return rows;
}

/**
 * Build actogram rows with a custom row width (tau) in hours.
 * Each row spans `tau` hours, starting from the first record's midnight in the
 * dataset's reference offset.
 * When tau=24 the result is equivalent to buildActogramRows (but row 0
 * starts at the first record's midnight rather than calendar-day aligned).
 *
 * @param sortDirection - "newest" for newest-first (default), "oldest" for oldest-first
 */
export function buildTauRows(
    records: SleepRecord[],
    tau: number,
    extraDays = 0,
    sortDirection: "newest" | "oldest" = "newest"
): ActogramRow[] {
    if (records.length === 0) return [];

    const offset = referenceOffset(records);
    const tauMs = tau * MS_PER_HOUR;

    // Start from midnight of the first record's day, in the reference frame
    const originMs = zonedDayStartMs(zonedDateStr(records[0]!.startTime.getTime(), offset), offset);
    const lastDate = records[records.length - 1]!.endTime;
    const lastMs = lastDate.getTime() + extraDays * MS_PER_DAY;

    const rowCount = Math.ceil((lastMs - originMs) / tauMs);
    const rows: ActogramRow[] = [];

    for (let i = 0; i < rowCount; i++) {
        const rowStartMs = originMs + i * tauMs;
        const dateStr = zonedDateStr(rowStartMs, offset);
        // Only append time if the row doesn't start at midnight
        const label = rowStartMs === zonedDayStartMs(dateStr, offset) ? dateStr : zonedDateTimeStr(rowStartMs, offset);

        rows.push({ date: label, blocks: [], startMs: rowStartMs });
    }

    // Place each sleep record into overlapping rows
    for (const record of records) {
        const sleepStartMs = record.startTime.getTime();
        const sleepEndMs = record.endTime.getTime();

        // Find the first row that could overlap
        const firstRow = Math.max(0, Math.floor((sleepStartMs - originMs) / tauMs));
        const lastRow = Math.min(rows.length - 1, Math.floor((sleepEndMs - originMs) / tauMs));

        for (let i = firstRow; i <= lastRow; i++) {
            const rowStartMs = originMs + i * tauMs;
            const rowEndMs = rowStartMs + tauMs;

            const blockStartMs = Math.max(sleepStartMs, rowStartMs);
            const blockEndMs = Math.min(sleepEndMs, rowEndMs);

            if (blockEndMs > blockStartMs) {
                rows[i]!.blocks.push({
                    startHour: (blockStartMs - rowStartMs) / MS_PER_HOUR,
                    endHour: (blockEndMs - rowStartMs) / MS_PER_HOUR,
                    startMs: blockStartMs,
                    endMs: blockEndMs,
                    record,
                });
            }
        }
    }

    // Apply sort direction
    if (sortDirection === "newest") rows.reverse();

    return rows;
}
