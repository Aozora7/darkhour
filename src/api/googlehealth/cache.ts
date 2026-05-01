import type { GoogleHealthSleepDataPoint } from "./types";

interface CachedGoogleHealthRecord extends GoogleHealthSleepDataPoint {
    _userId?: string;
    dateOfSleep: string; // derived field for querying
}

const DB_NAME = "darkhour-cache";
const DB_VERSION = 1;
const STORE_NAME = "sleepRecords";

let dbPromise: Promise<IDBDatabase> | null = null;

export function isIdbAvailable(): boolean {
    return typeof indexedDB !== "undefined";
}

function getDb(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                // We use 'name' as the unique key, derived from the resource name
                const store = db.createObjectStore(STORE_NAME, { keyPath: "name" });
                store.createIndex("userId", "_userId", { unique: false });
                store.createIndex("userId_dateOfSleep", ["_userId", "dateOfSleep"], { unique: false });
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

/** Read all cached raw records for a user, sorted by dateOfSleep via compound index. */
export async function getCachedRecords(userId: string): Promise<GoogleHealthSleepDataPoint[]> {
    if (!isIdbAvailable()) return [];
    try {
        const db = await getDb();
        return new Promise<GoogleHealthSleepDataPoint[]>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readonly");
            const store = tx.objectStore(STORE_NAME);
            const index = store.index("userId_dateOfSleep");
            const range = IDBKeyRange.bound([userId, ""], [userId, "\uffff"]);
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

/** Get the most recent dateOfSleep string for a user (O(1) via reverse cursor). */
export async function getLatestDateOfSleep(userId: string): Promise<string | null> {
    if (!isIdbAvailable()) return null;
    try {
        const db = await getDb();
        return new Promise<string | null>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readonly");
            const store = tx.objectStore(STORE_NAME);
            const index = store.index("userId_dateOfSleep");
            const range = IDBKeyRange.bound([userId, ""], [userId, "\uffff"]);
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

/** Write records to the cache. Adds _userId and derived dateOfSleep to each record. */
export async function putRecords(userId: string, records: GoogleHealthSleepDataPoint[]): Promise<void> {
    if (!isIdbAvailable() || records.length === 0) return;
    try {
        const db = await getDb();
        return new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readwrite");
            const store = tx.objectStore(STORE_NAME);

            for (const record of records) {
                const startObj = record.sleep?.interval?.startTime
                    ? new Date(record.sleep.interval.startTime)
                    : new Date();
                const dateOfSleep = startObj.toISOString().slice(0, 10);
                store.put({ ...record, _userId: userId, dateOfSleep });
            }

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (err) {
        console.warn("[googlehealthCache] putRecords failed:", err);
    }
}

/** Delete all records for a user. */
export async function clearUserCache(userId: string): Promise<void> {
    if (!isIdbAvailable()) return;
    try {
        const db = await getDb();
        return new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readwrite");
            const store = tx.objectStore(STORE_NAME);
            const index = store.index("userId");
            const range = IDBKeyRange.only(userId);
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
