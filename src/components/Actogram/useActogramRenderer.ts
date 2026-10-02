import { useEffect, useRef, useCallback } from "react";
import { scaleLinear } from "d3-scale";
import type { ActogramRow } from "../../models/actogramData";
import { type CircadianDay } from "../../models/circadian";
import type { SleepLevelEntry } from "../../api/types";
import type { ScheduleEntry } from "../../AppContextDef";
import type { OverlayDay } from "../../models/overlayPath";
import {
    MS_PER_DAY,
    MS_PER_HOUR,
    MS_PER_MINUTE,
    browserOffsetMinutes,
    zonedDateStr,
    zonedDayStartMs,
    zonedParts,
} from "../../utils/zonedTime";

export type ColorMode = "stages" | "quality";

export interface ActogramConfig {
    doublePlot: boolean;
    rowHeight: number;
    colorMode: ColorMode;
    tauHours: number;
    leftMargin: number;
    topMargin: number;
    rightMargin: number;
    bottomMargin: number;
    showSchedule?: boolean;
    scheduleEntries?: ScheduleEntry[];
    sortDirection?: "newest" | "oldest";
    showDateLabels?: boolean; // default true
    /**
     * UTC offset (minutes east) of the frame the rows are drawn in. Day boundaries,
     * schedule blocks and tooltips all resolve in this zone so the plot never
     * contradicts itself when opened from a different one.
     */
    offsetMinutes?: number;
}

const DEFAULT_CONFIG: ActogramConfig = {
    doublePlot: false,
    rowHeight: 12,
    colorMode: "stages",
    tauHours: 24,
    leftMargin: 80,
    topMargin: 30,
    rightMargin: 16,
    bottomMargin: 20,
};

const COLORS = {
    // v1.2 stage colors
    deep: "#1e40af",
    light: "#60a5fa",
    rem: "#06b6d4",
    wake: "#ef4444",
    // UI colors
    background: "#1e293b",
    grid: "#334155",
    text: "#94a3b8",
};

