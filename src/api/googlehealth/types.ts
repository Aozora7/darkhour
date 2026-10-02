/**
 * A time interval from the Google Health API.
 *
 * `startTime`/`endTime` are **zone-less wall-clock** strings (`"2022-05-13
 * 22:23:30"`) — passing them straight to `new Date()` makes the engine guess
 * using the browser's zone. The paired `*UtcOffset` fields are protobuf
 * `Duration` strings (`"10800s"`) and are the only record of the zone the data
 * was captured in, so they must always be read alongside the timestamps.
 */
export interface SessionTimeInterval {
    startTime: string;
    /** Protobuf Duration, e.g. `"10800s"` for UTC+8. Absent on some responses. */
    startUtcOffset?: string;
    endTime: string;
    endUtcOffset?: string;
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
}

export interface GoogleHealthSleep {
    interval: SessionTimeInterval;
    type: "STAGES" | "CLASSIC" | string;
    stages?: GoogleHealthSleepStage[];
    summary?: {
        minutesAsleep?: string;
        minutesAwake?: string;
        stagesSummary?: GoogleHealthSleepStageSummary[];
    };
    isMainSleep?: boolean;
}

export interface GoogleHealthSleepDataPoint {
    name: string;
    dataSource?: string;
    sleep: GoogleHealthSleep;
}

export interface GoogleHealthSleepPage {
    dataPoints: GoogleHealthSleepDataPoint[];
    nextPageToken?: string;
}
