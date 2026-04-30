export interface SessionTimeInterval {
    startTime: string;
    endTime: string;
}

export interface GoogleHealthSleepStage {
    startTime: string;
    endTime: string;
    type: "AWAKE" | "LIGHT" | "DEEP" | "REM" | "OUT_OF_BED" | string;
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
    sleep: GoogleHealthSleep;
}

export interface GoogleHealthSleepPage {
    dataPoints: GoogleHealthSleepDataPoint[];
    nextPageToken?: string;
}
