/**
 * A time interval from the Google Health API.
 *
 * Depending on the data type and endpoint, timestamps arrive either **zone-less**
 * (`"2022-05-13 22:23:30"`, seen on `sleep` in practice) or already carrying a
 * designator (`"2026-03-03T20:57:30Z"`). Passing a zone-less value straight to
 * `new Date()` makes the engine guess using the browser's zone, so the paired
 * `*UtcOffset` protobuf `Duration` fields are the authoritative record of the
 * zone the data was captured in and must always be read alongside them.
 */
export interface SessionTimeInterval {
    startTime: string;
    /** Protobuf Duration, e.g. `"10800s"` for UTC+3. Absent on some responses. */
    startUtcOffset?: string;
    endTime: string;
    endUtcOffset?: string;
    /** Civil (subject's local) start, as returned by newer endpoints. */
    civilStartTime?: GoogleHealthCivilTime;
    civilEndTime?: GoogleHealthCivilTime;
}

/** Date + time on the subject's own clock, independent of location. */
export interface GoogleHealthCivilTime {
    date?: { year: number; month: number; day: number };
    time?: { hours?: number; minutes?: number; seconds?: number };
}

export interface GoogleHealthSleepStage {
    startTime: string;
    startUtcOffset?: string;
    endTime: string;
    endUtcOffset?: string;
    type: "AWAKE" | "LIGHT" | "DEEP" | "REM" | "OUT_OF_BED" | string;
    createTime?: string;
    updateTime?: string;
}

export interface GoogleHealthSleepStageSummary {
    type: string;
    minutes: string;
    count?: string;
}

/**
 * How a data point was recorded.
 *
 * Documented values: `RECORDING_METHOD_UNSPECIFIED`, `MANUAL` (entered by the
 * user), `PASSIVELY_MEASURED`, `ACTIVELY_MEASURED`, `DERIVED` (e.g. by a backend
 * algorithm), `UNKNOWN` (uploaded by a third-party app that didn't say).
 */
export type GoogleHealthRecordingMethod =
    | "RECORDING_METHOD_UNSPECIFIED"
    | "MANUAL"
    | "PASSIVELY_MEASURED"
    | "ACTIVELY_MEASURED"
    | "DERIVED"
    | "UNKNOWN"
    | string;

/**
 * Which platform uploaded the data point.
 *
 * Documented values: `PLATFORM_UNSPECIFIED`, `FITBIT`, `HEALTH_CONNECT`,
 * `HEALTH_KIT`, `FIT`, `FITBIT_WEB_API`, `NEST`, `GOOGLE_WEB_API`,
 * `GOOGLE_PARTNER_INTEGRATION`. The API may add more, so treat unknown values
 * gracefully rather than exhaustively.
 */
export type GoogleHealthPlatform =
    | "PLATFORM_UNSPECIFIED"
    | "FITBIT"
    | "HEALTH_CONNECT"
    | "HEALTH_KIT"
    | "FIT"
    | "FITBIT_WEB_API"
    | "NEST"
    | "GOOGLE_WEB_API"
    | "GOOGLE_PARTNER_INTEGRATION"
    | string;

/** Provenance of a data point — where the record was captured. */
export interface GoogleHealthDataSource {
    recordingMethod?: GoogleHealthRecordingMethod;
    device?: { manufacturer?: string; displayName?: string; formFactor?: string };
    application?: { packageName?: string; webClientId?: string; googleWebClientId?: string };
    platform?: GoogleHealthPlatform;
}

/**
 * Reduce a data point's provenance to the questions that actually matter for
 * sleep analysis.
 *
 * The two axes are orthogonal: `recordingMethod` says *how* the value was
 * captured, `platform` says *where* it was uploaded from. A sleep can be
 * `MANUAL` on `FITBIT` (typed into the Fitbit app) just as easily as `MANUAL` on
 * `HEALTH_CONNECT`, so neither field alone answers "Health Connect or manual?".
 */
export interface RecordProvenance {
    /** `recordingMethod === MANUAL` — the user entered this by hand. */
    manuallyLogged: boolean;
    /** Arrived via Android Health Connect. */
    fromHealthConnect: boolean;
    /** Captured by a physical device rather than entered by hand. */
    fromDevice: boolean;
    recordingMethod?: string;
    platform?: string;
    deviceName?: string;
    packageName?: string;
}

export function recordProvenance(dp: GoogleHealthSleepDataPoint): RecordProvenance {
    const src = dp.dataSource ?? {};
    const deviceName = src.device?.displayName || undefined;

    return {
        manuallyLogged: src.recordingMethod === "MANUAL",
        fromHealthConnect: src.platform === "HEALTH_CONNECT",
        fromDevice: src.recordingMethod !== undefined && src.recordingMethod !== "MANUAL" && Boolean(deviceName),
        recordingMethod: src.recordingMethod,
        platform: src.platform,
        deviceName,
        packageName: src.application?.packageName || undefined,
    };
}

export interface GoogleHealthSleep {
    interval: SessionTimeInterval;
    type: "STAGES" | "CLASSIC" | string;
    stages?: GoogleHealthSleepStage[];
    summary?: {
        minutesAsleep?: string;
        minutesAwake?: string;
        minutesInSleepPeriod?: string;
        minutesAfterWakeUp?: string;
        minutesToFallAsleep?: string;
        stagesSummary?: GoogleHealthSleepStageSummary[];
    };
    /**
     * How the sleep was processed.
     *
     * `mainSleep` is the authoritative flag for "is this the main sleep episode";
     * the Endpoints guide's sample payload spells it `main`, so both are accepted.
     * `manuallyEdited` marks a sleep that was autodetected and *then* edited —
     * distinct from `recordingMethod === MANUAL`, which is a hand-created record.
     */
    metadata?: {
        stagesStatus?: string;
        processed?: boolean;
        /** The longest sleep session with stages within one day; one per day. */
        mainSleep?: boolean;
        /** Seen in API sample payloads as `main`. */
        main?: boolean;
        /** Sleeps without stages and of relatively short duration. */
        nap?: boolean;
        manuallyEdited?: boolean;
        externalId?: string;
    };
    isMainSleep?: boolean;
    createTime?: string;
    updateTime?: string;
}

/**
 * A sleep data point.
 *
 * The `reconcile` endpoint documents its identifier as `dataPointName` while
 * `list` uses `name`; responses have been seen both ways, so consumers must go
 * through {@link dataPointId} rather than reading one field directly.
 */
export interface GoogleHealthSleepDataPoint {
    name?: string;
    dataPointName?: string;
    dataSource?: GoogleHealthDataSource;
    sleep: GoogleHealthSleep;
}

export interface GoogleHealthSleepPage {
    dataPoints: GoogleHealthSleepDataPoint[];
    nextPageToken?: string;
}

/** Resolve the resource identifier across the `name` / `dataPointName` variants. */
export function dataPointId(dp: GoogleHealthSleepDataPoint): string | undefined {
    return dp.dataPointName || dp.name || undefined;
}
