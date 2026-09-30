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

/** Today's date (YYYY-MM-DD) in America/Chicago, matching the pipeline's slate dates. */
export function slateDate(offsetDays = 0, now = new Date()): string {
    const d = new Date(now.getTime() + offsetDays * 86400000);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** "Oct 1" + " · 8:00 PM" in the viewer's zone. */
export function localTime(utc: string): string {
    const t = Date.parse(utc);
    if (!Number.isFinite(t)) return '';
    return new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
