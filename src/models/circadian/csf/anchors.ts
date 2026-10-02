import type { CSFAnchor } from "./types";
import type { SleepRecord } from "../../../api/types";
import { MS_PER_DAY, hostOffsetAt, zonedDayStartMs } from "../../../utils/zonedTime";

export function computeAnchorWeight(record: SleepRecord): number | null {
    const quality = record.sleepScore || 0;
    const dur = record.durationHours;

    const durFactor = Math.min(1, Math.max(0, (dur - 4) / 3));
    const weight = quality * durFactor;

    if (weight < 0.05) return null;

    return record.isMainSleep ? weight : weight * 0.15;
}

export function sleepMidpointHour(record: SleepRecord, firstDateMs: number): number {
    const midMs = record.startTime.getTime() + record.durationMs / 2;
    return (midMs - firstDateMs) / 3_600_000;
}

export function prepareAnchors(records: SleepRecord[], globalFirstDateMs: number): CSFAnchor[] {
    const candidates: { record: SleepRecord; weight: number }[] = [];

    for (const record of records) {
        const weight = computeAnchorWeight(record);
        if (weight === null) continue;
        candidates.push({ record, weight });
    }

    const bestByDate = new Map<string, CSFAnchor>();
    for (const c of candidates) {
        const existing = bestByDate.get(c.record.dateOfSleep);
        if (!existing || c.weight > existing.weight) {
            // Anchor on the record's own day start, so a DST change mid-series
            // yields a 23 h or 25 h step that still rounds to the right day.
            const dayStart = zonedDayStartMs(
                c.record.dateOfSleep,
                c.record.startTimeOffsetMinutes ?? hostOffsetAt(c.record.startTime.getTime())
            );
            bestByDate.set(c.record.dateOfSleep, {
                dayNumber: Math.round((dayStart - globalFirstDateMs) / MS_PER_DAY),
                midpointHour: sleepMidpointHour(c.record, globalFirstDateMs),
                weight: c.weight,
                record: c.record,
            });
        }
    }

    return [...bestByDate.values()].sort((a, b) => a.dayNumber - b.dayNumber);
}
