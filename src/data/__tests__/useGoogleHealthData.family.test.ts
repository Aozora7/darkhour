// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

/**
 * The cache is partitioned per (user, family). The invariant that matters is that
 * every cache interaction in one fetch — read, watermark lookup and write-back —
 * uses the *same* scope, and that a different family gets a different partition.
 * Mixing those up would skip or duplicate records on incremental fetches.
 */
const cache = {
    getCachedRecords: vi.fn<(scope: string) => Promise<unknown[]>>(),
    getLatestDateOfSleep: vi.fn<(scope: string) => Promise<string | null>>(),
    putRecords: vi.fn<(scope: string, records: unknown[]) => Promise<void>>(),
    clearUserCache: vi.fn<(scope: string) => Promise<void>>(),
};

const api = {
    fetchAllSleepRecords: vi.fn(),
    fetchNewSleepRecords: vi.fn(),
};

vi.mock("../../api/googlehealth/cache", () => cache);
vi.mock("../../api/googlehealth/api", () => api);

const { useGoogleHealthData } = await import("../useGoogleHealthData");
const { cacheScope } = await import("../../api/googlehealth/types");

const sleepDp = (id: number, day: string) => ({
    name: `users/u1/dataTypes/sleep/dataPoints/${id}`,
    sleep: {
        interval: {
            startTime: `${day} 23:00:00`,
            startUtcOffset: "0s",
            endTime: `${day} 23:59:00`,
            endUtcOffset: "0s",
        },
        type: "STAGES",
    },
});

beforeEach(() => {
    vi.clearAllMocks();
    cache.getCachedRecords.mockResolvedValue([]);
    cache.getLatestDateOfSleep.mockResolvedValue(null);
    cache.putRecords.mockResolvedValue();
    cache.clearUserCache.mockResolvedValue();
    api.fetchAllSleepRecords.mockResolvedValue([]);
    api.fetchNewSleepRecords.mockResolvedValue([]);
});

describe("cache scoping by data source family", () => {
    it("reads and writes the same scope on a cold fetch", async () => {
        const { result } = renderHook(() => useGoogleHealthData());

        await act(async () => {
            result.current.startFetch("tok", "u1", "google-wearables");
        });
        await waitFor(() => expect(cache.getCachedRecords).toHaveBeenCalled());

        const scope = cacheScope("u1", "google-wearables");
        expect(cache.getCachedRecords).toHaveBeenCalledWith(scope);
        expect(cache.getLatestDateOfSleep).toHaveBeenCalledWith(scope);
    });

    it("passes the family through to the API on a cold fetch", async () => {
        const { result } = renderHook(() => useGoogleHealthData());

        await act(async () => {
            result.current.startFetch("tok", "u1", "google-sources");
        });
        await waitFor(() => expect(api.fetchAllSleepRecords).toHaveBeenCalled());

        const [token, family] = api.fetchAllSleepRecords.mock.calls[0]!;
        expect(token).toBe("tok");
        expect(family).toBe("google-sources");
    });

    it("writes new records into the scope they were fetched under", async () => {
        cache.getLatestDateOfSleep.mockResolvedValue("2024-01-10");
        api.fetchNewSleepRecords.mockImplementation(async (_t, _d, _f, onPage) => {
            onPage?.([sleepDp(1, "2024-01-11")], 1, 1);
            return [];
        });

        const { result } = renderHook(() => useGoogleHealthData());
        await act(async () => {
            result.current.startFetch("tok", "u1", "google-wearables");
        });
        await waitFor(() => expect(cache.putRecords).toHaveBeenCalled());

        expect(cache.putRecords.mock.calls[0]![0]).toBe(cacheScope("u1", "google-wearables"));
    });

    it("uses the family's own watermark for an incremental fetch", async () => {
        cache.getLatestDateOfSleep.mockImplementation(async (scope) =>
            scope === cacheScope("u1", "google-wearables") ? "2024-02-02" : null
        );

        const { result } = renderHook(() => useGoogleHealthData());
        await act(async () => {
            result.current.startFetch("tok", "u1", "google-wearables");
        });
        await waitFor(() => expect(api.fetchNewSleepRecords).toHaveBeenCalled());

        const [, afterDate, family] = api.fetchNewSleepRecords.mock.calls[0]!;
        expect(afterDate).toBe("2024-02-02");
        expect(family).toBe("google-wearables");
    });

    it("does not reuse another family's watermark", async () => {
        // Scope A has data; scope B is empty, so B must do a full fetch rather
        // than an incremental one seeded with A's watermark.
        cache.getLatestDateOfSleep.mockImplementation(async (scope) =>
            scope === cacheScope("u1", "google-wearables") ? "2024-02-02" : null
        );

        const { result } = renderHook(() => useGoogleHealthData());
        await act(async () => {
            result.current.startFetch("tok", "u1", "all-sources");
        });
        await waitFor(() => expect(api.fetchAllSleepRecords).toHaveBeenCalled());

        expect(api.fetchNewSleepRecords).not.toHaveBeenCalled();
        expect(api.fetchAllSleepRecords.mock.calls[0]![1]).toBe("all-sources");
    });

    it("keeps cached records of different families apart", async () => {
        cache.getCachedRecords.mockImplementation(async (scope) =>
            scope === cacheScope("u1", "google-wearables") ? [sleepDp(1, "2024-01-01")] : []
        );

        const { result } = renderHook(() => useGoogleHealthData());
        await act(async () => {
            result.current.startFetch("tok", "u1", "google-wearables");
        });
        await waitFor(() => expect(result.current.records.length).toBeGreaterThan(0));
        const withWearables = result.current.records.length;

        await act(async () => {
            result.current.reset();
        });
        await act(async () => {
            result.current.startFetch("tok", "u1", "all-sources");
        });
        await waitFor(() => expect(api.fetchAllSleepRecords).toHaveBeenCalled());

        // The all-sources scope has no cache, so its records start empty.
        expect(withWearables).toBeGreaterThan(0);
        expect(result.current.records).toHaveLength(0);
    });

    it("clears only the requested family's partition", async () => {
        const { result } = renderHook(() => useGoogleHealthData());

        await act(async () => {
            await result.current.clearCache("u1", "google-wearables");
        });

        expect(cache.clearUserCache).toHaveBeenCalledWith(cacheScope("u1", "google-wearables"));
        expect(cache.clearUserCache).not.toHaveBeenCalledWith(cacheScope("u1", "all-sources"));
    });
});
