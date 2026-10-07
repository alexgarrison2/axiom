/** Time-zone helpers for schedule metrics (Intl only, no dependencies). */

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
    const key = `${tz}|${JSON.stringify(opts)}`;
    let f = fmtCache.get(key);
    if (!f) {
        f = new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts });
        fmtCache.set(key, f);
    }
    return f;
}

/** UTC offset of `tz` at `instant`, in hours (e.g. -5 for EST, -4 for EDT). */
export function utcOffsetHours(tz: string, instant: Date): number {
    const name = fmt(tz, { timeZoneName: 'longOffset' })
        .formatToParts(instant)
        .find(p => p.type === 'timeZoneName')?.value;
    const m = name?.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!m) return 0;
    const h = Number(m[2]) + (m[3] ? Number(m[3]) / 60 : 0);
    return m[1] === '-' ? -h : h;
}

/** Wall-clock hour (decimal, 0-24) of `instant` in `tz`. 19:30 → 19.5. */
export function localHour(tz: string, instant: Date): number {
    const parts = fmt(tz, { hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(instant);
    const h = Number(parts.find(p => p.type === 'hour')?.value ?? 0);
    const m = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
    return (h % 24) + m / 60;
}

/** "7:00 PM" in `tz`. */
export function clockLabel(tz: string, instant: Date): string {
    return fmt(tz, { hour: 'numeric', minute: '2-digit' }).format(instant);
}

const EURO: Record<string, [string, string]> = {
    'Europe/Stockholm': ['CET', 'CEST'],
    'Europe/Berlin': ['CET', 'CEST'],
    'Europe/Prague': ['CET', 'CEST'],
    'Europe/Helsinki': ['EET', 'EEST'],
};

/** Short zone label: PT / MT / CT / ET in North America, CET / EET in Europe. */
export function zoneLabel(tz: string, instant: Date): string {
    const euro = EURO[tz];
    if (euro) {
        const jan = utcOffsetHours(tz, new Date(Date.UTC(instant.getUTCFullYear(), 0, 15)));
        return utcOffsetHours(tz, instant) > jan ? euro[1] : euro[0];
    }
    const generic = fmt(tz, { timeZoneName: 'shortGeneric' })
        .formatToParts(instant)
        .find(p => p.type === 'timeZoneName')?.value;
    if (generic && generic.length <= 3) return generic;
    return (
        fmt(tz, { timeZoneName: 'short' })
            .formatToParts(instant)
            .find(p => p.type === 'timeZoneName')?.value ?? ''
    );
}

/** Whole days since 1970-01-01 for a YYYY-MM-DD date (calendar arithmetic, no zones). */
export function dayNumber(date: string): number {
    return Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

/** YYYY-MM-DD for a day number. */
export function dateOfDay(day: number): string {
    return new Date(day * 86_400_000).toISOString().slice(0, 10);
}
