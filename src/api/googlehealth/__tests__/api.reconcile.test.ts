import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Endpoint/URL construction is pure string work, so we stub `fetch` and assert
 * on the URLs the app requests plus how it paginates.
 */
const fetchMock = vi.fn();

beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, ok = true, status = 200) {
    return {
        ok,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
    };
}

const sleepDp = (id: string, startTime: string, endTime: string) => ({
    dataPointName: `users/1/dataTypes/sleep/dataPoints/${id}`,
    sleep: {
        interval: { startTime, startUtcOffset: "0s", endTime, endUtcOffset: "0s" },
        type: "STAGES",
    },
});

async function importApi() {
    return await import("../api");
}

describe("reconcile endpoint", () => {
    it("targets the :reconcile path, not list", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ dataPoints: [], nextPageToken: "" }));
        const { fetchAllSleepRecords } = await importApi();

        await fetchAllSleepRecords("token");

        const url = new URL(fetchMock.mock.calls[0]![0] as string);
        expect(url.pathname).toBe("/v4/users/me/dataTypes/sleep/dataPoints:reconcile");
    });

    it("requests the sleep data type page size cap of 25", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ dataPoints: [], nextPageToken: "" }));
        const { fetchAllSleepRecords } = await importApi();

        await fetchAllSleepRecords("token");

        expect(new URL(fetchMock.mock.calls[0]![0] as string).searchParams.get("pageSize")).toBe("25");
    });

    it("sends no filter for a full fetch", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ dataPoints: [], nextPageToken: "" }));
        const { fetchAllSleepRecords } = await importApi();

        await fetchAllSleepRecords("token");

        expect(new URL(fetchMock.mock.calls[0]![0] as string).searchParams.has("filter")).toBe(false);
    });

    it("follows nextPageToken and reports each page", async () => {
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ dataPoints: [sleepDp("1", "a", "b")], nextPageToken: "tok" }))
            .mockResolvedValueOnce(jsonResponse({ dataPoints: [sleepDp("2", "c", "d")], nextPageToken: "" }));
        const { fetchAllSleepRecords } = await importApi();

        const seen: Array<[number, number]> = [];
        const records = await fetchAllSleepRecords("token", "all-sources", (_page, total, page) =>
            seen.push([total, page])
        );

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(new URL(fetchMock.mock.calls[1]![0] as string).searchParams.get("pageToken")).toBe("tok");
        expect(records).toHaveLength(2);
        expect(seen).toEqual([
            [1, 1],
            [2, 2],
        ]);
    });

    it("stops on abort instead of requesting another page", async () => {
        const controller = new AbortController();
        fetchMock.mockImplementation(async () => {
            controller.abort();
            return jsonResponse({ dataPoints: [sleepDp("1", "a", "b")], nextPageToken: "tok" });
        });
        const { fetchAllSleepRecords } = await importApi();

        await fetchAllSleepRecords("token", "all-sources", undefined, controller.signal);

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("normalizes dataPointName to name", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ dataPoints: [sleepDp("12345", "a", "b")], nextPageToken: "" }));
        const { fetchAllSleepRecords } = await importApi();

        const [record] = await fetchAllSleepRecords("token");

        expect(record!.name).toBe("users/1/dataTypes/sleep/dataPoints/12345");
        expect(record).not.toHaveProperty("dataPointName");
    });

    it("preserves an existing name untouched", async () => {
        const dp = { name: "users/1/dataTypes/sleep/dataPoints/9", sleep: sleepDp("9", "a", "b").sleep };
        fetchMock.mockResolvedValue(jsonResponse({ dataPoints: [dp], nextPageToken: "" }));
        const { fetchAllSleepRecords } = await importApi();

        const [record] = await fetchAllSleepRecords("token");

        expect(record!.name).toBe("users/1/dataTypes/sleep/dataPoints/9");
    });

    it("surfaces API errors", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ error: "nope" }, false, 400));
        const { fetchAllSleepRecords } = await importApi();

        await expect(fetchAllSleepRecords("token")).rejects.toThrow(/400/);
    });
});

