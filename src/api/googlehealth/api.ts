import { healthFetch } from "./googlehealth";
import {
    dataPointId,
    dataSourceFamilyResource,
    type DataSourceFamilyId,
    type GoogleHealthSleepDataPoint,
    type GoogleHealthSleepPage,
} from "./types";

/**
 * The `reconcile` endpoint resolves overlapping intervals across sync batches and
 * recording devices, returning one authoritative record per interval.
 *
 * Connected devices re-bucket telemetry on-device before re-uploading, so `list`
 * can return records whose intervals overlap (e.g. `10:00-10:14:59` alongside
 * `10:14-10:28:59`). Rendering those directly double-counts sleep and confuses
 * the actogram, whereas reconciliation — which this app needs, since it draws a
 * sleep timeline — yields a single continuous stream.
 *
 * @see https://developers.google.com/health/data-management#interval-timestamps
 */
const RECONCILE_PATH = "/users/me/dataTypes/sleep/dataPoints:reconcile";

/** `sleep` is one of the data types capped at 25 results per page. */
const PAGE_SIZE = 25;

export type OnPageData = (pageRecords: GoogleHealthSleepDataPoint[], totalSoFar: number, page: number) => void;

/**
 * Normalize the identifier field.
 *
 * `list` returns `name`; the documented `reconcile` response uses `dataPointName`.
 * Everything downstream (logId derivation, the IndexedDB `keyPath`) relies on a
 * single `name`, so reconcile pages are normalized on the way in.
 */
function normalizeDataPoints(points: GoogleHealthSleepDataPoint[]): GoogleHealthSleepDataPoint[] {
    return points.map((dp) => {
        const id = dataPointId(dp);
        if (id === undefined || dp.name === id) return dp;
        // Drop the variant we don't use so a round-trip through JSON is stable.
        const normalized: GoogleHealthSleepDataPoint = { ...dp, name: id };
        delete normalized.dataPointName;
        return normalized;
    });
}

async function fetchPaged(
    token: string,
    filter: string | undefined,
    family: DataSourceFamilyId | undefined,
    onPageData: OnPageData | undefined,
    signal: AbortSignal | undefined
): Promise<GoogleHealthSleepDataPoint[]> {
    const allRecords: GoogleHealthSleepDataPoint[] = [];
    let page = 0;
    let pageToken = "";

    while (true) {
        if (signal?.aborted) break;

        const query = new URLSearchParams();
        if (pageToken) query.set("pageToken", pageToken);
        query.set("pageSize", String(PAGE_SIZE));
        if (filter) query.set("filter", filter);
        // Omitting the parameter selects the server default (`all-sources`), which
        // is what we want for the default setting — sending it explicitly for a
        // family the account has no access to would fail the request.
        if (family && family !== "all-sources") {
            query.set("dataSourceFamily", dataSourceFamilyResource(family));
        }

        const data = await healthFetch<GoogleHealthSleepPage>(`${RECONCILE_PATH}?${query.toString()}`, token, signal);
        page++;

        const pageRecords = normalizeDataPoints(data.dataPoints ?? []);
        if (pageRecords.length > 0) {
            allRecords.push(...pageRecords);
            onPageData?.(pageRecords, allRecords.length, page);
        }

        if (data.nextPageToken) {
            pageToken = data.nextPageToken;
        } else {
            break;
        }
    }

    return allRecords;
}

/** Fetch every reconciled sleep record. Paginates until exhausted. */
export async function fetchAllSleepRecords(
    token: string,
    family?: DataSourceFamilyId,
    onPageData?: OnPageData,
    signal?: AbortSignal
): Promise<GoogleHealthSleepDataPoint[]> {
    return fetchPaged(token, undefined, family, onPageData, signal);
}

/**
 * Fetch reconciled sleep records whose session ends on or after `afterDate`.
 *
 * `afterDate` is a `YYYY-MM-DD` calendar day in the subject's *recorded* zone
 * (see `SleepRecord.startTimeOffsetMinutes`), which is why this filters on civil
 * time rather than physical UTC time. Pairing a local day with a UTC boundary
 * would skip sessions that end shortly after local midnight but before UTC
 * midnight, silently dropping up to a day of data at each watermark advance.
 *
 * Only `>=` and `<` comparators are supported, and `sleep` exposes
 * `interval.end_time` / `interval.civil_end_time` — not `start_time`.
 *
 * The watermark is only meaningful within one `family`, so callers must pass the
 * same family the cached records were fetched under.
 */
export async function fetchNewSleepRecords(
    token: string,
    afterDate: string,
    family?: DataSourceFamilyId,
    onPageData?: OnPageData,
    signal?: AbortSignal
): Promise<GoogleHealthSleepDataPoint[]> {
    const filter = afterDate ? `sleep.interval.civil_end_time >= "${afterDate}"` : undefined;
    return fetchPaged(token, filter, family, onPageData, signal);
}
