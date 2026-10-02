import { useRef, useCallback, useState } from "react";
import { useAppContext } from "../useAppContext";
import type { OverlayControlPoint } from "../models/overlayPath";
import { exportActogramPNG } from "../utils/exportPNG";
import { DATA_SOURCE_FAMILY_OPTIONS, type DataSourceFamilyId } from "../api/googlehealth/types";
import {
    RefreshCw,
    Square,
    LogIn,
    LogOut,
    Trash2,
    Upload,
    Download,
    Image,
    Construction,
    ChevronDown,
    Database,
    AlertTriangle,
} from "lucide-react";

export default function DataToolbar() {
    const {
        data,
        auth,
        hasClientId,
        handleFetch,
        dataSourceFamily,
        setDataSourceFamily,
        overlayControlPoints,
        setOverlayControlPoints,
        manualOverlayDays,
        filteredRecords,
        filterStart,
        filterEnd,
        totalDays,
        circadianAnalysis,
        daySpan,
        colorMode,
        showPeriodogram,
    } = useAppContext();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const hasActiveDateFilter = filterStart > 0 || filterEnd < totalDays;

    /**
     * A pending family change. Held rather than applied immediately so we can ask
     * what to do with the records already on screen — they came from the previous
     * family, so they are a different dataset and may be misleading to keep.
     */
    const [pendingFamily, setPendingFamily] = useState<DataSourceFamilyId | null>(null);
    const [switching, setSwitching] = useState(false);

    const hasFetchedData = data.records.length > 0;

    /** Reflects a pending selection so the label updates before it is committed. */
    const activeFamilyOption = DATA_SOURCE_FAMILY_OPTIONS.find((o) => o.id === (pendingFamily ?? dataSourceFamily));

    const confirmFamilyChange = useCallback(
        async (next: DataSourceFamilyId, clearAndRefetch: boolean) => {
            setSwitching(true);
            try {
                // Clear the *previous* partition: that is where the records on
                // screen came from. The new family has its own, untouched cache.
                if (clearAndRefetch && auth.userId) {
                    await data.clearCache(auth.userId, dataSourceFamily);
                }
                setDataSourceFamily(next);
                setPendingFamily(null);
                if (clearAndRefetch && auth.token && auth.userId) {
                    data.startFetch(auth.token, auth.userId, next);
                }
            } finally {
                setSwitching(false);
            }
        },
        [auth.token, auth.userId, data, dataSourceFamily, setDataSourceFamily]
    );

    const handleFileChange = useCallback(
        async (e: React.ChangeEvent<HTMLInputElement>) => {
            const files = e.target.files;
            if (!files || files.length === 0) return;

            const fileArray = Array.from(files).filter((f): f is File => f != null);
            const firstFile = fileArray[0];

            if (firstFile) {
                const text = await firstFile.text();
                const json = JSON.parse(text);

                if (json.controlPoints && Array.isArray(json.controlPoints)) {
                    setOverlayControlPoints(json.controlPoints as OverlayControlPoint[]);
                }
            }

            await data.importFromFiles(fileArray);

            if (fileInputRef.current) fileInputRef.current.value = "";
        },
        [data.importFromFiles, setOverlayControlPoints]
    );

    return (
        <div className="mx-auto mb-4 flex max-w-5xl flex-wrap items-center gap-3">
            {hasClientId && (
                <>
                    {auth.token ? (
                        <>
                            <button
                                onClick={data.fetching ? data.stopFetch : handleFetch}
                                className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm text-white ${
                                    data.fetching ? "bg-red-700 hover:bg-red-600" : "bg-green-700 hover:bg-green-600"
                                }`}
                            >
                                {data.fetching ? (
                                    <Square size={14} strokeWidth={3} />
                                ) : (
                                    <RefreshCw size={14} strokeWidth={3} />
                                )}
                                {data.fetching ? "Stop" : "Fetch"}
                            </button>
                            <button
                                onClick={auth.signOut}
                                className="inline-flex items-center gap-1.5 rounded bg-gray-700 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-600"
                            >
                                <LogOut size={14} strokeWidth={3} />
                                Sign out
                            </button>

                            <details className="relative">
                                <summary
                                    className={`inline-flex cursor-pointer list-none items-center gap-1.5 rounded bg-gray-700 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-600 [&::-webkit-details-marker]:hidden${
                                        switching ? " opacity-50" : ""
                                    }`}
                                    title={activeFamilyOption?.description}
                                >
                                    <Database size={14} strokeWidth={3} />
                                    {activeFamilyOption?.label ?? "Data source"}
                                    <ChevronDown size={14} strokeWidth={3} />
                                </summary>
                                <div className="absolute left-0 z-10 mt-1 min-w-max rounded bg-gray-700 py-1 shadow-lg ring-1 ring-black/20">
                                    {DATA_SOURCE_FAMILY_OPTIONS.map((opt) => (
                                        <button
                                            key={opt.id}
                                            disabled={switching}
                                            onClick={(event) => {
                                                event.currentTarget.closest("details")?.removeAttribute("open");
                                                if (opt.id === dataSourceFamily) return;
                                                // Only worth asking about when something is
                                                // actually on screen to become stale.
                                                setPendingFamily(hasFetchedData ? opt.id : null);
                                                if (!hasFetchedData) setDataSourceFamily(opt.id);
                                            }}
                                            className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-gray-600 disabled:opacity-50 ${
                                                opt.id === dataSourceFamily ? "text-white" : "text-gray-300"
                                            }`}
                                            title={opt.description}
                                        >
                                            {opt.label}
                                            {opt.id === dataSourceFamily && (
                                                <span className="ml-2 text-xs text-gray-400">current</span>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </details>

                            {pendingFamily && (
                                <span className="inline-flex items-center gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-200">
                                    <AlertTriangle size={13} strokeWidth={3} className="shrink-0" />
                                    <span>
                                        {hasFetchedData ? "Cached data is from the previous source." : "Switch source."}
                                    </span>
                                    <button
                                        disabled={switching}
                                        onClick={() => confirmFamilyChange(pendingFamily, true)}
                                        className="rounded bg-amber-600 px-2 py-0.5 font-medium text-white hover:bg-amber-500 disabled:opacity-50"
                                    >
                                        Clear &amp; redownload
                                    </button>
                                    <button
                                        disabled={switching}
                                        onClick={() => confirmFamilyChange(pendingFamily, false)}
                                        className="rounded bg-slate-700 px-2 py-0.5 text-gray-200 hover:bg-slate-600 disabled:opacity-50"
                                    >
                                        Keep
                                    </button>
                                </span>
                            )}

                            {auth.userId && (
                                <button
                                    onClick={() => data.clearCache(auth.userId!, dataSourceFamily)}
                                    className="inline-flex items-center gap-1.5 rounded bg-gray-700 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-600"
                                    title="Discard cached records for this source and re-download them on the next fetch"
                                >
                                    <Trash2 size={14} strokeWidth={3} />
                                    Clear cache
                                </button>
                            )}
                        </>
                    ) : (
                        <button
                            onClick={auth.signIn}
                            disabled={auth.loading}
                            className="inline-flex items-center gap-1.5 rounded bg-blue-700 px-3 py-1.5 text-sm text-white hover:bg-blue-600 disabled:opacity-50"
                        >
                            <LogIn size={14} strokeWidth={3} />
                            {auth.loading ? "Authenticating..." : "Sign in"}
                        </button>
                    )}
                </>
            )}

            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded bg-gray-700 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-600">
                <Download size={14} strokeWidth={3} />
                Import
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    multiple
                    onChange={handleFileChange}
                    className="hidden"
                />
            </label>

            {data.records.length > 0 && !hasActiveDateFilter && (
                <button
                    onClick={() => data.exportToFile()}
                    className="inline-flex items-center gap-1.5 rounded bg-gray-700 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-600"
                >
                    <Upload size={14} strokeWidth={3} />
                    Export
                </button>
            )}

            {data.records.length > 0 && hasActiveDateFilter && (
                <details className="relative">
                    <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded bg-gray-700 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-600 [&::-webkit-details-marker]:hidden">
                        <Upload size={14} strokeWidth={3} />
                        Export
                        <ChevronDown size={14} strokeWidth={3} />
                    </summary>
                    <div className="absolute z-10 mt-1 min-w-max rounded bg-gray-700 py-1 shadow-lg ring-1 ring-black/20">
                        <button
                            onClick={(event) => {
                                data.exportToFile();
                                event.currentTarget.closest("details")?.removeAttribute("open");
                            }}
                            className="block w-full px-3 py-1.5 text-left text-sm text-gray-300 hover:bg-gray-600"
                        >
                            Export all data
                        </button>
                        <button
                            onClick={(event) => {
                                data.exportToFile(filteredRecords);
                                event.currentTarget.closest("details")?.removeAttribute("open");
                            }}
                            className="block w-full px-3 py-1.5 text-left text-sm text-gray-300 hover:bg-gray-600"
                        >
                            Export filtered data
                        </button>
                    </div>
                </details>
            )}

            {data.records.length > 0 && (
                <button
                    onClick={() =>
                        exportActogramPNG(
                            {
                                recordCount: filteredRecords.length,
                                tau: circadianAnalysis.tau,
                                drift: circadianAnalysis.dailyDrift,
                                rSquared: circadianAnalysis.rSquared,
                                daySpan,
                                algorithmId: circadianAnalysis.algorithmId,
                                colorMode,
                            },
                            { includePeriodogram: showPeriodogram }
                        )
                    }
                    className="inline-flex items-center gap-1.5 rounded bg-gray-700 px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-600"
                >
                    <Image size={14} strokeWidth={3} />
                    Save PNG
                </button>
            )}

            {filteredRecords.length > 0 && overlayControlPoints.length > 0 && (
                <button
                    onClick={() => {
                        const exportData = {
                            sleep: filteredRecords,
                            overlay: manualOverlayDays,
                            controlPoints: overlayControlPoints,
                        };
                        const json = JSON.stringify(exportData, null, 2);
                        const blob = new Blob([json], { type: "application/json" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `sleep-overlay-${new Date().toISOString().slice(0, 10)}.json`;
                        a.click();
                        URL.revokeObjectURL(url);
                    }}
                    className="inline-flex items-center gap-1.5 rounded bg-cyan-800 px-3 py-1.5 text-sm text-gray-200 hover:bg-cyan-700"
                >
                    <Construction size={14} strokeWidth={3} />
                    Export overlay
                </button>
            )}

            {data.fetchProgress && <span className="text-xs text-gray-500">{data.fetchProgress}</span>}
        </div>
    );
}