/** Format an instant as `HH:MM` on the clock of the given UTC offset. */
function formatClock(instantMs: number, offsetMinutes: number): string {
    const { hour, minute } = zonedParts(instantMs, offsetMinutes);
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Recover the frame the rows were built in.
 *
 * A calendar row's `startMs` is midnight of its own `date` in the reference
 * offset, so the difference between the two recovers that offset exactly. This
 * keeps the renderer consistent with the row builder without threading an extra
 * prop through the component tree.
 */
function inferOffsetFromRows(rows: ActogramRow[]): number | undefined {
    const row = rows.find((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date));
    if (!row) return undefined;
    const offset = (zonedDayStartMs(row.date, 0) - row.startMs) / MS_PER_MINUTE;
    return Number.isFinite(offset) ? offset : undefined;
}

/** Map v1.2 stage level to color */
function stageColor(level: string): string {
    switch (level) {
        case "deep":
            return COLORS.deep;
        case "light":
            return COLORS.light;
        case "rem":
            return COLORS.rem;
        case "wake":
            return COLORS.wake;
        default:
            return COLORS.light;
    }
}

/** Map quality score (0–1) to a red→yellow→green gradient color */
function qualityColor(score: number): string {
    //using range from 50 to 100
    const scaled = Math.max(0, score - 0.5) * 2;
    const s = Math.max(0, Math.min(1, scaled));
    // 0 → red (0°), 0.5 → yellow (60°), 1.0 → green (120°)
    const hue = s * 120;
    return `hsl(${hue}, 75%, 45%)`;
}

/** Format fractional hour (e.g. 23.5) as "23:30" */
function formatHour(h: number): string {
    const hr = Math.floor(((h % 24) + 24) % 24);
    const min = Math.round((h - Math.floor(h)) * 60);
    return String(hr).padStart(2, "0") + ":" + String(min).padStart(2, "0");
}

export function useActogramRenderer(
    rows: ActogramRow[],
    circadian: CircadianDay[],
    config: Partial<ActogramConfig> = {},
    options: {
        manualOverlayDays?: OverlayDay[];
        overlayEditMode?: boolean;
        editorDraw?: (ctx: CanvasRenderingContext2D, xScale: (h: number) => number, plotTop: number) => void;
        canvasRef?: React.RefObject<HTMLCanvasElement | null>;
    } = {}
) {
    const internalRef = useRef<HTMLCanvasElement>(null);
    const canvasRef = options.canvasRef ?? internalRef;
    const cfg = { ...DEFAULT_CONFIG, ...config };
    const offsetMinutes = cfg.offsetMinutes ?? inferOffsetFromRows(rows) ?? browserOffsetMinutes();
    const tauMode = cfg.tauHours !== 24;
    const baseHours = tauMode ? cfg.tauHours : 24;
    const hoursPerRow = cfg.doublePlot ? baseHours * 2 : baseHours;
    const newestFirst = cfg.sortDirection !== "oldest";
    const nextDayOffset = newestFirst ? -1 : 1;
    // Adjust left margin based on label visibility and mode
    if (cfg.showDateLabels === true && cfg.leftMargin === DEFAULT_CONFIG.leftMargin && !tauMode) {
        cfg.leftMargin = 70;
    }
    if (tauMode && cfg.leftMargin === DEFAULT_CONFIG.leftMargin) {
        // Wider left margin for tau mode labels ("YYYY-MM-DD HH:mm")
        cfg.leftMargin = 110;
    }

    const getTooltipInfo = useCallback(
        (canvasX: number, canvasY: number): Record<string, string> | null => {
            const dpr = window.devicePixelRatio || 1;
            const x = canvasX * dpr;
            const y = canvasY * dpr;

            const plotWidth = (canvasRef.current?.width ?? 0) / 1 - cfg.leftMargin * dpr - cfg.rightMargin * dpr;
            const rowIdx = Math.floor((y - cfg.topMargin * dpr) / (cfg.rowHeight * dpr));

            if (rowIdx < 0 || rowIdx >= rows.length) return null;
            const row = rows[rowIdx]!;

            const xScale = scaleLinear()
                .domain([0, hoursPerRow])
                .range([cfg.leftMargin * dpr, cfg.leftMargin * dpr + plotWidth]);
            const hour = xScale.invert(x);

            // Find block at this hour
            // In double-plot mode, the right half shows the next day's data
            const blocksToCheck: { block: (typeof row.blocks)[0]; offset: number; sourceRow: typeof row }[] = [];
            for (const block of row.blocks) {
                blocksToCheck.push({ block, offset: 0, sourceRow: row });
            }
            if (cfg.doublePlot) {
                const nextIdx = rowIdx + nextDayOffset;
                if (nextIdx >= 0 && nextIdx < rows.length) {
                    const nextDayRow = rows[nextIdx]!;
                    for (const block of nextDayRow.blocks) {
                        blocksToCheck.push({ block, offset: baseHours, sourceRow: nextDayRow });
                    }
                }
            }

            for (const { block, offset, sourceRow } of blocksToCheck) {
                if (hour >= block.startHour + offset && hour <= block.endHour + offset) {
                    const rec = block.record;
                    // Report the clock the data was recorded on — the same frame the
                    // block is drawn in — rather than the viewer's local time.
                    const startOffset = rec.startTimeOffsetMinutes ?? offsetMinutes;
                    const endOffset = rec.endTimeOffsetMinutes ?? startOffset;
                    const info: Record<string, string> = {
                        date: sourceRow.date,
                        start: formatClock(rec.startTime.getTime(), startOffset),
                        end: formatClock(rec.endTime.getTime(), endOffset),
                        duration: rec.durationHours.toFixed(1) + "h",
                        efficiency: rec.efficiency + "%",
                    };
                    if (rec.stages) {
                        const s = rec.stages;
                        info.stages = `D:${s.deep} L:${s.light} R:${s.rem} W:${s.wake}min`;
                    }
                    info.quality = ((rec.sleepScore || 0) * 100).toFixed(0) + "%";
                    return info;
                }
            }
            // Check if hovering over circadian overlay
            const circadianMap = new Map<string, CircadianDay>();
            for (const cd of circadian) circadianMap.set(cd.date, cd);
            // In tau mode, row.date may include time — extract just the date part for lookup
            const rowDateKey = row.date.slice(0, 10);
            const cd = circadianMap.get(rowDateKey);
            if (cd && !cd.isGap) {
                if (tauMode && row.startMs != null) {
                    // In tau mode, compute overlay position relative to row start
                    const nightStartAbsH = ((cd.nightStartHour % 24) + 24) % 24;
                    const nightEndAbsH = ((cd.nightEndHour % 24) + 24) % 24;
                    const rowStartAbsH = (row.startMs % 86_400_000) / 3_600_000;
                    let ns = nightStartAbsH - rowStartAbsH;
                    let ne = nightEndAbsH - rowStartAbsH;
                    // Wrap into [0, baseHours) approximately
                    while (ns < -baseHours / 2) ns += 24;
                    while (ns > baseHours + 12) ns -= 24;
                    while (ne < ns) ne += 24;
                    const h = hour % baseHours;
                    const inOverlay = h >= ns && h <= ne;
                    if (inOverlay) {
                        return {
                            date: row.date,
                            "circadian night": formatHour(nightStartAbsH) + " – " + formatHour(nightEndAbsH),
                            "local τ": cd.localTau.toFixed(2) + "h",
                            confidence: cd.confidence,
                            ...(cd.isForecast ? { type: "predicted" } : {}),
                        };
                    }
                } else {
                    const nightStart = ((cd.nightStartHour % 24) + 24) % 24;
                    const nightEnd = ((cd.nightEndHour % 24) + 24) % 24;
                    const h = ((hour % 24) + 24) % 24;
                    const inOverlay =
                        nightEnd < nightStart ? h >= nightStart || h <= nightEnd : h >= nightStart && h <= nightEnd;
                    if (inOverlay) {
                        return {
                            date: row.date,
                            "circadian night": formatHour(nightStart) + " – " + formatHour(nightEnd),
                            "local τ": cd.localTau.toFixed(2) + "h",
                            confidence: cd.confidence,
                            ...(cd.isForecast ? { type: "predicted" } : {}),
                        };
                    }
                }
            }

            return { date: row.date } as Record<string, string>;
        },
        [rows, circadian, cfg, hoursPerRow]
    );

    // Store the render function in a ref so the editor-drag listener can call it
    const renderRef = useRef<() => void>(() => {});

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || rows.length === 0) return;

        const dpr = window.devicePixelRatio || 1;
        const cssWidth = canvas.clientWidth;
        const cssHeight = cfg.topMargin + rows.length * cfg.rowHeight + cfg.bottomMargin;

        canvas.style.height = cssHeight + "px";
        canvas.width = cssWidth * dpr;
        canvas.height = cssHeight * dpr;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.scale(dpr, dpr);

        const plotLeft = cfg.leftMargin;
        const plotWidth = cssWidth - cfg.leftMargin - cfg.rightMargin;
        const plotTop = cfg.topMargin;

        const xScale = scaleLinear()
            .domain([0, hoursPerRow])
            .range([plotLeft, plotLeft + plotWidth]);

        // Clear
        ctx.fillStyle = COLORS.background;
        ctx.fillRect(0, 0, cssWidth, cssHeight);

        // Alternating month bands
        for (let i = 0; i < rows.length; i++) {
            const dateStr = rows[i]!.date.slice(0, 10); // "YYYY-MM-DD"
            const year = parseInt(dateStr.slice(0, 4));
            const month = parseInt(dateStr.slice(5, 7)) - 1; // 0-indexed
            const monthIndex = year * 12 + month;
            if (monthIndex % 2 === 0) {
                ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
                ctx.fillRect(plotLeft, plotTop + i * cfg.rowHeight, plotWidth, cfg.rowHeight);
            }
        }

        // Year boundary lines
        ctx.save();
        ctx.strokeStyle = "rgba(148, 163, 184, 0.55)";
        ctx.lineWidth = 1;
        for (let i = 1; i < rows.length; i++) {
            const prevYear = rows[i - 1]!.date.slice(0, 4);
            const currYear = rows[i]!.date.slice(0, 4);
            if (prevYear !== currYear) {
                const y = plotTop + i * cfg.rowHeight;
                ctx.beginPath();
                ctx.moveTo(plotLeft, y);
                ctx.lineTo(plotLeft + plotWidth, y);
                ctx.stroke();
            }
        }
        ctx.restore();

        // Draw hour grid lines
        ctx.strokeStyle = COLORS.grid;
        ctx.lineWidth = 0.5;
        for (let h = 0; h <= hoursPerRow; h += 6) {
            const x = xScale(h);
            ctx.beginPath();
            ctx.moveTo(x, plotTop);
            ctx.lineTo(x, plotTop + rows.length * cfg.rowHeight);
            ctx.stroke();
        }

        // Hour labels
        ctx.fillStyle = COLORS.text;
        ctx.font = "11px system-ui, sans-serif";
        ctx.textAlign = "center";
        for (let h = 0; h <= hoursPerRow; h += 6) {
            if (tauMode) {
                // Relative offset labels: +0, +6, +12, ...
                ctx.fillText("+" + h, xScale(h), plotTop - 8);
            } else {
                const label = h % 24;
                ctx.fillText(label.toString().padStart(2, "0"), xScale(h), plotTop - 8);
            }
        }

        // Draw circadian overlay
        // Circadian overlay duplicates same day's prediction on both halves
        const hasManualOverlay = (options.manualOverlayDays?.length ?? 0) > 0;

        // When manual overlay exists AND edit mode is on, draw algorithm overlay dimmed as reference
        if (hasManualOverlay && options.overlayEditMode && circadian.length > 0) {
            const circadianMapDim = new Map<string, CircadianDay>();
            for (const cd of circadian) circadianMapDim.set(cd.date, cd);
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i]!;
                const rowDateKey = row.date.slice(0, 10);
                const cd = circadianMapDim.get(rowDateKey);
                if (!cd || cd.isGap) continue;
                const y = plotTop + i * cfg.rowHeight;
                ctx.fillStyle = `rgba(168, 85, 247, 0.05)`;
                if (!tauMode) {
                    let nightStart = ((cd.nightStartHour % 24) + 24) % 24;
                    let nightEnd = ((cd.nightEndHour % 24) + 24) % 24;
                    if (nightEnd < nightStart) {
                        ctx.fillRect(xScale(nightStart), y, xScale(24) - xScale(nightStart), cfg.rowHeight);
                        ctx.fillRect(xScale(0), y, xScale(nightEnd) - xScale(0), cfg.rowHeight);
                    } else {
                        ctx.fillRect(xScale(nightStart), y, xScale(nightEnd) - xScale(nightStart), cfg.rowHeight);
                    }
                    if (cfg.doublePlot) {
                        nightStart += 24;
                        nightEnd += 24;
                        if (nightEnd < nightStart) {
                            ctx.fillRect(xScale(nightStart), y, xScale(48) - xScale(nightStart), cfg.rowHeight);
                            ctx.fillRect(xScale(24), y, xScale(nightEnd) - xScale(24), cfg.rowHeight);
                        } else {
                            ctx.fillRect(xScale(nightStart), y, xScale(nightEnd) - xScale(nightStart), cfg.rowHeight);
                        }
                    }
                }
            }
        }

        // Draw manual overlay (cyan) if present, otherwise draw algorithm overlay (purple)
        if (hasManualOverlay) {
            const manualMap = new Map<string, OverlayDay>();
            for (const od of options.manualOverlayDays!) manualMap.set(od.date, od);

            for (let i = 0; i < rows.length; i++) {
                const row = rows[i]!;
                const rowDateKey = row.date.slice(0, 10);
                const od = manualMap.get(rowDateKey);
                if (!od) continue;
                const y = plotTop + i * cfg.rowHeight;
                ctx.fillStyle = "rgba(6, 182, 212, 0.3)"; // cyan

                let nightStart = ((od.nightStartHour % 24) + 24) % 24;
                let nightEnd = ((od.nightEndHour % 24) + 24) % 24;
                if (nightEnd < nightStart) {
                    ctx.fillRect(xScale(nightStart), y, xScale(24) - xScale(nightStart), cfg.rowHeight);
                    ctx.fillRect(xScale(0), y, xScale(nightEnd) - xScale(0), cfg.rowHeight);
                } else {
                    ctx.fillRect(xScale(nightStart), y, xScale(nightEnd) - xScale(nightStart), cfg.rowHeight);
                }
                if (cfg.doublePlot) {
                    nightStart += 24;
                    nightEnd += 24;
                    if (nightEnd < nightStart) {
                        ctx.fillRect(xScale(nightStart), y, xScale(48) - xScale(nightStart), cfg.rowHeight);
                        ctx.fillRect(xScale(24), y, xScale(nightEnd) - xScale(24), cfg.rowHeight);
                    } else {
                        ctx.fillRect(xScale(nightStart), y, xScale(nightEnd) - xScale(nightStart), cfg.rowHeight);
                    }
                }
            }
        } else if (circadian.length > 0) {
            const circadianMap = new Map<string, CircadianDay>();
            for (const cd of circadian) {
                circadianMap.set(cd.date, cd);
            }

            for (let i = 0; i < rows.length; i++) {
                const row = rows[i]!;
                // In tau mode, row.date may include time — extract just the date part
                const rowDateKey = row.date.slice(0, 10);
                const cd = circadianMap.get(rowDateKey);
                if (!cd || cd.isGap) continue;

                const y = plotTop + i * cfg.rowHeight;

                // Alpha based on confidence score
                const alpha =
                    "confidenceScore" in cd ? 0.1 + (cd as { confidenceScore: number }).confidenceScore * 0.25 : 0.25;
                ctx.fillStyle = cd.isForecast ? `rgba(251, 191, 36, ${alpha})` : `rgba(168, 85, 247, ${alpha})`;

                if (tauMode && row.startMs != null) {
                    // Tau mode: position night hours relative to row's start time
                    const nightStartAbsH = ((cd.nightStartHour % 24) + 24) % 24;
                    const nightEndAbsH = ((cd.nightEndHour % 24) + 24) % 24;
                    const rowStartAbsH = (row.startMs % 86_400_000) / 3_600_000;
                    const nightDur = (((nightEndAbsH - nightStartAbsH) % 24) + 24) % 24;

                    let ns = nightStartAbsH - rowStartAbsH;
                    while (ns < -12) ns += 24;
                    while (ns > baseHours + 12) ns -= 24;
                    const ne = ns + nightDur;

                    // Clip to row bounds [0, baseHours]
                    const drawOverlaySegment = (start: number, end: number, offset: number) => {
                        const s = Math.max(0, start) + offset;
                        const e = Math.min(baseHours, end) + offset;
                        if (e > s) {
                            ctx.fillRect(xScale(s), y, xScale(e) - xScale(s), cfg.rowHeight);
                        }
                    };

                    drawOverlaySegment(ns, ne, 0);
                    // If night wraps before row start, it might appear at end of row
                    if (ns < 0) drawOverlaySegment(ns + 24, ne + 24, 0);

                    if (cfg.doublePlot) {
                        drawOverlaySegment(ns, ne, baseHours);
                        if (ns < 0) drawOverlaySegment(ns + 24, ne + 24, baseHours);
                    }
                } else {
                    // Calendar mode: normalize night hours to [0, 24) range
                    // Circadian overlay duplicates same day's prediction on both halves,
                    // matching the tooltip's hour % 24 hit-testing logic
                    let nightStart = ((cd.nightStartHour % 24) + 24) % 24;
                    let nightEnd = ((cd.nightEndHour % 24) + 24) % 24;

                    if (nightEnd < nightStart) {
                        ctx.fillRect(xScale(nightStart), y, xScale(24) - xScale(nightStart), cfg.rowHeight);
                        ctx.fillRect(xScale(0), y, xScale(nightEnd) - xScale(0), cfg.rowHeight);
                    } else {
                        ctx.fillRect(xScale(nightStart), y, xScale(nightEnd) - xScale(nightStart), cfg.rowHeight);
                    }

                    if (cfg.doublePlot) {
                        nightStart += 24;
                        nightEnd += 24;
                        if (nightEnd < nightStart) {
                            ctx.fillRect(xScale(nightStart), y, xScale(48) - xScale(nightStart), cfg.rowHeight);
                            ctx.fillRect(xScale(24), y, xScale(nightEnd) - xScale(24), cfg.rowHeight);
                        } else {
                            ctx.fillRect(xScale(nightStart), y, xScale(nightEnd) - xScale(nightStart), cfg.rowHeight);
                        }
                    }
                }
            }
        }

        // Draw schedule overlay
        // In double-plot mode, right half shows the next day's schedule
        if (cfg.showSchedule && cfg.scheduleEntries && cfg.scheduleEntries.length > 0) {
            ctx.fillStyle = "rgba(34, 197, 94, 0.2)"; // green with alpha

            const drawScheduleForRow = (sourceRow: ActogramRow, y: number, offset: number) => {
                if (tauMode && sourceRow.startMs != null) {
                    const rowStartMs = sourceRow.startMs;
                    const rowEndMs = rowStartMs + baseHours * MS_PER_HOUR;

                    // Walk whole days in the dataset's own offset, so the schedule
                    // lands on the same wall-clock hours as the sleep blocks.
                    let dayMs = zonedDayStartMs(zonedDateStr(rowStartMs, offsetMinutes), offsetMinutes);

                    while (dayMs <= rowEndMs) {
                        const jsDay = new Date(dayMs + 12 * MS_PER_HOUR).getUTCDay();
                        const dayIndex = jsDay === 0 ? 6 : jsDay - 1;

                        for (const entry of cfg.scheduleEntries!) {
                            if (!entry.days[dayIndex]) continue;

                            const startParts = entry.startTime.split(":");
                            const endParts = entry.endTime.split(":");
                            const sH = parseInt(startParts[0] ?? "0", 10) + parseInt(startParts[1] ?? "0", 10) / 60;
                            const eH = parseInt(endParts[0] ?? "0", 10) + parseInt(endParts[1] ?? "0", 10) / 60;

                            const drawAbsBlock = (absStart: number, absEnd: number) => {
                                const iStart = Math.max(absStart, rowStartMs);
                                const iEnd = Math.min(absEnd, rowEndMs);

                                if (iEnd > iStart) {
                                    const xStart = (iStart - rowStartMs) / 3_600_000 + offset;
                                    const xEnd = (iEnd - rowStartMs) / 3_600_000 + offset;
                                    ctx.fillRect(xScale(xStart), y, xScale(xEnd) - xScale(xStart), cfg.rowHeight);
                                }
                            };

                            if (eH <= sH) {
                                const startMs = dayMs + sH * MS_PER_HOUR;
                                const endMs = dayMs + MS_PER_DAY + eH * MS_PER_HOUR;
                                drawAbsBlock(startMs, dayMs + MS_PER_DAY);
                                drawAbsBlock(dayMs + MS_PER_DAY, endMs);
                            } else {
                                const startMs = dayMs + sH * MS_PER_HOUR;
                                const endMs = dayMs + eH * MS_PER_HOUR;
                                drawAbsBlock(startMs, endMs);
                            }
                        }

                        dayMs += MS_PER_DAY;
                    }
                } else {
                    // Weekday comes from the date-only row label; noon avoids any
                    // DST edge and the result is zone-independent.
                    const dateStr = sourceRow.date.slice(0, 10);
                    const jsDay = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
                    const dayIndex = jsDay === 0 ? 6 : jsDay - 1;

                    for (const entry of cfg.scheduleEntries!) {
                        if (!entry.days[dayIndex]) continue;

                        const startParts = entry.startTime.split(":");
                        const endParts = entry.endTime.split(":");
                        const startHour = parseInt(startParts[0] ?? "0", 10) + parseInt(startParts[1] ?? "0", 10) / 60;
                        const endHour = parseInt(endParts[0] ?? "0", 10) + parseInt(endParts[1] ?? "0", 10) / 60;

                        const drawSegment = (s: number, e: number, o: number) => {
                            const start = Math.max(0, s) + o;
                            const end = Math.min(24, e) + o;
                            if (end > start) {
                                ctx.fillRect(xScale(start), y, xScale(end) - xScale(start), cfg.rowHeight);
                            }
                        };

                        if (endHour <= startHour) {
                            drawSegment(startHour, 24, offset);
                            drawSegment(0, endHour, offset);
                        } else {
                            drawSegment(startHour, endHour, offset);
                        }
                    }
                }
            };

            for (let i = 0; i < rows.length; i++) {
                const row = rows[i]!;
                const y = plotTop + i * cfg.rowHeight;

                // Left side: this row's schedule
                drawScheduleForRow(row, y, 0);

                // Right side: next day's schedule
                if (cfg.doublePlot) {
                    const nextIdx = i + nextDayOffset;
                    if (nextIdx >= 0 && nextIdx < rows.length) {
                        drawScheduleForRow(rows[nextIdx]!, y, baseHours);
                    }
                }
            }
        }

        // Draw sleep blocks
        // In double-plot mode, the right half of row i shows the next day's data
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i]!;
            const y = plotTop + i * cfg.rowHeight;

            // Helper to draw a block at a given hour offset on this row's y position
            const drawBlockAt = (block: (typeof row.blocks)[0], hourOffset: number) => {
                const bStart = block.startHour + hourOffset;
                const bEnd = block.endHour + hourOffset;
                const blockPixelWidth = xScale(bEnd) - xScale(bStart);

                if (cfg.colorMode === "quality") {
                    ctx.fillStyle = qualityColor(block.record.sleepScore || 0);
                    ctx.fillRect(xScale(bStart), y, Math.max(blockPixelWidth, 1), cfg.rowHeight - 0.5);
                } else if (block.record.stageData && blockPixelWidth > 5) {
                    drawStageBlock(
                        ctx,
                        xScale,
                        block.record.stageData,
                        block.startMs,
                        block.endMs,
                        bStart,
                        bEnd,
                        y,
                        cfg.rowHeight
                    );
                } else {
                    ctx.fillStyle = COLORS.light;
                    ctx.fillRect(xScale(bStart), y, Math.max(blockPixelWidth, 1), cfg.rowHeight - 0.5);
                }
            };

            // Left side: this row's blocks
            for (const block of row.blocks) {
                drawBlockAt(block, 0);
            }

            // Right side: next day's blocks
            if (cfg.doublePlot) {
                const nextIdx = i + nextDayOffset;
                if (nextIdx >= 0 && nextIdx < rows.length) {
                    const nextDayRow = rows[nextIdx]!;
                    for (const block of nextDayRow.blocks) {
                        drawBlockAt(block, baseHours);
                    }
                }
            }
        }

        // Date labels
        if (cfg.showDateLabels !== false) {
            ctx.fillStyle = COLORS.text;
            ctx.font = "9px monospace";
            ctx.textAlign = "right";
            const labelInterval = cfg.rowHeight < 8 ? 7 : 1;
            for (let i = 0; i < rows.length; i += labelInterval) {
                const row = rows[i]!;
                const y = plotTop + i * cfg.rowHeight + cfg.rowHeight;
                ctx.fillText(row.date, plotLeft - 6, y);
            }
        }

        // Editor overlay (control points + path line)
        if (options.editorDraw) {
            options.editorDraw(ctx, xScale, plotTop);
        }

        // Store a lightweight repaint function for drag updates
        renderRef.current = () => {
            if (!options.editorDraw) return;
            // Redraw only the editor layer by clearing and re-rendering everything
            // (canvas requires full redraw — no layer isolation)
            canvas.dispatchEvent(new Event("full-redraw"));
        };

        // Listen for drag events from the editor
        const handleEditorDrag = () => {
            // Full redraw is needed since canvas can't repaint a single layer.
            // We re-run the effect by calling the function inline — but since
            // useEffect can't re-trigger itself, we instead do a direct
            // repaint of just the editor layer on top.
            // Clear the area below sleep blocks (editor layer draws last)
            if (options.editorDraw) {
                // For drag previews, just redraw editor on top (handles overlap is OK for brief drag)
                options.editorDraw(ctx, xScale, plotTop);
            }
        };
        canvas.addEventListener("editor-drag", handleEditorDrag);
        return () => canvas.removeEventListener("editor-drag", handleEditorDrag);
    }, [rows, circadian, cfg, hoursPerRow, options.manualOverlayDays, options.overlayEditMode, options.editorDraw]);

    return { canvasRef, getTooltipInfo };
}

