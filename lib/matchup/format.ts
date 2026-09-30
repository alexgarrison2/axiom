/** Display formatting for the matchup card (pure). */
import { SEASON_START_YEAR } from '../season';

/** "25-26" (previous season) and "26-27" (current). */
export const PREV_TAG = `${String(SEASON_START_YEAR - 1).slice(2)}-${String(SEASON_START_YEAR).slice(2)}`;
export const CUR_TAG = `${String(SEASON_START_YEAR).slice(2)}-${String(SEASON_START_YEAR + 1).slice(2)}`;

/** American odds with an explicit sign: 105 → "+105", "-125" → "−125" (true minus). */
export function fmtOdds(v: number | string | null | undefined): string | null {
    if (v == null || v === '') return null;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/^\+/, ''));
    if (!Number.isFinite(n) || n === 0) return null;
    return n > 0 ? `+${Math.round(n)}` : `−${Math.abs(Math.round(n))}`;
}

export function fmtPct(p: number | null | undefined, digits = 0): string {
    if (p == null || !Number.isFinite(p)) return '—';
    return `${p.toFixed(digits)}%`;
}

/** Signed percentage points / percent: 4.1 → "+4.1%". */
export function fmtSignedPct(v: number, digits = 1): string {
    const s = v.toFixed(digits);
    return v > 0 ? `+${s}%` : v < 0 ? `−${s.replace('-', '')}%` : `${s}%`;
}

export function fmtSigned(v: number, digits = 2): string {
    const s = Math.abs(v).toFixed(digits);
    return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s;
}

/**
 * Local puck-drop time with a zone abbreviation: "5:00 PM EDT". Pass a
 * timeZone for a deterministic server render (Eastern), omit it for the
 * viewer's zone.
 */
export function fmtTime(iso: string, timeZone?: string, locale = 'en-US'): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat(locale, {
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
        ...(timeZone ? { timeZone } : {}),
    }).format(d);
}

/**
 * Season tag for a regressed GSAx/gm rating: "25-26" while the rating holds no
 * games from this season, then "26-27 · 3 GP" so a tiny sample reads as one.
 */
export function gsaxTag(ratedGp: number): string {
    return ratedGp > 0 ? `${CUR_TAG} · ${ratedGp} GP` : PREV_TAG;
}

/** Clock time without zone: "5:12 PM". */
export function fmtClock(iso: string, timeZone?: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', ...(timeZone ? { timeZone } : {}) }).format(d);
}

/** Today's NHL slate date (Eastern) as YYYY-MM-DD. */
export function easternDate(now: Date = new Date()): string {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    return p; // en-CA formats as YYYY-MM-DD
}

export function addDays(ymd: string, n: number): string {
    const [y, m, d] = ymd.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return t.toISOString().slice(0, 10);
}

/** "Oct 2" */
export function shortDate(ymd: string): string {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** "Thu, Oct 2" */
export function weekdayDate(ymd: string): string {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Date-tab label: "Today", "Tomorrow", "Yesterday" or "Thu, Oct 2". */
export function dayLabel(ymd: string, today: string): string {
    if (ymd === today) return 'Today';
    if (ymd === addDays(today, 1)) return 'Tomorrow';
    if (ymd === addDays(today, -1)) return 'Yesterday';
    return weekdayDate(ymd);
}

export function relAge(iso: string | null | undefined, now: Date): string | null {
    if (!iso) return null;
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return null;
    const mins = Math.max(0, Math.round((now.getTime() - t) / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const h = Math.round(mins / 60);
    if (h < 48) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
}

const SOURCES: Record<string, string> = {
    bovada: 'Bovada',
    draftkings: 'DraftKings via NHL',
    dk: 'DraftKings via NHL',
    nhl: 'DraftKings via NHL',
    fanduel: 'FanDuel',
    espn: 'ESPN BET',
    oddsapi: 'The Odds API',
    the_odds_api: 'The Odds API',
};

export function sourceLabel(src: string | null | undefined): string | null {
    if (!src) return null;
    return SOURCES[src.toLowerCase()] ?? src.charAt(0).toUpperCase() + src.slice(1);
}

/** "Brady Tkachuk" → "Tkachuk" (or "B. Tkachuk" with `initial`). */
export function lastName(full: string, initial = false): string {
    const parts = full.trim().split(/\s+/);
    if (parts.length < 2) return full.trim();
    // Keep particles with the surname: "Van Riemsdyk", "de Haan".
    let i = parts.length - 1;
    while (i > 1 && /^(van|von|de|der|la|le|di|da|st\.?)$/i.test(parts[i - 1])) i--;
    const last = parts.slice(i).join(' ');
    return initial ? `${parts[0].charAt(0)}. ${last}` : last;
}

/** Short display names for a set of players: a first initial only when last names collide. */
export function disambiguate(names: string[]): Map<string, string> {
    const counts = new Map<string, number>();
    for (const n of names) {
        const k = lastName(n).toLowerCase();
        counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const out = new Map<string, string>();
    for (const n of names) out.set(n, lastName(n, (counts.get(lastName(n).toLowerCase()) ?? 0) > 1));
    return out;
}

/** Parse "(W-L-OTL) | .SV% | GAA" into parts. */
export function parseGoalieLine(line: string | null | undefined): { record: string; sv: string; gaa: string } | null {
    if (!line) return null;
    const parts = line.split('|').map(s => s.trim());
    if (parts.length < 3) return null;
    return { record: parts[0].replace(/[()]/g, ''), sv: parts[1], gaa: parts[2] };
}

/** "Panthers win 1-0 in OT" style sentence for a final. */
export function finalSentence(winner: string, hi: number, lo: number, periodType: string | null): string {
    const tail = periodType === 'OT' ? ' in OT' : periodType === 'SO' ? ' in a shootout' : '';
    return `${winner} win ${hi}-${lo}${tail}`;
}
