/**
 * Data-freshness rules for the app-bar badge (pure; shared by server, client
 * and tests).
 *
 * The pipeline (.github/workflows/update_data.yml) runs hourly on the hour
 * from 12:00 to 02:00 UTC ("pregame window": late morning → late evening ET)
 * and not at all 03:00–11:59 UTC. The badge turns red only when a scheduled
 * run was actually missed:
 *   - in the pregame window: the data is older than the run slot from ≥2h ago
 *     (i.e. >2h behind schedule, allowing for GitHub cron delays);
 *   - otherwise: older than 26h (the overnight gap is expected).
 * So at 09:00 UTC with the last run at 02:00 UTC the badge is not red.
 */

/** UTC hours with a scheduled run. */
export const RUN_HOURS_UTC = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0, 1, 2] as const;

const HOUR = 3_600_000;
const MIN = 60_000;
/** Allowed lateness for a scheduled run before it counts as missed. */
export const IN_WINDOW_GRACE_MS = 2 * HOUR;
/** Hard ceiling on data age at any time of day. */
export const MAX_AGE_MS = 26 * HOUR;
/** A run may stamp slightly before the slot (runner clock / early start). */
const SLOT_TOLERANCE_MS = 15 * MIN;
/** "Fresh" (green dot) while younger than this. */
export const FRESH_MS = 75 * MIN;

export type FreshnessState = 'fresh' | 'ok' | 'stale' | 'unknown';

export function inPregameWindow(now: Date): boolean {
    return (RUN_HOURS_UTC as readonly number[]).includes(now.getUTCHours());
}

/** Latest scheduled run slot at or before `t`. */
export function lastSlotAtOrBefore(t: Date): Date {
    const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), t.getUTCHours()));
    for (let i = 0; i < 48; i++) {
        if ((RUN_HOURS_UTC as readonly number[]).includes(d.getUTCHours())) return d;
        d.setUTCHours(d.getUTCHours() - 1);
    }
    return d;
}

export function freshnessState(generatedAt: Date | null, now: Date): FreshnessState {
    if (!generatedAt || Number.isNaN(generatedAt.getTime())) return 'unknown';
    const age = now.getTime() - generatedAt.getTime();
    if (age > MAX_AGE_MS) return 'stale';
    if (inPregameWindow(now)) {
        const due = lastSlotAtOrBefore(new Date(now.getTime() - IN_WINDOW_GRACE_MS));
        if (generatedAt.getTime() < due.getTime() - SLOT_TOLERANCE_MS) return 'stale';
    }
    return age <= FRESH_MS ? 'fresh' : 'ok';
}

export function relativeAge(generatedAt: Date, now: Date): string {
    const mins = Math.max(0, Math.floor((now.getTime() - generatedAt.getTime()) / MIN));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 48) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Offset (minutes) of America/Chicago from UTC at a given instant. */
function chicagoOffsetMinutes(at: Date): number {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Chicago',
            hourCycle: 'h23',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        }).formatToParts(at);
        const get = (t: string) => Number(parts.find(p => p.type === t)?.value);
        const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
        return Math.round((asUtc - at.getTime()) / MIN);
    } catch {
        return -300;
    }
}

/**
 * Parse a pipeline timestamp. Accepts ISO 8601 (manifest.generated_at) and
 * the legacy last_updated.json format "September 29, 2026, 06:48 PM", which
 * predict_games.py writes in US Central time.
 */
export function parseDataTimestamp(raw: string | null | undefined): Date | null {
    if (!raw) return null;
    const s = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
        const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    const m = s.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4}),?\s+(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
    if (!m) return null;
    const month = MONTHS.indexOf(m[1].toLowerCase());
    if (month < 0) return null;
    let hour = Number(m[4]) % 12;
    if (m[6].toLowerCase() === 'pm') hour += 12;
    const wallAsUtc = Date.UTC(Number(m[3]), month, Number(m[2]), hour, Number(m[5]));
    // Two passes handle DST transitions.
    let t = wallAsUtc - chicagoOffsetMinutes(new Date(wallAsUtc)) * MIN;
    t = wallAsUtc - chicagoOffsetMinutes(new Date(t)) * MIN;
    return new Date(t);
}
