// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import "fake-indexeddb/auto";

/**
 * A cache is an optimisation — it must never be able to block data from loading.
 *
 * `indexedDB.open` has three outcomes, not two. If another connection holds an
 * older version, the request fires `blocked` and then settles **neither** way, so
 * an unhandled `blocked` leaves the promise pending forever. Worse, only the
 * *first* blocked open reports `blocked`; later opens queue behind it and emit no
 * event at all. These tests pin the resulting contract:
 *
 *   1. a blocked cache fails open — reads resolve empty, never hang;
 *   2. it stays disabled for the rest of the page load, including writes;
 *   3. the next page load recovers once the competing connection is gone.
 *
 * Everything lives in one test on purpose: a deliberately-blocked open leaves a
 * pending request behind, and splitting these across cases makes the harness
 * fight those leaked connections in `deleteDatabase`.
 */

const DB_NAME = "darkhour-cache";
const STORE = "sleepRecords";

const RECORD = {
    name: "users/u1/dataTypes/sleep/dataPoints/1",
    sleep: {
        interval: {
            startTime: "2024-01-01 23:00:00",
            startUtcOffset: "0s",
            endTime: "2024-01-02 07:00:00",
            endUtcOffset: "0s",
        },
    },
};

function openAtVersion(version: number): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, version);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) {
                const store = db.createObjectStore(STORE, { keyPath: "name" });
                store.createIndex("userId", "_userId", { unique: false });
                store.createIndex("userId_dateOfSleep", ["_userId", "dateOfSleep"], { unique: false });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function withTimeout<T>(p: Promise<T>, ms = 1500): Promise<"TIMEOUT" | T> {
    return Promise.race([p, new Promise<"TIMEOUT">((r) => setTimeout(() => r("TIMEOUT"), ms))]);
}

describe("cache fails open when the upgrade is blocked", () => {
    it("never hangs, stays disabled, then recovers on the next page load", async () => {
        // Stand in for a second tab, or a page still alive in the back/forward
        // cache, holding the pre-existing database open.
        const stale = await openAtVersion(1);
        const cache = await import("../cache");

        // 1. Reads resolve to "nothing cached" rather than pending.
        const records = await withTimeout(cache.getCachedRecords("u1::all-sources"));
        expect(records, "getCachedRecords while blocked").not.toBe("TIMEOUT");
        expect(records).toEqual([]);

        // The latch matters here: this is the *second* open, and a blocked open
        // reports nothing at all, so without it this read would hang forever.
        const watermark = await withTimeout(cache.getLatestDateOfSleep("u1::all-sources"));
        expect(watermark, "getLatestDateOfSleep while blocked").not.toBe("TIMEOUT");
        expect(watermark).toBeNull();

        // 2. The cache is off for the rest of this page load, writes included.
        const write = await withTimeout(cache.putRecords("u1::all-sources", [RECORD]));
        expect(write, "putRecords while blocked").not.toBe("TIMEOUT");
        const afterWrite = await withTimeout(cache.getCachedRecords("u1::all-sources"));
        expect(afterWrite, "read back while blocked").not.toBe("TIMEOUT");
        expect(afterWrite).toEqual([]);

        // 3. Releasing the competitor and reloading gives a working cache again.
        stale.close();
        await new Promise((r) => setTimeout(r, 100));
        vi.resetModules(); // a fresh module is what a page reload gives us

        const reloaded = await import("../cache");
        const reloadedWrite = await withTimeout(reloaded.putRecords("u1::all-sources", [RECORD]));
        expect(reloadedWrite, "putRecords after reload").not.toBe("TIMEOUT");

        const persisted = await withTimeout(reloaded.getCachedRecords("u1::all-sources"));
        expect(persisted, "getCachedRecords after reload").not.toBe("TIMEOUT");
        expect(persisted).toHaveLength(1);
        expect((persisted as { name: string }[])[0]!.name).toBe(RECORD.name);
    }, 20_000);
});
