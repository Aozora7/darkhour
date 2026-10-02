import { describe, it, expect } from "vitest";
import { parseSleepData } from "../loadLocalData";
import { hostOffsetAt } from "../../utils/zonedTime";

/**
 * Exports written before offsets were tracked contain an absolute instant
 * (`Date#toJSON`) but no zone metadata. They must round-trip to the exact same
 * instants and the same day placement they had before, so existing files and the
 * ground-truth baselines are unaffected.
 */
function legacyExport(startIso: string, endIso: string, dateOfSleep: string) {
    return {
        logId: 1,
        dateOfSleep,
        startTime: startIso,
        endTime: endIso,
        durationMs: new Date(endIso).getTime() - new Date(startIso).getTime(),
        durationHours: 8,
        efficiency: 90,
        minutesAsleep: 420,
        minutesAwake: 30,
        isMainSleep: true,
        sleepScore: 0.85,
    };
}

describe("legacy exported records (no offset metadata)", () => {
    it("preserves the absolute instant exactly", () => {
        const [rec] = parseSleepData([
            legacyExport("2024-01-15T22:00:00.000Z", "2024-01-16T06:00:00.000Z", "2024-01-15"),
        ]);
        expect(rec!.startTime.toISOString()).toBe("2024-01-15T22:00:00.000Z");
        expect(rec!.endTime.toISOString()).toBe("2024-01-16T06:00:00.000Z");
    });

    it("adopts the host offset for that date, so nothing shifts", () => {
        const [rec] = parseSleepData([
            legacyExport("2024-01-15T22:00:00.000Z", "2024-01-16T06:00:00.000Z", "2024-01-15"),
        ]);
        // Exactly the frame the pre-timezone code used: the host zone at that date.
        expect(rec!.startTimeOffsetMinutes).toBe(hostOffsetAt(new Date("2024-01-15T22:00:00.000Z").getTime()));
        expect(rec!.endTimeOffsetMinutes).toBe(rec!.startTimeOffsetMinutes);
    });

    it("keeps the stored dateOfSleep verbatim", () => {
        const [rec] = parseSleepData([
            legacyExport("2024-01-15T22:00:00.000Z", "2024-01-16T06:00:00.000Z", "2024-01-15"),
        ]);
        expect(rec!.dateOfSleep).toBe("2024-01-15");
    });

    it("prefers stored offsets when present (round-trip fidelity)", () => {
        const record = {
            ...legacyExport("2022-05-13T14:23:30.000Z", "2022-05-14T00:28:30.000Z", "2022-05-13"),
            startTimeOffsetMinutes: 480,
            endTimeOffsetMinutes: 480,
        };
        const [rec] = parseSleepData([record]);
        expect(rec!.startTimeOffsetMinutes).toBe(480);
        expect(rec!.endTimeOffsetMinutes).toBe(480);
        // Day is re-derivable in the recorded zone and matches what was exported.
        expect(rec!.dateOfSleep).toBe("2022-05-13");
    });

    it("survives a JSON round-trip unchanged", () => {
        const original = {
            logId: 7,
            dateOfSleep: "2022-05-13",
            startTime: new Date("2022-05-13T14:23:30.000Z"),
            endTime: new Date("2022-05-14T00:28:30.000Z"),
            startTimeOffsetMinutes: 480,
            endTimeOffsetMinutes: 480,
            durationMs: 36_300_000,
            durationHours: 10.0833,
            efficiency: 92,
            minutesAsleep: 570,
            minutesAwake: 30,
            isMainSleep: true,
            sleepScore: 0.91,
        };
        const [rec] = parseSleepData(JSON.parse(JSON.stringify({ sleep: [original] })));
        expect(rec!.startTime.getTime()).toBe(original.startTime.getTime());
        expect(rec!.startTimeOffsetMinutes).toBe(480);
        expect(rec!.dateOfSleep).toBe("2022-05-13");
    });
});

describe("legacy v1.2 records", () => {
    it("recovers the offset embedded in the timestamp designator", () => {
        const [rec] = parseSleepData([
            {
                logId: 1,
                dateOfSleep: "2017-07-17",
                startTime: "2017-07-17T04:06:00.000+02:00",
                endTime: "2017-07-17T12:00:00.000+02:00",
                duration: 28_440_000,
                efficiency: 90,
                minutesAsleep: 420,
                minutesAwake: 30,
                isMainSleep: true,
                type: "stages",
            },
        ]);
        expect(rec!.startTimeOffsetMinutes).toBe(120);
        expect(rec!.startTime.toISOString()).toBe("2017-07-17T02:06:00.000Z");
    });
});

describe("raw reconcile responses", () => {
    // `reconcile` identifies data points with `dataPointName` rather than `name`,
    // and timestamps may already carry a `Z` designator.
    const RECONCILE_PAGE = {
        dataPoints: [
            {
                dataPointName: "users/1/dataTypes/sleep/dataPoints/111",
                dataSource: { recordingMethod: "DERIVED", platform: "FITBIT" },
                sleep: {
                    interval: {
                        startTime: "2026-03-03T20:57:30Z",
                        startUtcOffset: "0s",
                        endTime: "2026-03-04T04:41:30Z",
                        endUtcOffset: "0s",
                    },
                    type: "STAGES",
                    metadata: { stagesStatus: "SUCCEEDED", processed: true, main: true },
                    summary: { minutesAsleep: "407", minutesAwake: "57" },
                },
            },
        ],
        nextPageToken: "",
    };

    it("is recognized as Google Health data despite the identifier field", () => {
        const [rec] = parseSleepData(RECONCILE_PAGE);
        expect(rec).toBeDefined();
        expect(rec!.logId).toBe(111);
    });

    it("recognizes a bare array of reconcile data points", () => {
        const [rec] = parseSleepData(RECONCILE_PAGE.dataPoints);
        expect(rec!.logId).toBe(111);
    });

    it("honours metadata.main", () => {
        const [rec] = parseSleepData(RECONCILE_PAGE);
        expect(rec!.isMainSleep).toBe(true);
    });

    it("keeps distinct logIds so records never collapse together", () => {
        const second = structuredClone(RECONCILE_PAGE);
        second.dataPoints[0]!.dataPointName = "users/1/dataTypes/sleep/dataPoints/222";
        second.dataPoints[0]!.sleep.interval.startTime = "2026-03-04T20:57:30Z";
        second.dataPoints[0]!.sleep.interval.endTime = "2026-03-05T04:41:30Z";

        const records = parseSleepData([RECONCILE_PAGE, second]);
        expect(records).toHaveLength(2);
        expect(new Set(records.map((r) => r.logId)).size).toBe(2);
    });
});
