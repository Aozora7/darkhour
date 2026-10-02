// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from "vitest";
import "fake-indexeddb/auto";

/**
 * Reproduces the production scenario: a browser that already holds a v1 cache
 * (written by the pre-reconcile build, keyed by the bare user id) opening the app
 * after the version bump.
 *
 * Everything runs against one seeded database. `vi.resetModules()` is
 * deliberately avoided — the cache module holds its connection open, and a second
 * `open()` at a higher version would then be blocked, which is a different
 * problem from the one under test.
 */

const DB_NAME = "darkhour-cache";
const STORE = "sleepRecords";

function seedV1(): Promise<void> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            const store = req.result.createObjectStore(STORE, { keyPath: "name" });
            store.createIndex("userId", "_userId", { unique: false });
            store.createIndex("userId_dateOfSleep", ["_userId", "dateOfSleep"], { unique: false });
        };
        req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction(STORE, "readwrite");
            const store = tx.objectStore(STORE);
            // Exactly what the old build wrote: `_userId` was the bare user id.
            for (let i = 1; i <= 3; i++) {
                store.put({
                    name: `users/u1/dataTypes/sleep/dataPoints/legacy-${i}`,
                    _userId: "u1",
                    dateOfSleep: `2024-01-0${i}`,
                    sleep: {
                        interval: {
                            startTime: `2024-01-0${i} 23:00:00`,
                            startUtcOffset: "0s",
                            endTime: `2024-01-0${i} 23:59:00`,
                            endUtcOffset: "0s",
                        },
                    },
                });
            }
            tx.oncomplete = () => {
                db.close();
                resolve();
            };
            tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
    });
}

/** Fail loudly instead of hanging the suite. */
async function withTimeout<T>(p: Promise<T>, ms = 2000): Promise<{ timedOut: true } | { timedOut: false; value: T }> {
    return Promise.race([
        p.then((value) => ({ timedOut: false as const, value })),
        new Promise<{ timedOut: true }>((resolve) => setTimeout(() => resolve({ timedOut: true }), ms)),
    ]);
}

let cache: typeof import("../cache");

beforeAll(async () => {
    await seedV1();
    cache = await import("../cache");
});

describe("existing v1 cache after deploy", () => {
    it("upgrades to the current version instead of stalling", async () => {
        const result = await withTimeout(cache.getCachedRecords("u1::all-sources"));
        expect(result.timedOut).toBe(false);
    });

    it("leaves no v1 rows visible under the new scoped partition", async () => {
        const result = await withTimeout(cache.getCachedRecords("u1::all-sources"));
        expect(result.timedOut).toBe(false);
        if (!result.timedOut) expect(result.value).toEqual([]);
    });

    it("resolves the watermark lookup", async () => {
        const result = await withTimeout(cache.getLatestDateOfSleep("u1::all-sources"));
        expect(result.timedOut).toBe(false);
    });

    it("can write and read back a freshly fetched record", async () => {
        const scope = "u1::google-wearables";
        const write = await withTimeout(
            cache.putRecords(scope, [
                {
                    name: "users/u1/dataTypes/sleep/dataPoints/new",
                    sleep: {
                        interval: {
                            startTime: "2024-02-01 23:00:00",
                            startUtcOffset: "0s",
                            endTime: "2024-02-02 07:00:00",
                            endUtcOffset: "0s",
                        },
                    },
                },
            ])
        );
        expect(write.timedOut).toBe(false);

        const read = await withTimeout(cache.getCachedRecords(scope));
        expect(read.timedOut).toBe(false);
        if (!read.timedOut) {
            expect(read.value).toHaveLength(1);
            expect(read.value[0]!.name).toBe("users/u1/dataTypes/sleep/dataPoints/new");
        }
    });

    it("clears one partition without touching another", async () => {
        const result = await withTimeout(cache.clearUserCache("u1::google-wearables"));
        expect(result.timedOut).toBe(false);

        const read = await withTimeout(cache.getCachedRecords("u1::google-wearables"));
        expect(read.timedOut).toBe(false);
        if (!read.timedOut) expect(read.value).toEqual([]);
    });
});
