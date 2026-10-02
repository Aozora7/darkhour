import type { GoogleHealthSleepDataPoint } from "./types";
import { dataPointId } from "./types";
import { browserOffsetMinutes, parseUtcOffset, toInstant, zonedDateStr } from "../../utils/zonedTime";

interface CachedGoogleHealthRecord extends GoogleHealthSleepDataPoint {
    /**
     * Cache partition, `"{userId}::{family}"` — see `cacheScope()`. Stored in a
     * field still named `_userId` so the existing indexes keep working; it is the
     * scope, not the bare user id.
     */
    _userId?: string;
    dateOfSleep: string; // derived field for querying
}

const DB_NAME = "darkhour-cache";
/**
 * v2 — the app reads from the `reconcile` endpoint, which omits subordinate
 * records from overlapping sync batches. Cached v1 records came from `list` and
 * can include both a winner and its subordinate, which cannot be reconciled away
 * client-side (they have different IDs, so logId dedup keeps both). The store is
 * therefore cleared on upgrade so the next fetch rebuilds it from `reconcile`.
 */
const DB_VERSION = 2;
const STORE_NAME = "sleepRecords";

let dbPromise: Promise<IDBDatabase> | null = null;

export function isIdbAvailable(): boolean {
    return typeof indexedDB !== "undefined";
}

function getDb(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = request.result;
            const tx = request.transaction;

            if (!db.objectStoreNames.contains(STORE_NAME)) {
                // We use 'name' as the unique key, derived from the resource name
                const store = db.createObjectStore(STORE_NAME, { keyPath: "name" });
                store.createIndex("userId", "_userId", { unique: false });
                store.createIndex("userId_dateOfSleep", ["_userId", "dateOfSleep"], { unique: false });
            } else if (event.oldVersion < DB_VERSION && tx) {
                // Drop pre-reconcile records; see DB_VERSION.
                tx.objectStore(STORE_NAME).clear();
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
            dbPromise = null;
            reject(request.error);
        };
    });

    return dbPromise;
}

/** Read all cached raw records for a scope, sorted by dateOfSleep via compound index. */
export async function getCachedRecords(scope: string): Promise<GoogleHealthSleepDataPoint[]> {
    if (!isIdbAvailable()) return [];
    try {
        const db = await getDb();
        return new Promise<GoogleHealthSleepDataPoint[]>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readonly");
            const store = tx.objectStore(STORE_NAME);
            const index = store.index("userId_dateOfSleep");
            const range = IDBKeyRange.bound([scope, ""], [scope, "\uffff"]);
            const results: GoogleHealthSleepDataPoint[] = [];
            const request = index.openCursor(range);

            request.onsuccess = () => {
                const cursor = request.result;
                if (cursor) {
                    const record = { ...cursor.value } as CachedGoogleHealthRecord;
                    delete record._userId;
                    // @ts-expect-error: strip derived field not present on API type
                    delete record.dateOfSleep;
                    results.push(record);
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            request.onerror = () => reject(request.error);
        });
    } catch (err) {
        console.warn("[googlehealthCache] getCachedRecords failed:", err);
        return [];
    }
}

/** Get the most recent dateOfSleep string for a scope (O(1) via reverse cursor). */
export async function getLatestDateOfSleep(scope: string): Promise<string | null> {
    if (!isIdbAvailable()) return null;
    try {
        const db = await getDb();
        return new Promise<string | null>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readonly");
            const store = tx.objectStore(STORE_NAME);
            const index = store.index("userId_dateOfSleep");
            const range = IDBKeyRange.bound([scope, ""], [scope, "\uffff"]);
            const request = index.openCursor(range, "prev");

            request.onsuccess = () => {
                const cursor = request.result;
                resolve(cursor ? (cursor.value as CachedGoogleHealthRecord).dateOfSleep : null);
            };
            request.onerror = () => reject(request.error);
        });
    } catch (err) {
        console.warn("[googlehealthCache] getLatestDateOfSleep failed:", err);
        return null;
    }
}

/** Write records to a scope's cache, adding _userId and a derived dateOfSleep. */
export async function putRecords(scope: string, records: GoogleHealthSleepDataPoint[]): Promise<void> {
    if (!isIdbAvailable() || records.length === 0) return;
    try {
        const db = await getDb();
        return new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readwrite");
            const store = tx.objectStore(STORE_NAME);

            for (const record of records) {
                // The store's keyPath is "name", but reconcile responses identify
                // records via "dataPointName" — normalize before writing, and skip
                // anything still unidentified rather than failing the whole batch.
                const id = dataPointId(record);
                if (!id) continue;

                // Index on the day the sleep was *recorded* in, not the UTC day, so
                // the incremental-fetch watermark tracks the subject's own calendar.
                const offset = parseUtcOffset(record.sleep?.interval?.startUtcOffset) ?? browserOffsetMinutes();
                const startMs = record.sleep?.interval?.startTime
                    ? toInstant(record.sleep.interval.startTime, offset).getTime()
                    : Date.now();
                const dateOfSleep = Number.isFinite(startMs) ? zonedDateStr(startMs, offset) : "";
                store.put({ ...record, name: id, _userId: scope, dateOfSleep });
            }

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (err) {
        console.warn("[googlehealthCache] putRecords failed:", err);
    }
}

/** Delete every record in a scope. */
export async function clearUserCache(scope: string): Promise<void> {
    if (!isIdbAvailable()) return;
    try {
        const db = await getDb();
        return new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readwrite");
            const store = tx.objectStore(STORE_NAME);
            const index = store.index("userId");
            const range = IDBKeyRange.only(scope);
            const request = index.openCursor(range);

            request.onsuccess = () => {
                const cursor = request.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                }
            };

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (err) {
        console.warn("[googlehealthCache] clearUserCache failed:", err);
    }
}
