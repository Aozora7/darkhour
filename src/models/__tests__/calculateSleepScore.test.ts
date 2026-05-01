import { describe, it, expect } from "vitest";
import { calculateSleepScore } from "../calculateSleepScore";
import type { SleepRecord } from "../../api/types";

function makeRecord(overrides: Partial<SleepRecord> = {}): SleepRecord {
    return {
        logId: 1,
        dateOfSleep: "2024-03-15",
        startTime: new Date("2024-03-15T23:00:00"),
        endTime: new Date("2024-03-16T07:00:00"),
        durationMs: 8 * 3_600_000,
        durationHours: 8,
        efficiency: 90,
        isMainSleep: true,
        minutesAsleep: 420,
        minutesAwake: 30,
        stages: {
            deep: 80,
            light: 200,
            rem: 100,
            wake: 40,
        },
        ...overrides,
    };
}

describe("calculateSleepScore", () => {
    it("returns value in [0, 1]", () => {
        const score = calculateSleepScore(makeRecord());
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
    });

    it("short sleep (2h) scores lower than normal sleep (8h)", () => {
        const short = calculateSleepScore(
            makeRecord({
                minutesAsleep: 120,
                durationMs: 2.5 * 3_600_000,
            })
        );
        const normal = calculateSleepScore(makeRecord());
        expect(short).toBeLessThan(normal);
    });

    it("very long sleep (13h) scores low", () => {
        const score = calculateSleepScore(
            makeRecord({
                minutesAsleep: 780,
                durationMs: 14 * 3_600_000,
            })
        );
        // durationScore = 0 for >12h, but deep+REM still contribute
        expect(score).toBeLessThan(0.85);
    });

    it("optimal 7-9h range scores highest", () => {
        const at7h = calculateSleepScore(makeRecord({ minutesAsleep: 420 }));
        const at8h = calculateSleepScore(makeRecord({ minutesAsleep: 480 }));
        const at4h = calculateSleepScore(makeRecord({ minutesAsleep: 240 }));
        // 7-9h should score higher than 4h
        expect(at7h).toBeGreaterThan(at4h);
        expect(at8h).toBeGreaterThan(at4h);
    });

    it("high wake percentage lowers score", () => {
        const lowWake = calculateSleepScore(
            makeRecord({
                stages: {
                    deep: 80,
                    light: 200,
                    rem: 100,
                    wake: 20,
                },
            })
        );
        const highWake = calculateSleepScore(
            makeRecord({
                stages: {
                    deep: 80,
                    light: 200,
                    rem: 100,
                    wake: 180,
                },
            })
        );
        expect(lowWake).toBeGreaterThan(highWake);
    });

    it("handles classic type records (no stages)", () => {
        const score = calculateSleepScore(
            makeRecord({
                stages: undefined,
                minutesAsleep: 420,
                minutesAwake: 30,
            })
        );
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
    });

    it("score is always clamped to [0, 1]", () => {
        // Extreme edge case: 0 minutes asleep, max wake
        const extreme = calculateSleepScore(
            makeRecord({
                minutesAsleep: 0,
                durationMs: 60_000, // 1 min
                minutesAwake: 1,
                stages: {
                    deep: 0,
                    light: 0,
                    rem: 0,
                    wake: 1,
                },
            })
        );
        expect(extreme).toBeGreaterThanOrEqual(0);
        expect(extreme).toBeLessThanOrEqual(1);
    });
});