/**
 * Draw a sleep block colored by stage data intervals.
 *
 * blockStartHour/blockEndHour are on the x-axis scale (0..24 or 0..48 for double plot).
 * hourOffset is 0 for the first plot, 24 for the double-plot repeat.
 *
 * The block's absolute bounds come straight from the row builder, which already
 * clipped them against the row window in the dataset's reference offset, so
 * stage intervals only need to be clipped and mapped linearly onto that window.
 */
function drawStageBlock(
    ctx: CanvasRenderingContext2D,
    xScale: (h: number) => number,
    stageData: SleepLevelEntry[],
    blockStartMs: number,
    blockEndMs: number,
    blockStartHour: number,
    blockEndHour: number,
    y: number,
    rowHeight: number
) {
    if (blockEndHour <= blockStartHour) return;

    for (const entry of stageData) {
        const entryStartMs = new Date(entry.dateTime).getTime();
        const entryEndMs = entryStartMs + entry.seconds * 1000;

        // Clip to block time range
        const visStartMs = Math.max(entryStartMs, blockStartMs);
        const visEndMs = Math.min(entryEndMs, blockEndMs);
        if (visEndMs <= visStartMs) continue;

        // Map to x-axis hours
        const xStart = blockStartHour + (visStartMs - blockStartMs) / 3_600_000;
        const xEnd = blockStartHour + (visEndMs - blockStartMs) / 3_600_000;

        ctx.fillStyle = stageColor(entry.level);
        ctx.fillRect(xScale(xStart), y, Math.max(xScale(xEnd) - xScale(xStart), 0.5), rowHeight - 0.5);
    }
}
