/** Display formatting for the matchup card (pure). */
import { SEASON_START_YEAR } from '../season';
import { dateFormatter } from '../format/time';

/** Date.prototype.toLocaleDateString('en-US', opts) on a shared formatter ("Invalid Date" for a bad date, as before). */
function localeDate(dt: Date, opts: Intl.DateTimeFormatOptions): string {
    return Number.isNaN(dt.getTime()) ? 'Invalid Date' : dateFormatter('en-US', opts).format(dt);
}

/** "25-26" (previous season) and "26-27" (current). */
export const PREV_TAG = `${String(SEASON_START_YEAR - 1).slice(2)}-${String(SEASON_START_YEAR).slice(2)}`;
export const CUR_TAG = `${String(SEASON_START_YEAR).slice(2)}-${String(SEASON_START_YEAR + 1).slice(2)}`;
/** Full current-season label, "2026-27" (matches goalie_ratings games_by_season keys). */
export const CUR_SEASON_LABEL = `${SEASON_START_YEAR}-${String(SEASON_START_YEAR + 1).slice(2)}`;

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
    return dateFormatter(locale, {
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

/**
 * Season window a regressed GSAx/gm rating draws on, matching the team page:
 * "2024-25 to 2026-27", or "2024-25" when only one season is in it.
 */
export function gsaxWindow(seasons: string[], playedThisSeason: boolean): string {
    const all = new Set(seasons.filter(Boolean));
    if (playedThisSeason) all.add(CUR_SEASON_LABEL);
    const span = [...all].sort();
    return span.length > 1 ? `${span[0]} to ${span[span.length - 1]}` : (span[0] ?? 'prior seasons');
}

/** A pregame % (either side) within 1 pt of 50: no lean either way, so never graded as a pick. */
export function isCoinFlip(pct: number | null | undefined): boolean {
    return typeof pct === 'number' && Number.isFinite(pct) && Math.abs(pct - 50) < 1;
}

/** Short tag for a rating window: "2024-25 to 2025-26" → "24-26", "2025-26" → "25-26". */
export function windowTag(window: string | null | undefined): string | null {
    if (!window) return null;
    const years = [...window.matchAll(/(\d{4})-(\d{2})/g)];
    if (!years.length) return null;
    const first = years[0][1].slice(2);
    const last = years[years.length - 1][2];
    return `${first}-${last}`;
}

/** The site-wide small-sample gate: current-season games below which a value gets no good/bad colour. */
export const SMALL_SAMPLE_GP = 5;

/**
 * Headline tone of a regressed GSAx/gm rating: green / red only once the
 * goalie has a real sample this season; before that it is neutral and tagged
 * with the seasons it rests on.
 */
export function gsaxHeadline(v: number, curGp: number | null | undefined): { tone: 'pos' | 'neg' | 'neutral'; prior: boolean } {
    const prior = (curGp ?? 0) < SMALL_SAMPLE_GP;
    if (prior || Math.abs(v) <= 0.05) return { tone: 'neutral', prior };
    return { tone: v > 0 ? 'pos' : 'neg', prior };
}

/** Compact age for tight captions: "12h ago" → "12H", "just now" → "NOW". */
export function shortAge(iso: string | null | undefined, now: Date): string | null {
    const a = relAge(iso, now);
    if (!a) return null;
    return a === 'just now' ? 'now' : a.replace(/\s*ago$/, '');
}

/** Clock time without zone: "5:12 PM". */
export function fmtClock(iso: string, timeZone?: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return dateFormatter('en-US', { hour: 'numeric', minute: '2-digit', ...(timeZone ? { timeZone } : {}) }).format(d);
}

/** The Eastern calendar date as YYYY-MM-DD. */
export function easternDate(now: Date = new Date()): string {
    const p = dateFormatter('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    return p; // en-CA formats as YYYY-MM-DD
}

/** Wall-clock hour (0-23) on the Eastern clock at which the slate day rolls over. */
export const SLATE_ROLLOVER_HOUR = 3;

/**
 * Today's NHL slate date (Eastern, YYYY-MM-DD): the Eastern date, except that
 * the previous night's slate stays "today" until 3:00 am ET, so late West-coast
 * games still running after midnight are shown under Tonight, not Yesterday.
 * A pure function of the clock (no live scores), so the server render and the
 * browser's hydration agree at any instant.
 */
export function slateDate(now: Date = new Date()): string {
    const h = Number(dateFormatter('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(now));
    const d = easternDate(now);
    return h < SLATE_ROLLOVER_HOUR ? addDays(d, -1) : d;
}

export function addDays(ymd: string, n: number): string {
    const [y, m, d] = ymd.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return t.toISOString().slice(0, 10);
}

/** "Oct 2" */
export function shortDate(ymd: string): string {
    const [y, m, d] = ymd.split('-').map(Number);
    return localeDate(new Date(Date.UTC(y, m - 1, d)), { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** "Thu, Oct 2" */
export function weekdayDate(ymd: string): string {
    const [y, m, d] = ymd.split('-').map(Number);
    return localeDate(new Date(Date.UTC(y, m - 1, d)), { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
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
    nhl_partner_draftkings: 'DraftKings via NHL',
    espn_draftkings: 'DraftKings via ESPN',
    fanduel: 'FanDuel',
    espn: 'ESPN BET',
    oddsapi: 'The Odds API',
    the_odds_api: 'The Odds API',
};

/** Book names for ids the table above does not list. */
const BOOKS: Record<string, string> = {
    draftkings: 'DraftKings',
    fanduel: 'FanDuel',
    bovada: 'Bovada',
    betmgm: 'BetMGM',
    caesars: 'Caesars',
    pointsbet: 'PointsBet',
    betrivers: 'BetRivers',
    espnbet: 'ESPN BET',
    pinnacle: 'Pinnacle',
};

/** Feed prefixes that say how a price reached us, not whose price it is. */
const FEED_PREFIX = /^(?:nhl_partner|nhl|espn|oddsapi|the_odds_api|odds_api)[_\-\s]+/;

/**
 * Human book name for a market source id ("nhl_partner_draftkings" →
 * "DraftKings via NHL"). Unknown ids lose feed prefixes and underscores and
 * are title-cased; anything that still looks like an identifier is hidden (null).
 */
export function sourceLabel(src: string | null | undefined): string | null {
    if (!src || !src.trim()) return null;
    const key = src.trim().toLowerCase();
    if (SOURCES[key]) return SOURCES[key];
    const words = key.replace(FEED_PREFIX, '').split(/[_\-\s]+/).filter(Boolean);
    if (!words.length) return null;
    const out = words.map(w => BOOKS[w] ?? w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    return /^[A-Za-z][A-Za-z0-9 .&']{0,23}$/.test(out) && !/\d{3,}/.test(out) ? out : null;
}

const TAGS: Record<string, string> = {
    bovada: 'BOV',
    draftkings: 'DK',
    fanduel: 'FD',
    betmgm: 'MGM',
    caesars: 'CZR',
    pointsbet: 'PB',
    betrivers: 'BR',
    espnbet: 'ESPN',
    pinnacle: 'PIN',
};

/**
 * Terse tag for the book behind a source id, ignoring the feed it came
 * through: "bovada" → "BOV"; "nhl_partner_draftkings", "espn_draftkings" and
 * "nhl" → "DK". Null when unknown and unreadable.
 */
export function sourceTag(src: string | null | undefined): string | null {
    if (!src || !src.trim()) return null;
    const key = src.trim().toLowerCase();
    if (key === 'dk' || key === 'nhl') return 'DK';
    if (key === 'espn') return 'ESPN';
    const bare = key.replace(FEED_PREFIX, '').replace(/[_\-\s]+/g, '');
    if (TAGS[bare]) return TAGS[bare];
    const label = sourceLabel(src);
    return label ? label.replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase() : null;
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

/** "Panthers win 1-0 in OT" style sentence for a final (screen-reader text). */
export function finalSentence(winner: string, hi: number, lo: number, periodType: string | null): string {
    const tail = periodType === 'OT' ? ' in OT' : periodType === 'SO' ? ' in a shootout' : '';
    return `${winner} win ${hi}-${lo}${tail}`;
}

export interface GoalieStatLine {
    /** null = this season; PREV_TAG ("25-26") when the line is last season's. */
    tag: string | null;
    record: string;
    sv: string;
    gaa: string;
}

/**
 * The tiny season line under a goalie's name: this season once he has played
 * (goalie_cur_gp ≥ 1), else last season's line tagged "25-26" so it never
 * reads as current. null when neither exists.
 */
export function goalieSeasonLine(s: { goalieCur?: string | null; goaliePrev?: string | null; goalieCurGp?: number | null }): GoalieStatLine | null {
    const cur = (s.goalieCurGp ?? 0) >= 1 ? parseGoalieLine(s.goalieCur) : null;
    if (cur) return { tag: null, ...cur };
    const prev = parseGoalieLine(s.goaliePrev);
    return prev ? { tag: PREV_TAG, ...prev } : null;
}

/** Career starts vs this opponent before a record can read as strong or poor. */
export const VS_OPP_MIN_GP = 5;

/**
 * A goalie's career line against tonight's opponent, judged: "good" at a
 * .920+ save % or 70%+ of decisions won, "poor" at .880 or lower or 30% or
 * fewer, null when the sample is under VS_OPP_MIN_GP or the signals disagree.
 */
export function vsOppTone(vs: { record: string; sv: number } | null | undefined): 'good' | 'poor' | null {
    if (!vs) return null;
    const m = vs.record.match(/^(\d+)-(\d+)(?:-(\d+))?$/);
    if (!m) return null;
    const w = Number(m[1]);
    const decisions = w + Number(m[2]) + Number(m[3] ?? 0);
    if (decisions < VS_OPP_MIN_GP) return null;
    const winRate = w / decisions;
    const good = vs.sv >= 0.92 || winRate >= 0.7;
    const poor = vs.sv <= 0.88 || winRate <= 0.3;
    return good === poor ? null : good ? 'good' : 'poor';
}

/** ".917" from 0.917 ("1.000" stays). */
export function fmtSv(v: number): string {
    return v.toFixed(3).replace(/^0/, '');
}

/** Header words for a final: "FINAL/OT" → "FINAL · OT". */
export function finalWords(label: string): string {
    return label.replace('/', ' · ');
}

const utc = (ymd: string) => {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
};

/** Rail chip word for a slate day: Tonight, Yesterday, Thu (within a week), else Oct 9. */
export function railLabel(ymd: string, today: string): string {
    if (ymd === today) return 'Tonight';
    if (ymd === addDays(today, -1)) return 'Yesterday';
    const dt = utc(ymd);
    const days = Math.round((dt.getTime() - utc(today).getTime()) / 86_400_000);
    if (Math.abs(days) < 7) return localeDate(dt, { weekday: 'short', timeZone: 'UTC' });
    return localeDate(dt, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Page heading for the slate: "Wed · Sep 30" (rendered uppercase; year added when far from today). */
export function railHeading(ymd: string, today: string): string {
    const dt = utc(ymd);
    const far = Math.abs(dt.getTime() - utc(today).getTime()) > 150 * 86_400_000;
    const wd = localeDate(dt, { weekday: 'short', timeZone: 'UTC' });
    const md = localeDate(dt, { month: 'short', day: 'numeric', timeZone: 'UTC' });
    return `${wd} · ${md}${far ? ` ${dt.getUTCFullYear()}` : ''}`;
}