describe("incremental filter", () => {
    it("filters on civil end time, not physical time", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ dataPoints: [], nextPageToken: "" }));
        const { fetchNewSleepRecords } = await importApi();

        await fetchNewSleepRecords("token", "2024-01-15");

        const filter = new URL(fetchMock.mock.calls[0]![0] as string).searchParams.get("filter");
        expect(filter).toBe('sleep.interval.civil_end_time >= "2024-01-15"');
    });

    it("uses a supported comparator and supported field", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ dataPoints: [], nextPageToken: "" }));
        const { fetchNewSleepRecords } = await importApi();

        await fetchNewSleepRecords("token", "2024-01-15");

        const filter = new URL(fetchMock.mock.calls[0]![0] as string).searchParams.get("filter")!;
        // Only >= and < are accepted, and `sleep` exposes end_time fields only.
        expect(filter).toMatch(/^sleep\.interval\.civil_end_time >= /);
        expect(filter).not.toMatch(/start_time/);
        expect(filter).not.toContain("<=");
        // The only comparison operator present is the inclusive lower bound.
        expect(filter.match(/[<>]/g)).toEqual([">"]);
    });

    it("URL-encodes the filter", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ dataPoints: [], nextPageToken: "" }));
        const { fetchNewSleepRecords } = await importApi();

        await fetchNewSleepRecords("token", "2024-01-15");

        const raw = fetchMock.mock.calls[0]![0] as string;
        expect(raw).toContain("%3E%3D");
        expect(raw).not.toContain(">=");
    });

    it("omits the filter when no watermark is supplied", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ dataPoints: [], nextPageToken: "" }));
        const { fetchNewSleepRecords } = await importApi();

        await fetchNewSleepRecords("token", "");

        expect(new URL(fetchMock.mock.calls[0]![0] as string).searchParams.has("filter")).toBe(false);
    });
});

describe("dataSourceFamily", () => {
    const familyParam = () => new URL(fetchMock.mock.calls[0]![0] as string).searchParams.get("dataSourceFamily");

    it("is sent as a full resource URI", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ dataPoints: [], nextPageToken: "" }));
        const { fetchAllSleepRecords } = await importApi();

        await fetchAllSleepRecords("token", "google-wearables");

        // Short identifiers are rejected with 400 INVALID_ARGUMENT.
        expect(familyParam()).toBe("users/me/dataSourceFamilies/google-wearables");
    });

    it("omits the parameter for all-sources, the server default", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ dataPoints: [], nextPageToken: "" }));
        const { fetchAllSleepRecords } = await importApi();

        await fetchAllSleepRecords("token", "all-sources");

        expect(familyParam()).toBeNull();
    });

    it("omits the parameter when no family is given at all", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ dataPoints: [], nextPageToken: "" }));
        const { fetchAllSleepRecords } = await importApi();

        await fetchAllSleepRecords("token");

        expect(familyParam()).toBeNull();
    });

    it("applies to incremental fetches too", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ dataPoints: [], nextPageToken: "" }));
        const { fetchNewSleepRecords } = await importApi();

        await fetchNewSleepRecords("token", "2024-01-15", "google-sources");

        expect(familyParam()).toBe("users/me/dataSourceFamilies/google-sources");
    });

    it("combines with the filter and pagination params", async () => {
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ dataPoints: [], nextPageToken: "tok" }))
            .mockResolvedValueOnce(jsonResponse({ dataPoints: [], nextPageToken: "" }));
        const { fetchNewSleepRecords } = await importApi();

        await fetchNewSleepRecords("token", "2024-01-15", "google-wearables");

        const first = new URL(fetchMock.mock.calls[0]![0] as string).searchParams;
        expect(first.get("dataSourceFamily")).toBe("users/me/dataSourceFamilies/google-wearables");
        expect(first.get("filter")).toBe('sleep.interval.civil_end_time >= "2024-01-15"');
        expect(first.get("pageSize")).toBe("25");

        const second = new URL(fetchMock.mock.calls[1]![0] as string).searchParams;
        expect(second.get("pageToken")).toBe("tok");
        expect(second.get("dataSourceFamily")).toBe("users/me/dataSourceFamilies/google-wearables");
    });
});

describe("family helpers", () => {
    it("scopes the cache per user and family", async () => {
        const { cacheScope } = await import("../types");
        expect(cacheScope("u1", "all-sources")).not.toBe(cacheScope("u1", "google-wearables"));
        expect(cacheScope("u1", "all-sources")).not.toBe(cacheScope("u2", "all-sources"));
        expect(cacheScope("u1", "all-sources")).toBe(cacheScope("u1", "all-sources"));
    });

    it("validates persisted values, falling back for unknown ones", async () => {
        const { isDataSourceFamilyId, DEFAULT_DATA_SOURCE_FAMILY, DATA_SOURCE_FAMILY_OPTIONS } =
            await import("../types");
        expect(DEFAULT_DATA_SOURCE_FAMILY).toBe("all-sources");
        for (const opt of DATA_SOURCE_FAMILY_OPTIONS) {
            expect(isDataSourceFamilyId(opt.id)).toBe(true);
        }
        // A removed option or hand-edited localStorage must not leak through.
        expect(isDataSourceFamilyId("google-everything")).toBe(false);
        expect(isDataSourceFamilyId("")).toBe(false);
        expect(isDataSourceFamilyId(null)).toBe(false);
        expect(isDataSourceFamilyId(42)).toBe(false);
    });

    it("builds resource URIs from the full path form", async () => {
        const { dataSourceFamilyResource } = await import("../types");
        expect(dataSourceFamilyResource("google-sources")).toBe("users/me/dataSourceFamilies/google-sources");
        expect(dataSourceFamilyResource()).toBe("users/me/dataSourceFamilies/all-sources");
    });
});
