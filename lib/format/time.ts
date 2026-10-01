/**
 * One time format for the whole site.
 *
 * Every clock time carries a zone abbreviation ("7:30 PM EDT"). The server
 * (and the first client paint) renders Eastern time, since that is the NHL's
 * home zone and gives deterministic HTML; the <LocalTime> component
 * (components/ui/local-time.tsx) then swaps in the viewer's own zone and keeps
 * the Eastern time in its tooltip.
 */

export const ET_ZONE = 'America/New_York';

/**
 * time      "7:30 PM EDT"
 * datetime  "Sep 30, 7:30 PM EDT"
 * weekday   "Thu, Oct 1, 7:30 PM EDT"
 */
export type TimeStyle = 'time' | 'datetime' | 'weekday';

const STYLE_OPTS: Record<TimeStyle, Intl.DateTimeFormatOptions> = {
    time: { hour: 'numeric', minute: '2-digit' },
    datetime: { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
    weekday: { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
};

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

/**
 * A shared Intl.DateTimeFormat per (locale, options). Building one costs far
 * more than formatting with it, and a slate renders the same few formats for
 * every card, so the home page hydrates with a handful of formatters instead
 * of one per call. Output is identical to `new Intl.DateTimeFormat(...)`.
 */
export function dateFormatter(locale: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
    const key = `${locale}|${JSON.stringify(opts)}`;
    let f = FORMATTERS.get(key);
    if (!f) {
        f = new Intl.DateTimeFormat(locale, opts);
        FORMATTERS.set(key, f);
    }
    return f;
}

function toDate(value: string | number | Date | null | undefined): Date | null {
    if (value === null || value === undefined || value === '') return null;
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Format an instant with its zone abbreviation. Pass `timeZone` for a fixed
 * zone (ET_ZONE on the server); omit it to use the runtime's local zone.
 * Returns null for a missing or unparseable value.
 */
export function formatTime(
    value: string | number | Date | null | undefined,
    style: TimeStyle = 'time',
    timeZone?: string,
): string | null {
    const d = toDate(value);
    if (!d) return null;
    return dateFormatter('en-US', {
        ...STYLE_OPTS[style],
        timeZoneName: 'short',
        ...(timeZone ? { timeZone } : {}),
    }).format(d);
}

/** Eastern-time rendering: the deterministic server/first-paint text. */
export function formatTimeET(value: string | number | Date | null | undefined, style: TimeStyle = 'time'): string | null {
    return formatTime(value, style, ET_ZONE);
}
