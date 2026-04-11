import { fitbitFetch } from "./fitbit";
import type { FitbitSleepPageV12, RawSleepRecordV12 } from "./types";

/**
 * Fetch all sleep records from the Fitbit API v1.2 endpoint.
 * Paginates automatically until all data is retrieved.
 * Calls onPageData with each page's records so the UI can render progressively.
 *
 * WORKAROUND: The Fitbit API is supposed to return pagination.next cursors
 * that span the entire date range, but sometimes a each beforeDate query only
 * returns 31 days of records with no pagination.next even when older data
 * records exist. To handle this, when the pagination cursor is exhausted but
 * records were returned, we step beforeDate back to the oldest dateOfSleep
 * seen and start a new paginated query. Ideally this fallback would not be
 * needed and the inner pagination loop alone would suffice.
 *
 * @param token - OAuth access token
 * @param onPageData - Callback with each page's records and running total
 * @param signal - Optional AbortSignal to cancel fetching (already-fetched data is kept)
 */
export async function fetchAllSleepRecords(
    token: string,
    onPageData?: (pageRecords: RawSleepRecordV12[], totalSoFar: number, page: number) => void,
    signal?: AbortSignal
): Promise<RawSleepRecordV12[]> {
    const allRecords: RawSleepRecordV12[] = [];
    let page = 0;

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    let beforeDate = tomorrow.toISOString().slice(0, 10);

    while (beforeDate) {
        if (signal?.aborted) break;

        let nextPath = `/1.2/user/-/sleep/list.json?beforeDate=${beforeDate}&sort=desc&offset=0&limit=100`;
        let batchOldestDate: string | null = null;

        while (nextPath) {
            if (signal?.aborted) break;

            const data = await fitbitFetch<FitbitSleepPageV12>(nextPath, token, signal);
            page++;

            if (data.sleep && data.sleep.length > 0) {
                allRecords.push(...data.sleep);
                onPageData?.(data.sleep, allRecords.length, page);

                for (const r of data.sleep) {
                    if (!batchOldestDate || r.dateOfSleep < batchOldestDate) {
                        batchOldestDate = r.dateOfSleep;
                    }
                }
            }

            if (data.pagination?.next) {
                try {
                    const nextUrl = new URL(data.pagination.next);
                    nextPath = nextUrl.pathname + nextUrl.search;
                } catch {
                    nextPath = "";
                }
            } else {
                nextPath = "";
            }
        }

        // Pagination cursor exhausted. Step beforeDate back to the oldest
        // dateOfSleep in this batch and start a new paginated query.
        // beforeDate is exclusive so records on that date are already fetched.
        if (batchOldestDate && batchOldestDate < beforeDate) {
            beforeDate = batchOldestDate;
        } else {
            break;
        }
    }

    return allRecords;
}

/**
 * Fetch only sleep records newer than afterDate (exclusive).
 * Uses afterDate + sort=asc so the API returns exactly the records we don't have.
 */
export async function fetchNewSleepRecords(
    token: string,
    afterDate: string,
    onPageData?: (pageRecords: RawSleepRecordV12[], totalSoFar: number, page: number) => void,
    signal?: AbortSignal
): Promise<RawSleepRecordV12[]> {
    const allRecords: RawSleepRecordV12[] = [];
    let page = 0;
    let nextPath = `/1.2/user/-/sleep/list.json?afterDate=${afterDate}&sort=asc&offset=0&limit=100`;

    while (nextPath) {
        if (signal?.aborted) break;

        const data = await fitbitFetch<FitbitSleepPageV12>(nextPath, token, signal);
        page++;

        if (data.sleep && data.sleep.length > 0) {
            allRecords.push(...data.sleep);
            onPageData?.(data.sleep, allRecords.length, page);
        }

        if (data.pagination?.next) {
            try {
                const nextUrl = new URL(data.pagination.next);
                nextPath = nextUrl.pathname + nextUrl.search;
            } catch {
                nextPath = "";
            }
        } else {
            nextPath = "";
        }
    }

    return allRecords;
}
