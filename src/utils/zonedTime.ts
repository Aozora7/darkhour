/**
 * Time-zone-aware timestamp handling.
 *
 * The Google Health REST API returns wall-clock timestamps with **no** zone
 * designator, paired with a separate protobuf `Duration` offset:
 *
 * ```json
 * { "startTime": "2022-05-13 22:23:30", "startUtcOffset": "10800s" }
 * ```
 *
 * `new Date("2022-05-13 22:23:30")` is interpreted in the *browser's* zone by
 * the JS engine, which silently discards the recorded zone. This module keeps
 * the recorded offset alongside the absolute instant so that day boundaries and
 * hour-of-day phase stay stable no matter where the file is later opened.
 *
 * Convention: offsets are always **minutes east of UTC** (so UTC+8 is `480`,
 * UTC-5 is `-300`), matching the sign of `Date.prototype.getTimezoneOffset()`
 * negated.
 */

/** Minutes east of UTC. */
export type OffsetMinutes = number;

export const MS_PER_SECOND = 1_000;
export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

/**
 * Matches a zone-less wall-clock timestamp: `YYYY-MM-DD` + `T` or space +
 * `HH:MM[:SS[.sss]]`. Deliberately does not match a trailing `Z` or `±HH:MM`.
 */
const WALL_CLOCK_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3})\d*)?$/;

/**
 * A full ISO-style timestamp *with* a trailing zone designator: `Z`, `+08:00`,
 * `-0500` or `+08`. Anchored at both ends so that a date-only value such as
 * `2022-05-13` is never mistaken for an offset of `-13`.
 */
const EXPLICIT_OFFSET_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?([Zz]|[+-]\d{2}(?::?\d{2})?)$/;

/**
 * The browser's current UTC offset in minutes east.
 *
 * Prefer {@link hostOffsetAt} when the instant being labelled is known: this
 * returns the offset *today*, which differs from the historical offset for any
 * date on the other side of a DST boundary.
 */
export function browserOffsetMinutes(): OffsetMinutes {
    return -new Date().getTimezoneOffset();
}

/**
 * The host's UTC offset in minutes east **at a given instant**, i.e. DST-aware.
 *
 * This is the exact frame the pre-timezone code used, because `setHours(0,0,0,0)`
 * and `getFullYear()` resolve the host zone per date. Using it as the fallback for
 * offset-less data reproduces legacy placement day for day.
 */
export function hostOffsetAt(instantMs: number): OffsetMinutes {
    return -new Date(instantMs).getTimezoneOffset();
}

/**
 * Best guess at the zone a zone-less wall-clock timestamp belongs to, used when
 * the source carries no offset at all.
 *
 * The engine's own parse of the string yields a provisional instant, and the host
 * offset *at that instant* is DST-correct for the date in question.
 */
export function resolveWallOffset(wallClock: string): OffsetMinutes {
    const provisional = new Date(wallClock).getTime();
    return Number.isFinite(provisional) ? hostOffsetAt(provisional) : browserOffsetMinutes();
}

/**
 * Parse a protobuf `Duration` offset such as `"10800s"`, `"-19800s"` or
 * `"0s"` into minutes east of UTC. Returns `undefined` for missing or
 * unparseable input so callers can apply their own fallback.
 */
export function parseUtcOffset(raw: string | number | undefined | null): OffsetMinutes | undefined {
    if (raw == null) return undefined;
    if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;

    // Protobuf JSON encodes seconds as a decimal string with an "s" suffix.
    const match = /^(-?\d+(?:\.\d+)?)s$/.exec(raw.trim());
    if (!match) return undefined;

    const seconds = Number.parseFloat(match[1]!);
    if (!Number.isFinite(seconds)) return undefined;
    return Math.round(seconds / 60);
}

/**
 * Read the UTC offset embedded in a timestamp string, in minutes east.
 * Returns `undefined` when the string carries no designator (a zone-less
 * wall-clock value, which is what Google Health returns).
 */
export function explicitOffsetMinutes(timestamp: string): OffsetMinutes | undefined {
    const match = EXPLICIT_OFFSET_RE.exec(timestamp.trim());
    if (!match) return undefined;

    const designator = match[1]!;
    if (designator === "Z" || designator === "z") return 0;

    const sign = designator[0] === "-" ? -1 : 1;
    const digits = designator.slice(1).replace(":", "");

    if (digits.length === 2) return sign * Number.parseInt(digits, 10) * 60;
    return sign * (Number.parseInt(digits.slice(0, 2), 10) * 60 + Number.parseInt(digits.slice(2, 4), 10));
}

