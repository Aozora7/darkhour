import { describe, it, expect } from "vitest";
import {
    MS_PER_DAY,
    MS_PER_HOUR,
    MS_PER_MINUTE,
    addDaysToDateStr,
    explicitOffsetMinutes,
    hostOffsetAt,
    parseUtcOffset,
    referenceOffset,
    resolveWallOffset,
    toInstant,
    zonedDateStr,
    zonedDayStartMs,
    zonedHourOfDay,
} from "../zonedTime";

describe("parseUtcOffset", () => {
    it("parses protobuf Duration seconds into minutes east", () => {
        expect(parseUtcOffset("10800s")).toBe(180); // UTC+3 — seen in real exports
        expect(parseUtcOffset("7200s")).toBe(120); // UTC+2
        expect(parseUtcOffset("28800s")).toBe(480); // UTC+8
        expect(parseUtcOffset("0s")).toBe(0);
        expect(parseUtcOffset("-18000s")).toBe(-300); // UTC-5
        expect(parseUtcOffset("-19800s")).toBe(-330); // UTC-5:30
    });

    it("accepts a raw number of minutes", () => {
        expect(parseUtcOffset(480)).toBe(480);
        expect(parseUtcOffset(-300)).toBe(-300);
    });

    it("returns undefined for missing or malformed input", () => {
        expect(parseUtcOffset(undefined)).toBeUndefined();
        expect(parseUtcOffset(null)).toBeUndefined();
        expect(parseUtcOffset("")).toBeUndefined();
        expect(parseUtcOffset("P8H")).toBeUndefined();
        expect(parseUtcOffset("later")).toBeUndefined();
        expect(parseUtcOffset(Number.NaN)).toBeUndefined();
    });
});

describe("explicitOffsetMinutes", () => {
    it("reads a zone designator", () => {
        expect(explicitOffsetMinutes("2024-01-15T22:00:00Z")).toBe(0);
        expect(explicitOffsetMinutes("2024-01-15T22:00:00+08:00")).toBe(480);
        expect(explicitOffsetMinutes("2024-01-15T22:00:00+0800")).toBe(480);
        expect(explicitOffsetMinutes("2024-01-15T22:00:00-05:00")).toBe(-300);
        expect(explicitOffsetMinutes("2024-01-15T22:00:00+08")).toBe(480);
    });

    it("returns undefined for zone-less wall-clock values", () => {
        expect(explicitOffsetMinutes("2024-01-15 22:00:00")).toBeUndefined();
        expect(explicitOffsetMinutes("2024-01-15T22:00:00")).toBeUndefined();
    });

    it("does not mistake a date-only value for a negative offset", () => {
        // "2022-05-13" ends in "-13", which a loose pattern would read as -13:00.
        expect(explicitOffsetMinutes("2022-05-13")).toBeUndefined();
    });
});

describe("toInstant", () => {
    it("interprets zone-less wall clock in the given offset", () => {
        // 22:23:30 at UTC+8 is 14:23:30 UTC.
        expect(toInstant("2022-05-13 22:23:30", 480).toISOString()).toBe("2022-05-13T14:23:30.000Z");
        expect(toInstant("2022-05-13 22:23:30", 0).toISOString()).toBe("2022-05-13T22:23:30.000Z");
        expect(toInstant("2022-05-13 22:23:30", -300).toISOString()).toBe("2022-05-14T03:23:30.000Z");
    });

    it("is independent of the host zone when an offset is supplied", () => {
        const iso = toInstant("2022-05-13 22:23:30", 480).toISOString();
        expect(iso).toBe(new Date(Date.UTC(2022, 4, 13, 14, 23, 30)).toISOString());
    });

    it("lets an embedded designator win over the supplied offset", () => {
        expect(toInstant("2024-01-15T22:00:00Z", 480).toISOString()).toBe("2024-01-15T22:00:00.000Z");
        expect(toInstant("2024-01-15T22:00:00+08:00", 0).toISOString()).toBe("2024-01-15T14:00:00.000Z");
    });

    it("handles optional seconds, fractional seconds and T separators", () => {
        expect(toInstant("2024-01-15 22:00", 0).toISOString()).toBe("2024-01-15T22:00:00.000Z");
        expect(toInstant("2024-01-15T22:00:00", 0).toISOString()).toBe("2024-01-15T22:00:00.000Z");
        expect(toInstant("2024-01-15 22:00:00.5", 0).toISOString()).toBe("2024-01-15T22:00:00.500Z");
    });

    it("falls back to the host zone (DST-aware) when no offset is given", () => {
        const wall = "2024-01-15 22:00:00";
        const expectedOffset = resolveWallOffset(wall);
        expect(toInstant(wall).toISOString()).toBe(toInstant(wall, expectedOffset).toISOString());
    });

    it("returns an invalid date for empty input", () => {
        expect(Number.isNaN(toInstant("").getTime())).toBe(true);
    });
});

