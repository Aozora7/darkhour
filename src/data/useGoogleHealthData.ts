import { useState, useCallback, useRef } from "react";
import { useSleepData } from "./useSleepData";
import { fetchAllSleepRecords, fetchNewSleepRecords } from "../api/googlehealth/api";
import { getCachedRecords, getLatestDateOfSleep, putRecords, clearUserCache } from "../api/googlehealth/cache";
import type { GoogleHealthSleepDataPoint } from "../api/googlehealth/types";
import { parseGoogleHealthDataPoints } from "../api/googlehealth/parse";
import type { SleepRecord } from "../api/types";

export interface GoogleHealthDataState {
    records: SleepRecord[];
    loading: boolean;
    error: string | null;
    fetching: boolean;
    fetchProgress: string;
    startFetch: (token: string, userId: string) => void;
    stopFetch: () => void;
    importFromFiles: (files: File[]) => Promise<void>;
    exportToFile: () => void;
    clearCache: (userId: string) => Promise<void>;
    reset: () => void;
}

export function useGoogleHealthData(): GoogleHealthDataState {
    const { records, loading, error, setRecords, appendRecords, importFromFiles } = useSleepData();
    const [fetching, setFetching] = useState(false);
    const [fetchProgress, setFetchProgress] = useState("");

    const rawRecordsRef = useRef<GoogleHealthSleepDataPoint[]>([]);
    const fetchAbortRef = useRef<AbortController | null>(null);

    const startFetch = useCallback(
        async (token: string, userId: string) => {
            const abortController = new AbortController();
            fetchAbortRef.current = abortController;
            setFetching(true);
            setFetchProgress("Loading cached data...");

            const newRawRecords: GoogleHealthSleepDataPoint[] = [];

            try {
                const cachedRaw = await getCachedRecords(userId);
                if (cachedRaw.length > 0) {
                    rawRecordsRef.current = [...cachedRaw];
                    const parsed = parseGoogleHealthDataPoints(cachedRaw);
                    setRecords(parsed);
                    setFetchProgress(`Loaded ${cachedRaw.length} cached records. Checking for new data...`);
                } else {
                    rawRecordsRef.current = [];
                    setRecords([]);
                    setFetchProgress("Starting...");
                }

                const latestDate = await getLatestDateOfSleep(userId);

                const onPageData = (pageRecords: GoogleHealthSleepDataPoint[], totalSoFar: number, page: number) => {
                    rawRecordsRef.current.push(...pageRecords);
                    newRawRecords.push(...pageRecords);
                    const parsed = parseGoogleHealthDataPoints(pageRecords);
                    appendRecords(parsed);
                    setFetchProgress(
                        latestDate
                            ? `Page ${page}: ${totalSoFar} new records...`
                            : `Page ${page}: ${totalSoFar} records...`
                    );
                };

                if (latestDate) {
                    await fetchNewSleepRecords(token, latestDate, onPageData, abortController.signal);
                } else {
                    await fetchAllSleepRecords(token, onPageData, abortController.signal);
                }

                if (newRawRecords.length > 0) {
                    setFetchProgress(
                        `Done: ${rawRecordsRef.current.length} total records (${newRawRecords.length} new)`
                    );
                } else if (cachedRaw.length > 0) {
                    setFetchProgress(`Up to date: ${rawRecordsRef.current.length} records`);
                } else {
                    setFetchProgress(`Done: ${rawRecordsRef.current.length} records loaded`);
                }
            } catch (err: unknown) {
                if (err instanceof DOMException && err.name === "AbortError") {
                    setFetchProgress(`Stopped: ${rawRecordsRef.current.length} records kept`);
                } else {
                    setFetchProgress(`Error: ${err instanceof Error ? err.message : "Fetch failed"}`);
                }
            } finally {
                setFetching(false);
                fetchAbortRef.current = null;

                if (newRawRecords.length > 0) {
                    putRecords(userId, newRawRecords).catch((err: unknown) =>
                        console.warn("[googlehealthCache] Failed to write new records:", err)
                    );
                }
            }
        },
        [appendRecords, setRecords]
    );

    const stopFetch = useCallback(() => {
        fetchAbortRef.current?.abort();
    }, []);

    const exportToFile = useCallback(() => {
        const exportData = rawRecordsRef.current.length > 0 ? { sleep: rawRecordsRef.current } : { sleep: records };
        const json = JSON.stringify(exportData, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `googlehealth-sleep-export-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }, [records]);

    const clearCache = useCallback(
        async (userId: string) => {
            await clearUserCache(userId);
            rawRecordsRef.current = [];
            setRecords([]);
            setFetchProgress("");
        },
        [setRecords]
    );

    const reset = useCallback(() => {
        rawRecordsRef.current = [];
        setRecords([]);
        setFetchProgress("");
    }, [setRecords]);

    return {
        records,
        loading,
        error,
        fetching,
        fetchProgress,
        startFetch,
        stopFetch,
        importFromFiles,
        exportToFile,
        clearCache,
        reset,
    };
}
