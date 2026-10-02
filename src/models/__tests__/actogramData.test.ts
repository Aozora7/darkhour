import { describe, it, expect } from "vitest";
import { buildActogramRows, buildTauRows } from "../actogramData";
import type { SleepRecord } from "../../api/types";
import { hostOffsetAt, toInstant, zonedDateStr, zonedDayStartMs } from "../../utils/zonedTime";

function makeRecord(start: string, end: string, id = 1): SleepRecord {
    const startTime = new Date(start);
    const endTime = new Date(end);
    const durationMs = endTime.getTime() - startTime.getTime();
    const dateStr = start.slice(0, 10);
    // Timestamps are built with `new Date(string)`, so they sit in the host's own
    // zone — the offset to record is the host offset at that date.
    const offset = hostOffsetAt(startTime.getTime());
    return {
        logId: id,
        dateOfSleep: dateStr,
        startTime,
        endTime,
        startTimeOffsetMinutes: offset,
        endTimeOffsetMinutes: hostOffsetAt(endTime.getTime()),
        durationMs,
        durationHours: durationMs / 3_600_000,
        efficiency: 90,
        minutesAsleep: Math.round((durationMs / 60_000) * 0.9),
        minutesAwake: Math.round((durationMs / 60_000) * 0.1),
        isMainSleep: true,
        sleepScore: 0.8,
    };
}

describe("buildActogramRows", () => {
    it("returns empty for empty input", () => {
        expect(buildActogramRows([])).toEqual([]);
    });

    it("returns rows in newest-first order", () => {
        const records = [
            makeRecord("2024-01-01T23:00:00", "2024-01-02T07:00:00", 1),
            makeRecord("2024-01-03T23:00:00", "2024-01-04T07:00:00", 2),
        ];
        const rows = buildActogramRows(records);
        // Newest first: last date should be first row
        expect(rows[0]!.date > rows[rows.length - 1]!.date).toBe(true);
    });

    it("splits midnight-crossing sleep into two rows", () => {
        const records = [makeRecord("2024-01-01T23:00:00", "2024-01-02T07:00:00", 1)];
        const rows = buildActogramRows(records);

        // Should have rows for both Jan 1 and Jan 2
        const jan1 = rows.find((r) => r.date === "2024-01-01");
        const jan2 = rows.find((r) => r.date === "2024-01-02");

        expect(jan1).toBeDefined();
        expect(jan2).toBeDefined();
        expect(jan1!.blocks.length).toBe(1);
        expect(jan2!.blocks.length).toBe(1);

        // Jan 1 block: 23:00-24:00 → startHour=23, endHour=24
        expect(jan1!.blocks[0]!.startHour).toBeCloseTo(23, 1);
        expect(jan1!.blocks[0]!.endHour).toBeCloseTo(24, 1);

        // Jan 2 block: 00:00-07:00 → startHour=0, endHour=7
        expect(jan2!.blocks[0]!.startHour).toBeCloseTo(0, 1);
        expect(jan2!.blocks[0]!.endHour).toBeCloseTo(7, 1);
    });

    it("adds extra forecast days", () => {
        const records = [makeRecord("2024-01-01T23:00:00", "2024-01-02T07:00:00", 1)];
        const noExtra = buildActogramRows(records, 0);
        const withExtra = buildActogramRows(records, 5);
        expect(withExtra.length).toBe(noExtra.length + 5);
    });

    it("handles single-day sleep (no midnight crossing)", () => {
        const records = [makeRecord("2024-01-01T13:00:00", "2024-01-01T14:30:00", 1)];
        const rows = buildActogramRows(records);
        const jan1 = rows.find((r) => r.date === "2024-01-01");
        expect(jan1).toBeDefined();
        expect(jan1!.blocks.length).toBe(1);
        expect(jan1!.blocks[0]!.startHour).toBeCloseTo(13, 1);
        expect(jan1!.blocks[0]!.endHour).toBeCloseTo(14.5, 1);
    });

    it("sortDirection=oldest returns rows oldest-first", () => {
        const records = [
            makeRecord("2024-01-01T23:00:00", "2024-01-02T07:00:00", 1),
            makeRecord("2024-01-03T23:00:00", "2024-01-04T07:00:00", 2),
        ];
        const rows = buildActogramRows(records, 0, "oldest");
        expect(rows[0]!.date).toBe("2024-01-01");
        expect(rows[rows.length - 1]!.date).toBe("2024-01-04");
    });

    it("sortDirection=newest returns rows newest-first", () => {
        const records = [
            makeRecord("2024-01-01T23:00:00", "2024-01-02T07:00:00", 1),
            makeRecord("2024-01-03T23:00:00", "2024-01-04T07:00:00", 2),
        ];
        const rows = buildActogramRows(records, 0, "newest");
        expect(rows[0]!.date).toBe("2024-01-04");
        expect(rows[rows.length - 1]!.date).toBe("2024-01-01");
    });
});