describe("zonedDateStr / zonedDayStartMs", () => {
    const instant = Date.UTC(2022, 4, 13, 20, 0, 0); // 2022-05-14 04:00 at UTC+8

    it("labels the day in the given offset", () => {
        expect(zonedDateStr(instant, 480)).toBe("2022-05-14");
        expect(zonedDateStr(instant, 0)).toBe("2022-05-13");
    });

    it("round-trips a day label to its midnight instant", () => {
        for (const offset of [0, 120, 480, -330, 825]) {
            const dateStr = zonedDateStr(instant, offset);
            expect(zonedDateStr(zonedDayStartMs(dateStr, offset), offset)).toBe(dateStr);
        }
    });

    it("spaces days exactly 24h apart in a fixed offset", () => {
        const a = zonedDayStartMs("2024-03-30", 60);
        const b = zonedDayStartMs("2024-03-31", 120); // across a DST change
        expect(a).not.toBe(b);
        // 23h apart in absolute terms, because the offsets differ.
        expect(b - a).toBe(23 * MS_PER_HOUR);
        // But a fixed-offset grid is exact.
        expect(zonedDayStartMs("2024-03-31", 60) - a).toBe(MS_PER_DAY);
    });

    it("keeps a wall-clock time constant across a DST boundary within one offset", () => {
        expect(zonedHourOfDay(zonedDayStartMs("2024-03-31", 60) + 22 * MS_PER_HOUR, 60)).toBe(22);
    });
});

describe("zonedHourOfDay", () => {
    it("returns fractional hours in the given offset", () => {
        expect(zonedHourOfDay(Date.UTC(2024, 0, 15, 22, 30, 0), 0)).toBeCloseTo(22.5, 6);
        expect(zonedHourOfDay(Date.UTC(2024, 0, 15, 22, 30, 0), 480)).toBeCloseTo(6.5, 6);
        expect(zonedHourOfDay(Date.UTC(2024, 0, 15, 0, 0, 0), 0)).toBeCloseTo(0, 6);
    });
});

describe("addDaysToDateStr", () => {
    it("adds days across month and year boundaries", () => {
        expect(addDaysToDateStr("2024-01-31", 1)).toBe("2024-02-01");
        expect(addDaysToDateStr("2024-12-31", 1)).toBe("2025-01-01");
        expect(addDaysToDateStr("2024-03-01", -1)).toBe("2024-02-29"); // leap year
        expect(addDaysToDateStr("2024-02-29", 0)).toBe("2024-02-29");
    });

    it("handles negative offsets across a year boundary", () => {
        const instant = Date.UTC(2025, 0, 1, 2, 0, 0); // 2024-12-31 21:00 at UTC-5
        expect(zonedDateStr(instant, -300)).toBe("2024-12-31");
        expect(zonedDateStr(instant, 480)).toBe("2025-01-01");
    });
});

describe("hostOffsetAt", () => {
    it("reports the host offset for a given instant", () => {
        const ms = Date.UTC(2024, 0, 15);
        expect(hostOffsetAt(ms)).toBe(-new Date(ms).getTimezoneOffset());
    });
});

describe("referenceOffset", () => {
    const rec = (iso: string, offset: number) => ({
        startTime: new Date(iso),
        startTimeOffsetMinutes: offset,
    });

    it("uses the offset of the earliest record", () => {
        const records = [rec("2024-01-03T00:00:00Z", 120), rec("2024-01-01T00:00:00Z", 480)];
        expect(referenceOffset(records)).toBe(480);
    });

    it("falls back to the host offset at that date when the field is missing", () => {
        const start = new Date("2024-01-01T00:00:00Z");
        const records = [{ startTime: start, startTimeOffsetMinutes: undefined as unknown as number }];
        expect(referenceOffset(records)).toBe(hostOffsetAt(start.getTime()));
    });

    it("returns the host offset for an empty set", () => {
        expect(referenceOffset([])).toBe(-new Date().getTimezoneOffset());
    });
});

describe("MS constants", () => {
    it("are consistent", () => {
        expect(MS_PER_DAY).toBe(24 * MS_PER_HOUR);
        expect(MS_PER_HOUR).toBe(60 * MS_PER_MINUTE);
    });
});
