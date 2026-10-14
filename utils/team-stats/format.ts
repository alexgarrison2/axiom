/** Number formatting shared by the Teams table and team pages. */

export const MINUS = '−';

/** "+12" / "−5" / "0" (true minus sign). */
export function signed(v: number, digits = 0): string {
    if (!Number.isFinite(v)) return '—';
    const r = Number(v.toFixed(digits));
    if (r === 0) return (0).toFixed(digits);
    return `${r > 0 ? '+' : MINUS}${Math.abs(r).toFixed(digits)}`;
}

/** .650 style (no leading zero). */
export function pct3(v: number): string {
    if (!Number.isFinite(v)) return '—';
    const s = v.toFixed(3);
    return s.startsWith('0') ? s.slice(1) : s.startsWith('1') ? s : s;
}

/** mm:ss from seconds. */
export function mmss(sec: number | null): string {
    if (sec === null || !Number.isFinite(sec)) return '—';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}

/** "Apr 30" from YYYY-MM-DD (no timezone drift). */
export function shortDate(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number);
    if (!y || !m || !d) return iso;
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function ordinal(n: number): string {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** A playoff-odds percentage (0-100), never a hard 0% or 100% from a simulation: "<1%", "63%", ">99%". */
export function oddsPct(p: number): string {
    return p < 1 ? '<1%' : p > 99 ? '>99%' : `${Math.round(p)}%`;
}

/** A game stays "next" for 3 hours after puck drop (it is on, or just ended). */
export const UPCOMING_GRACE_MS = 3 * 3600 * 1000;

/** Index of the first game (start times, earliest first) still upcoming at `now`; -1 when all are past. A null start counts as upcoming. */
export function firstUpcoming(starts: (string | null)[], now: number): number {
    return starts.findIndex(s => !s || !(Date.parse(s) < now - UPCOMING_GRACE_MS));
}

/** "Oct 1" + " · 8:00 PM" in the viewer's zone. */
export function localTime(utc: string): string {
    const t = Date.parse(utc);
    if (!Number.isFinite(t)) return '';
    return new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** "Injured Reserve" → "IR", "Day-To-Day" → "DTD" etc.; anything else uppercased as-is. */
export function injuryCode(status: string): string {
    const s = status.toLowerCase();
    if (s.includes('long') && s.includes('reserve')) return 'LTIR';
    if (s.includes('reserve')) return 'IR';
    if (s.includes('day')) return 'DTD';
    if (s.includes('suspen')) return 'SUSP';
    return status.toUpperCase();
}