describe("buildTauRows", () => {
    it("returns empty for empty input", () => {
        expect(buildTauRows([], 24)).toEqual([]);
    });

    it("creates rows with correct width", () => {
        const records = [
            makeRecord("2024-01-01T23:00:00", "2024-01-02T07:00:00", 1),
            makeRecord("2024-01-02T23:30:00", "2024-01-03T07:30:00", 2),
        ];
        const rows = buildTauRows(records, 25);
        // Each row spans 25 hours
        for (const row of rows) {
            for (const block of row.blocks) {
                expect(block.endHour).toBeLessThanOrEqual(25);
                expect(block.startHour).toBeGreaterThanOrEqual(0);
            }
        }
    });

    it("rows are newest-first", () => {
        const records = [
            makeRecord("2024-01-01T23:00:00", "2024-01-02T07:00:00", 1),
            makeRecord("2024-01-03T23:00:00", "2024-01-04T07:00:00", 2),
        ];
        const rows = buildTauRows(records, 24.5);
        // Newest first means startMs should decrease
        for (let i = 1; i < rows.length; i++) {
            expect(rows[i]!.startMs!).toBeLessThan(rows[i - 1]!.startMs!);
        }
    });

    it("sortDirection=oldest returns rows oldest-first", () => {
        const records = [
            makeRecord("2024-01-01T23:00:00", "2024-01-02T07:00:00", 1),
            makeRecord("2024-01-03T23:00:00", "2024-01-04T07:00:00", 2),
        ];
        const rows = buildTauRows(records, 24, 0, "oldest");
        // Oldest first means startMs should increase
        for (let i = 1; i < rows.length; i++) {
            expect(rows[i]!.startMs!).toBeGreaterThan(rows[i - 1]!.startMs!);
        }
        expect(rows[0]!.date).toBe("2024-01-01");
    });

    it("sortDirection=newest returns rows newest-first", () => {
        const records = [
            makeRecord("2024-01-01T23:00:00", "2024-01-02T07:00:00", 1),
            makeRecord("2024-01-03T23:00:00", "2024-01-04T07:00:00", 2),
        ];
        const rows = buildTauRows(records, 24, 0, "newest");
        // Newest first means startMs should decrease
        for (let i = 1; i < rows.length; i++) {
            expect(rows[i]!.startMs!).toBeLessThan(rows[i - 1]!.startMs!);
        }
    });
});

describe("recorded time zone is honoured, not the host zone", () => {
    /** A record captured at UTC+8, expressed as an absolute instant. */
    function utc8Record(wallStart: string, wallEnd: string, id: number): SleepRecord {
        const startMs = toInstant(wallStart, 480).getTime();
        const endMs = toInstant(wallEnd, 480).getTime();
        return {
            logId: id,
            dateOfSleep: zonedDateStr(startMs, 480),
            startTime: new Date(startMs),
            endTime: new Date(endMs),
            startTimeOffsetMinutes: 480,
            endTimeOffsetMinutes: 480,
            durationMs: endMs - startMs,
            durationHours: (endMs - startMs) / 3_600_000,
            efficiency: 90,
            minutesAsleep: 420,
            minutesAwake: 30,
            isMainSleep: true,
            sleepScore: 0.8,
        };
    }

    it("places the block at the recorded wall-clock hour", () => {
        const records = [utc8Record("2024-01-01 23:00:00", "2024-01-02 07:00:00", 1)];
        const rows = buildActogramRows(records, 0, "oldest");

        const jan1 = rows.find((r) => r.date === "2024-01-01")!;
        const jan2 = rows.find((r) => r.date === "2024-01-02")!;
        // 23:00 and 07:00 are the *recorded* local times, whatever the host zone is.
        expect(jan1.blocks[0]!.startHour).toBeCloseTo(23, 6);
        expect(jan1.blocks[0]!.endHour).toBeCloseTo(24, 6);
        expect(jan2.blocks[0]!.startHour).toBeCloseTo(0, 6);
        expect(jan2.blocks[0]!.endHour).toBeCloseTo(7, 6);
    });

    it("labels rows with the recorded calendar day", () => {
        const records = [utc8Record("2024-01-01 23:00:00", "2024-01-02 07:00:00", 1)];
        const rows = buildActogramRows(records, 0, "oldest");
        expect(rows.map((r) => r.date)).toEqual(["2024-01-01", "2024-01-02"]);
    });

    it("keeps a travelling subject's blocks on the shared grid", () => {
        // Same wall-clock routine before and after a 6 h flight eastward. On a
        // single grid the second block appears shifted, which is truthful — what
        // must not happen is a row/day reassignment or a gap in the date sequence.
        const before = utc8Record("2024-01-01 23:00:00", "2024-01-02 07:00:00", 1);
        const afterStart = toInstant("2024-01-02 23:00:00", 120).getTime();
        const afterEnd = toInstant("2024-01-03 07:00:00", 120).getTime();
        const after: SleepRecord = {
            ...before,
            logId: 2,
            dateOfSleep: zonedDateStr(afterStart, 120),
            startTime: new Date(afterStart),
            endTime: new Date(afterEnd),
            startTimeOffsetMinutes: 120,
            endTimeOffsetMinutes: 120,
        };

        const rows = buildActogramRows([before, after], 0, "oldest");
        // Rows are contiguous — no day is invented or skipped by the zone change.
        expect(rows.map((r) => r.date)).toEqual(["2024-01-01", "2024-01-02", "2024-01-03"]);
        // Every block stays inside its row's [0, 24) window.
        for (const row of rows) {
            for (const block of row.blocks) {
                expect(block.startHour).toBeGreaterThanOrEqual(0);
                expect(block.endHour).toBeLessThanOrEqual(24);
            }
        }
    });

    it("exposes absolute block bounds so stage rendering needs no zone guess", () => {
        const records = [utc8Record("2024-01-01 23:00:00", "2024-01-02 07:00:00", 1)];
        const rows = buildActogramRows(records, 0, "oldest");
        const block = rows.find((r) => r.date === "2024-01-01")!.blocks[0]!;
        expect(block.startMs).toBe(records[0]!.startTime.getTime());
        expect(block.endMs).toBe(zonedDayStartMs("2024-01-02", 480));
    });
});
