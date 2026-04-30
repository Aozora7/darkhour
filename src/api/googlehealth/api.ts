import { healthFetch } from "./googlehealth";
import type { GoogleHealthSleepDataPoint, GoogleHealthSleepPage } from "./types";

/**
 * Fetch all sleep records from the Google Health API.
 * Paginates automatically until all data is retrieved.
 */
export async function fetchAllSleepRecords(
    token: string,
    onPageData?: (pageRecords: GoogleHealthSleepDataPoint[], totalSoFar: number, page: number) => void,
    signal?: AbortSignal
): Promise<GoogleHealthSleepDataPoint[]> {
    const allRecords: GoogleHealthSleepDataPoint[] = [];
    let page = 0;
    let pageToken = "";

    while (true) {
        if (signal?.aborted) break;

        const query = new URLSearchParams();
        if (pageToken) {
            query.set("pageToken", pageToken);
        }
        query.set("pageSize", "25");
        const path = `/users/me/dataTypes/sleep/dataPoints${query.size ? "?" : ""}${query.toString()}`;
        const data = await healthFetch<GoogleHealthSleepPage>(path, token, signal);
        page++;

        if (data.dataPoints && data.dataPoints.length > 0) {
            allRecords.push(...data.dataPoints);
            onPageData?.(data.dataPoints, allRecords.length, page);
        }

        if (data.nextPageToken) {
            pageToken = data.nextPageToken;
        } else {
            break;
        }
    }

    return allRecords;
}

/**
 * Fetch only sleep records newer than afterDate.
 *
 * Note: this currently relies on a filter query string; adjust if the API semantics differ.
 */
export async function fetchNewSleepRecords(
    token: string,
    afterDate: string,
    onPageData?: (pageRecords: GoogleHealthSleepDataPoint[], totalSoFar: number, page: number) => void,
    signal?: AbortSignal
): Promise<GoogleHealthSleepDataPoint[]> {
    const allRecords: GoogleHealthSleepDataPoint[] = [];
    let page = 0;
    let pageToken = "";

    while (true) {
        if (signal?.aborted) break;

        const query = new URLSearchParams();
        if (pageToken) {
            query.set("pageToken", pageToken);
        }
        if (afterDate) {
            query.set("filter", `sleep.interval.end_time >= "${new Date(afterDate).toISOString()}"`);
        }

        const path = `/users/me/dataTypes/sleep/dataPoints?${query.toString()}`;
        const data = await healthFetch<GoogleHealthSleepPage>(path, token, signal);
        page++;

        if (data.dataPoints && data.dataPoints.length > 0) {
            allRecords.push(...data.dataPoints);
            onPageData?.(data.dataPoints, allRecords.length, page);
        }

        if (data.nextPageToken) {
            pageToken = data.nextPageToken;
        } else {
            break;
        }
    }

    return allRecords;
}
