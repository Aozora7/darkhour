import { describe, it, expect } from "vitest";
import { parseGoogleHealthDataPoint } from "../parse";
import type { GoogleHealthSleepDataPoint } from "../types";
import { hostOffsetAt } from "../../../utils/zonedTime";

/** Protobuf Duration strings for the offsets used below. */
const UTC8 = "28800s"; // 480 minutes east
const UTC2 = "7200s"; // 120 minutes east
const UTC_NEG5 = "-18000s"; // 300 minutes west

/** Shape exactly as the Health Connect REST API returns it. */
function dataPoint(
    startTime: string,
    endTime: string,
    startUtcOffset?: string,
    endUtcOffset?: string
): GoogleHealthSleepDataPoint {
    return {
        name: "users/me/dataTypes/sleep/dataPoints/12345",
        dataSource: "com.google.android.apps.healthdata",
        sleep: {
            interval: { startTime, endTime, startUtcOffset, endUtcOffset },
            type: "STAGES",
        },
    };
}

describe("parseGoogleHealthDataPoint — time zones", () => {
    it("combines zone-less wall clock with the recorded offset into a true instant", () => {
        const rec = parseGoogleHealthDataPoint(dataPoint("2022-05-13 22:23:30", "2022-05-14 08:28:30", UTC8, UTC8));

        // 22:23:30 at UTC+8 is 14:23:30 UTC — NOT the browser's local reading.
        expect(rec.startTime.toISOString()).toBe("2022-05-13T14:23:30.000Z");
        expect(rec.endTime.toISOString()).toBe("2022-05-14T00:28:30.000Z");
        expect(rec.startTimeOffsetMinutes).toBe(480);
        expect(rec.endTimeOffsetMinutes).toBe(480);
    });

    it("derives dateOfSleep in the recorded zone, not the host zone", () => {
        const sameDay = parseGoogleHealthDataPoint(dataPoint("2022-05-13 23:30:00", "2022-05-14 07:00:00", UTC8));
        expect(sameDay.dateOfSleep).toBe("2022-05-13");

        // 00:30 at UTC+8 on the 13th is 16:30 UTC on the *previous* day, so a
        // UTC-dated derivation would file this episode under the wrong date.
        const prevDay = parseGoogleHealthDataPoint(dataPoint("2022-05-13 00:30:00", "2022-05-13 08:00:00", UTC8));
        expect(prevDay.dateOfSleep).toBe("2022-05-13");
        expect(prevDay.startTime.toISOString()).toBe("2022-05-12T16:30:00.000Z");
    });

    it("produces the same instant regardless of the host zone", () => {
        const rec = parseGoogleHealthDataPoint(dataPoint("2022-05-13 22:23:30", "2022-05-14 08:28:30", UTC8));
        expect(rec.startTime.getTime()).toBe(Date.UTC(2022, 4, 13, 14, 23, 30));
        // What the old `new Date(wallClock)` path produced on a UTC host.
        expect(rec.startTime.getTime()).not.toBe(Date.UTC(2022, 4, 13, 22, 23, 30));
    });

    it("handles negative offsets", () => {
        const rec = parseGoogleHealthDataPoint(dataPoint("2024-01-15 22:00:00", "2024-01-16 06:00:00", UTC_NEG5));
        expect(rec.startTimeOffsetMinutes).toBe(-300);
        expect(rec.startTime.toISOString()).toBe("2024-01-16T03:00:00.000Z");
    });

    it("keeps distinct start and end offsets across a DST change or flight", () => {
        // Asleep 23:30 at UTC+8, woke 07:30 at UTC+2 — a zone change mid-episode.
        const rec = parseGoogleHealthDataPoint(dataPoint("2022-05-13 23:30:00", "2022-05-14 07:30:00", UTC8, UTC2));
        expect(rec.startTimeOffsetMinutes).toBe(480);
        expect(rec.endTimeOffsetMinutes).toBe(120);
        expect(rec.startTime.toISOString()).toBe("2022-05-13T15:30:00.000Z");
        expect(rec.endTime.toISOString()).toBe("2022-05-14T05:30:00.000Z");
        // Elapsed real time, so the offset change is reflected in the duration.
        expect(rec.durationHours).toBeCloseTo(14, 6);
    });

    it("falls back to the start offset when endUtcOffset is absent", () => {
        const rec = parseGoogleHealthDataPoint(dataPoint("2022-05-13 22:00:00", "2022-05-14 06:00:00", UTC8));
        expect(rec.endTimeOffsetMinutes).toBe(480);
    });

    it("falls back to the host offset when the API omits both offsets", () => {
        const rec = parseGoogleHealthDataPoint(dataPoint("2024-01-15 22:00:00", "2024-01-16 06:00:00"));
        const expected = hostOffsetAt(new Date("2024-01-15 22:00:00").getTime());
        expect(rec.startTimeOffsetMinutes).toBe(expected);
        expect(rec.endTimeOffsetMinutes).toBe(expected);
    });

    it("normalises stage intervals to absolute instants", () => {
        const dp = dataPoint("2022-05-13 22:00:00", "2022-05-13 23:00:00", UTC8, UTC8);
        dp.sleep.stages = [
            {
                startTime: "2022-05-13 22:00:00",
                startUtcOffset: UTC8,
                endTime: "2022-05-13 22:30:00",
                endUtcOffset: UTC8,
                type: "LIGHT",
            },
            {
                startTime: "2022-05-13 22:30:00",
                startUtcOffset: UTC8,
                endTime: "2022-05-13 23:00:00",
                endUtcOffset: UTC8,
                type: "DEEP",
            },
        ];

        const rec = parseGoogleHealthDataPoint(dp);

        expect(rec.stageData).toHaveLength(2);
        // Stored as an absolute instant, so the renderer never re-guesses the zone.
        expect(rec.stageData![0]!.dateTime).toBe("2022-05-13T14:00:00.000Z");
        expect(rec.stageData![0]!.seconds).toBe(1800);
        expect(rec.stageData![1]!.level).toBe("deep");
        // Stage instants must line up with the parent record's instant.
        expect(rec.stageData![0]!.dateTime).toBe(rec.startTime.toISOString());
    });

    it("drops stage intervals whose end precedes their start", () => {
        const dp = dataPoint("2022-05-13 22:00:00", "2022-05-14 06:00:00", UTC8);
        dp.sleep.stages = [
            {
                startTime: "2022-05-13 22:00:00",
                startUtcOffset: UTC2, // start is 2 h east...
                endTime: "2022-05-13 22:00:00",
                endUtcOffset: UTC8, // ...end is 8 h east, so elapsed time is negative
                type: "LIGHT",
            },
        ];
        const rec = parseGoogleHealthDataPoint(dp);
        expect(rec.stageData).toEqual([]);
    });
});