/**
 * Interpret a timestamp as an absolute instant.
 *
 * - Strings with a zone designator are parsed as-is; the designator wins.
 * - Zone-less wall-clock strings are interpreted in `offsetMinutes`, which is
 *   what makes Google Health records land on their recorded local clock.
 * - Anything unrecognised falls back to the engine's own `Date` parsing, and
 *   finally to the `Invalid Date` sentinel when the input is unusable.
 */
export function toInstant(timestamp: string, offsetMinutes?: OffsetMinutes): Date {
    if (!timestamp) return new Date(NaN);

    const trimmed = timestamp.trim();
    const embedded = explicitOffsetMinutes(trimmed);
    if (embedded !== undefined) return new Date(trimmed);

    const match = WALL_CLOCK_RE.exec(trimmed);
    if (!match) return new Date(trimmed);

    const offset = offsetMinutes ?? resolveWallOffset(trimmed);
    const ms = Date.UTC(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        Number(match[4]),
        Number(match[5]),
        Number(match[6] ?? 0),
        Number((match[7] ?? "").padEnd(3, "0"))
    );

    return new Date(ms - offset * MS_PER_MINUTE);
}

/**
 * Wall-clock calendar fields of an instant, as observed in `offsetMinutes`.
 * Pure arithmetic on the shifted timestamp — no host `Date` getters, so the
 * result never depends on the browser's own zone.
 */
export function zonedParts(
    instantMs: number,
    offsetMinutes: OffsetMinutes
): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
    const shifted = new Date(instantMs + offsetMinutes * MS_PER_MINUTE);
    return {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate(),
        hour: shifted.getUTCHours(),
        minute: shifted.getUTCMinutes(),
        second: shifted.getUTCSeconds(),
    };
}

/** Format an instant as a `YYYY-MM-DD` calendar date in `offsetMinutes`. */
export function zonedDateStr(instantMs: number, offsetMinutes: OffsetMinutes): string {
    const { year, month, day } = zonedParts(instantMs, offsetMinutes);
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Format an instant as a `YYYY-MM-DD HH:mm` label in `offsetMinutes`. */
export function zonedDateTimeStr(instantMs: number, offsetMinutes: OffsetMinutes): string {
    const { hour, minute } = zonedParts(instantMs, offsetMinutes);
    return `${zonedDateStr(instantMs, offsetMinutes)} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Absolute instant of 00:00 on `dateStr` in `offsetMinutes`.
 *
 * This is the replacement for `new Date(dateStr + "T00:00:00")`, which anchors
 * a day to the browser's zone. Days in a fixed-offset frame are always exactly
 * 24 h apart, which also removes the DST drift the old local-midnight maths
 * suffered from.
 */
export function zonedDayStartMs(dateStr: string, offsetMinutes: OffsetMinutes): number {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!match) return new Date(`${dateStr}T00:00:00`).getTime();
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) - offsetMinutes * MS_PER_MINUTE;
}

/** Fractional hour of day (0–24) of an instant, as observed in `offsetMinutes`. */
export function zonedHourOfDay(instantMs: number, offsetMinutes: OffsetMinutes): number {
    const { hour, minute, second } = zonedParts(instantMs, offsetMinutes);
    return hour + minute / 60 + second / 3600;
}

/** Shift a `YYYY-MM-DD` calendar date by whole days, staying DST-free. */
export function addDaysToDateStr(dateStr: string, days: number): string {
    const start = zonedDayStartMs(dateStr, 0);
    return zonedDateStr(start + days * MS_PER_DAY, 0);
}

/**
 * The frame a set of records is displayed and analysed in.
 *
 * Records carry the zone they were *recorded* in, which can legitimately change
 * mid-series when the subject travels. Deriving one shared frame from the
 * earliest record keeps rows calendar-aligned and stops travel periods from
 * showing up as multi-hour phase jumps in the drift fit.
 *
 * Records whose offset is unknown are treated as belonging to the browser's
 * zone, which is how they were interpreted before offsets were tracked.
 */
export function referenceOffset<T extends { startTime: Date; startTimeOffsetMinutes: OffsetMinutes }>(
    records: readonly T[]
): OffsetMinutes {
    if (records.length === 0) return browserOffsetMinutes();

    let earliest = records[0]!;
    for (const record of records) {
        if (record.startTime.getTime() < earliest.startTime.getTime()) earliest = record;
    }
    return earliest.startTimeOffsetMinutes ?? hostOffsetAt(earliest.startTime.getTime());
}
