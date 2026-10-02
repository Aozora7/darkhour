/**
 * Circular State-Space Filter Algorithm (csf-v1)
 *
 * Module structure:
 *   index.ts         - Algorithm entry point: analyzeCircadian(), _internals barrel
 *   types.ts         - Types: CSFAnalysis, CSFState, CSFConfig, constants
 *   filter.ts        - Von Mises filter: predict(), update(), forwardPass(), rtsSmoother()
 *   anchors.ts       - Anchor preparation with continuous weight
 *   smoothing.ts     - Output phase smoothing, edge correction
 *   analyzeSegment.ts - Per-segment pipeline: anchors → filter → smoother → output
 *   mergeSegments.ts - Merge CSF segments into single result
 */
import type { SleepRecord } from "../../../api/types";
import type { CSFAnalysis, CSFConfig } from "./types";
import { DEFAULT_CONFIG } from "./types";
import { splitIntoSegments } from "../segments";
import { analyzeSegment } from "./analyzeSegment";
import { mergeSegmentResults, ALGORITHM_ID } from "./mergeSegments";
import { referenceOffset, zonedDayStartMs } from "../../../utils/zonedTime";

export { ALGORITHM_ID };
export type { CSFAnalysis, CSFConfig } from "./types";

export function analyzeCircadian(
    records: SleepRecord[],
    extraDays: number = 0,
    config: CSFConfig = DEFAULT_CONFIG
): CSFAnalysis {
    if (records.length === 0) {
        return mergeSegmentResults([], 0);
    }

    const sorted = [...records].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
    // Anchor every segment to the same day grid, expressed in the dataset's own
    // UTC offset rather than the viewer's.
    const globalOffset = referenceOffset(sorted);
    const globalFirstDateMs = zonedDayStartMs(sorted[0]!.dateOfSleep, globalOffset);
    const segments = splitIntoSegments(sorted);

    const results = segments
        .map((seg) => analyzeSegment(seg, extraDays, globalFirstDateMs, config, globalOffset))
        .filter((r): r is NonNullable<typeof r> => r !== null);

    return mergeSegmentResults(results, globalFirstDateMs, globalOffset);
}

export const _internals = {
    analyzeSegment,
    mergeSegmentResults,
    ALGORITHM_ID,
};
