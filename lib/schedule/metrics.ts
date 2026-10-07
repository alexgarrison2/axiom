/**
 * Schedule metrics for the team Schedule tab: rest, density windows
 * (back-to-backs, 3-in-4, 4-in-6, 5-in-8), travel legs and road trips, body
 * clock, opponent strength and rolling difficulty, plus league comparisons.
 *
 * Pure: the server feeds it the season schedule (pipeline/data/schedule_detail_<season>.json),
 * results, model win % and opponent strengths (utils/team-stats/schedule-server.ts).
 * Method notes live on /methodology#schedule.
 */
import { ARENAS, haversineMi, venueFor, type ResolvedVenue } from './arenas';
import { clockLabel, dayNumber, localHour, utcOffsetHours, zoneLabel } from './time';

// ── inputs ───────────────────────────────────────────────────────────────────

/** One game as the pipeline stores it (fetch_schedule_detail.py). */
export interface RawGame {
    id: number;
    type: number;
    date: string;
    start: string | null;
    home: string;
    away: string;
    venue?: string | null;
    tz?: string | null;
    neutral?: boolean;
    event?: string | null;
    state?: string | null;
    hs?: number | null;
    as?: number | null;
    last?: string | null;
}

export interface TeamResult {
    gf: number;
    ga: number;
    code: 'W' | 'L' | 'OTL';
    ot: 'OT' | 'SO' | null;
}

export interface WinPct {
    pct: number;
    /** P(loss in OT or a shootout), percent, when the forecast splits regulation from OT. */
    otl?: number;
    src: 'pred' | 'sim';
}

export interface ScheduleInputs {
    /** Opponent strength as a z-score across the league (0 = average). */
    strength?: Record<string, number>;
    /** `${gameId}|${tri}` → the team's result. */
    results?: Map<string, TeamResult>;
    /** `${gameId}|${tri}` → the team's model win %. */
    winPct?: Map<string, WinPct>;
}

// ── tunables (documented on /methodology#schedule) ────────────────────────────

/** A venue farther than this from the home arena is a road game. */
export const ROAD_MI = 100;
/** Between two road games with at least this many days off, the team flies home. */
export const RETURN_HOME_REST = 3;
/** Local start before this hour is a day game. */
export const MATINEE_HOUR = 16;
/** Start at or after this hour on the home clock is a late body-clock start. */
export const LATE_BODY_HOUR = 21.5;
/** Start before this hour on the home clock is an early body-clock start. */
export const EARLY_BODY_HOUR = 12.5;
/** Rolling difficulty window (games, centred) and the toughest-stretch length. */
export const RIBBON_GAMES = 5;
export const STRETCH_GAMES = 8;
/** Difficulty model: logit per strength SD, home ice, back-to-back penalty. */
export const DIFF = { perSd: 0.42, homeIce: 0.1, b2b: 0.12 };
/** A gap of at least this many days off is a break (holidays, All-Star, Olympics). */
export const BREAK_DAYS = 4;

// ── outputs ──────────────────────────────────────────────────────────────────

export type DensityKind = 'b2b' | '3in4' | '4in6' | '5in8';
export type Tag = 'B2B' | '3IN4' | '4IN6' | '5IN8' | 'REST+' | 'REST-' | 'DAY' | 'LATE' | 'EARLY' | 'TZ' | 'OUTDOOR' | 'GLOBAL' | 'NEUTRAL' | 'TRAP';

export interface PlaceRef {
    key: string;
    city: string;
    lat: number;
    lon: number;
}

export interface GameEvent {
    kind: 'outdoor' | 'global' | 'neutral';
    /** The event's short name, e.g. "Winter Classic", "Global Series". */
    name: string;
}

export interface SchedGame {
    id: number;
    /** 1-based game number. */
    n: number;
    date: string;
    start: string | null;
    home: boolean;
    opp: string;
    venue: string;
    city: string;
    place: string;
    event: GameEvent | null;
    /** Venue local start, its zone label, ET start and the team's home-clock start. */
    local: string;
    localTz: string;
    et: string;
    body: string;
    bodyHour: number;
    /** Venue offset minus home offset, hours (−3: an Eastern team in the Pacific zone). */
    tzDelta: number;
    /** Zones crossed since the previous game's venue (signed). */
    tzShift: number;
    /** Days off before the game (null for the opener); same for the opponent. */
    rest: number | null;
    oppRest: number | null;
    b2b: boolean;
    oppB2b: boolean;
    dense: DensityKind[];
    onRoad: boolean;
    /** Miles travelled since the previous game (into this one). */
    mi: number;
    trip: number | null;
    oppRank: number;
    /** 0-100: how hard the game is for an average team (opponent, venue, rest). */
    diff: number;
    /** Centred rolling mean of `diff`. */
    ribbon: number;
    tags: Tag[];
    state: 'final' | 'live' | 'future';
    result: TeamResult | null;
    winPct: WinPct | null;
}

export interface Leg {
    from: PlaceRef;
    to: PlaceRef;
    mi: number;
    /** Index of the game this leg leads into (null: the trip home after the last game). */
    toGame: number | null;
    /** Index of the game this leg leaves from (null: from home at the season start or a break). */
    fromGame: number | null;
    trip: number | null;
    /** Day number the leg is flown (the arrival game's date, or the day after the last game). */
    day: number;
}

export interface Trip {
    id: number;
    first: number;
    last: number;
    games: number;
    mi: number;
    from: string;
    to: string;
    /** Distinct zones visited relative to home, e.g. [-2, -3]. */
    zones: number[];
}

export interface Band {
    kind: DensityKind;
    first: number;
    last: number;
}

export interface Break {
    after: number;
    days: number;
}

export interface Stretch {
    first: number;
    last: number;
    diff: number;
}

export interface ScheduleSummary {
    games: number;
    mi: number;
    b2b: number;
    b2bRoad: number;
    in3of4: number;
    in4of6: number;
    in5of8: number;
    longestTrip: { games: number; mi: number; trip: number } | null;
    longestHomestand: number;
    matinees: number;
    late: number;
    early: number;
    restEdge: number;
    restDeficit: number;
    zonesCrossed: number;
    peakWeek: { mi: number; first: number; last: number } | null;
    toughest: Stretch | null;
    softest: Stretch | null;
    /** Mean difficulty, 0-100. */
    sos: number;
    longestBreak: Break | null;
}

export interface TeamSchedule {
    tri: string;
    games: SchedGame[];
    legs: Leg[];
    trips: Trip[];
    bands: Band[];
    breaks: Break[];
    summary: ScheduleSummary;
}

// ── small pure pieces (exported for tests) ───────────────────────────────────

/** Days off before each game (null for the first). */
export function restDays(days: number[]): (number | null)[] {
    return days.map((d, i) => (i === 0 ? null : d - days[i - 1] - 1));
}

/**
 * Indices `i` at which a window of `n` games within `span` calendar days ends
 * (game i and the n-1 before it). 3-in-4 = (3, 4), 4-in-6 = (4, 6) …
 */
export function windowEnds(days: number[], n: number, span: number): number[] {
    const out: number[] = [];
    for (let i = n - 1; i < days.length; i++) if (days[i] - days[i - n + 1] <= span - 1) out.push(i);
    return out;
}

/** Merge window instances (each covers [end-n+1, end]) into contiguous bands. */
export function mergeWindows(ends: number[], n: number): [number, number][] {
    const out: [number, number][] = [];
    for (const e of ends) {
        const s = e - n + 1;
        const last = out[out.length - 1];
        if (last && s <= last[1]) last[1] = Math.max(last[1], e);
        else out.push([s, e]);
    }
    return out;
}

/** Largest sum of `values` over any `span`-day window, by day number. */
export function peakWindow(items: { day: number; value: number }[], span: number): { value: number; first: number; last: number } | null {
    if (!items.length) return null;
    const sorted = [...items].sort((a, b) => a.day - b.day);
    let best: { value: number; first: number; last: number } | null = null;
    let j = 0;
    let sum = 0;
    for (let i = 0; i < sorted.length; i++) {
        sum += sorted[i].value;
        while (sorted[i].day - sorted[j].day > span - 1) sum -= sorted[j++].value;
        if (!best || sum > best.value + 1e-9) best = { value: sum, first: sorted[j].day, last: sorted[i].day };
    }
    return best;
}

/** Centred rolling mean (shrinks at the ends). */
export function rollingMean(values: number[], width: number): number[] {
    const h = Math.floor(width / 2);
    return values.map((_, i) => {
        const a = Math.max(0, i - h);
        const b = Math.min(values.length - 1, i + h);
        let s = 0;
        for (let k = a; k <= b; k++) s += values[k];
        return s / (b - a + 1);
    });
}

/** Best (max or min) mean over consecutive windows of `len`. */
export function extremeStretch(values: number[], len: number, pick: 'max' | 'min'): Stretch | null {
    if (values.length < len) return null;
    let s = 0;
    for (let i = 0; i < len; i++) s += values[i];
    let best: Stretch = { first: 0, last: len - 1, diff: s / len };
    for (let i = len; i < values.length; i++) {
        s += values[i] - values[i - len];
        const m = s / len;
        if (pick === 'max' ? m > best.diff + 1e-9 : m < best.diff - 1e-9) best = { first: i - len + 1, last: i, diff: m };
    }
    return best;
}

export function classifyEvent(name: string | null | undefined, neutral: boolean | undefined, venue: ResolvedVenue): GameEvent | null {
    const n = (name ?? '').trim();
    if (/winter classic/i.test(n)) return { kind: 'outdoor', name: 'Winter Classic' };
    if (/stadium series/i.test(n)) return { kind: 'outdoor', name: 'Stadium Series' };
    if (/heritage classic/i.test(n)) return { kind: 'outdoor', name: 'Heritage Classic' };
    if (/global series/i.test(n) || venue.abroad) return { kind: 'global', name: 'Global Series' };
    if (venue.outdoor) return { kind: 'outdoor', name: n || 'Outdoor' };
    if (neutral) return { kind: 'neutral', name: n || 'Neutral site' };
    return null;
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const placeRef = (v: { key: string; city: string; lat: number; lon: number }): PlaceRef => ({ key: v.key, city: v.city, lat: v.lat, lon: v.lon });
const homePlace = (tri: string): PlaceRef & { tz: string } => ({ ...placeRef({ ...ARENAS[tri], key: tri }), tz: ARENAS[tri].tz });

function resultFromRaw(g: RawGame, tri: string): TeamResult | null {
    if (g.state !== 'OFF' && g.state !== 'FINAL') return null;
    if (g.hs == null || g.as == null) return null;
    const home = g.home === tri;
    const gf = home ? g.hs : g.as;
    const ga = home ? g.as : g.hs;
    const ot = g.last === 'OT' ? 'OT' : g.last === 'SO' ? 'SO' : null;
    return { gf, ga, code: gf > ga ? 'W' : ot ? 'OTL' : 'L', ot };
}

// ── per league ───────────────────────────────────────────────────────────────

/**
 * Every club's regular-season schedule with metrics. Needs the whole league
 * (opponent rest comes from the opponent's own schedule).
 */
export function buildLeagueSchedules(raw: RawGame[], inputs: ScheduleInputs = {}): Map<string, TeamSchedule> {
    const games = raw
        .filter(g => g.type === 2 && g.start && ARENAS[g.home] && ARENAS[g.away])
        .sort((a, b) => a.start!.localeCompare(b.start!) || a.id - b.id);
    const byTeam = new Map<string, RawGame[]>();
    for (const g of games) {
        for (const t of [g.home, g.away]) {
            if (!byTeam.has(t)) byTeam.set(t, []);
            byTeam.get(t)!.push(g);
        }
    }
    // Rest before each game for every club (opponent rest).
    const restOf = new Map<string, number | null>();
    for (const [tri, list] of byTeam) {
        const r = restDays(list.map(g => dayNumber(g.date)));
        list.forEach((g, i) => restOf.set(`${g.id}|${tri}`, r[i]));
    }
    // Strength ranks (1 = strongest).
    const strength = inputs.strength ?? {};
    const ranked = Object.keys(ARENAS).sort((a, b) => (strength[b] ?? 0) - (strength[a] ?? 0) || a.localeCompare(b));
    const rankOf = new Map(ranked.map((t, i) => [t, i + 1]));

    const out = new Map<string, TeamSchedule>();
    for (const [tri, list] of byTeam) out.set(tri, buildTeam(tri, list, { ...inputs, strength }, restOf, rankOf));
    return out;
}

function buildTeam(
    tri: string,
    list: RawGame[],
    inputs: ScheduleInputs & { strength: Record<string, number> },
    restOf: Map<string, number | null>,
    rankOf: Map<string, number>,
): TeamSchedule {
    const home = homePlace(tri);
    const days = list.map(g => dayNumber(g.date));
    const rest = restDays(days);

    const ends3 = windowEnds(days, 3, 4);
    const ends4 = windowEnds(days, 4, 6);
    const ends5 = windowEnds(days, 5, 8);
    const inBand = (ends: number[], n: number) => {
        const s = new Set<number>();
        for (const e of ends) for (let k = e - n + 1; k <= e; k++) s.add(k);
        return s;
    };
    const in3 = inBand(ends3, 3);
    const in4 = inBand(ends4, 4);
    const in5 = inBand(ends5, 5);

    const legs: Leg[] = [];
    const sched: SchedGame[] = [];
    let loc: PlaceRef & { tz: string } = home;
    let locGame: number | null = null;
    let prevOnRoad = false;
    let trip: number | null = null;
    let tripCount = 0;
    const localHours: number[] = [];

    list.forEach((g, i) => {
        const isHome = g.home === tri;
        const opp = isHome ? g.away : g.home;
        const venue = venueFor(g.venue, g.home, g.tz);
        const vRef = placeRef(venue);
        const onRoad = haversineMi(venue, home) > ROAD_MI;
        const start = new Date(g.start!);
        let mi = 0;

        const addLeg = (from: PlaceRef, to: PlaceRef, toGame: number | null, fromGame: number | null, legTrip: number | null, day: number) => {
            const d = haversineMi(from, to);
            if (d < 1) return 0;
            legs.push({ from: placeRef(from), to: placeRef(to), mi: d, toGame, fromGame, trip: legTrip, day });
            return d;
        };

        if (onRoad) {
            const flyHome = i > 0 && prevOnRoad && (rest[i] ?? 0) >= RETURN_HOME_REST;
            if (flyHome) {
                // Back home between road games: the previous trip ends there.
                mi += addLeg(loc, home, null, locGame, trip, days[i - 1] + 1);
                loc = home;
                locGame = null;
            }
            if (!prevOnRoad || flyHome) trip = ++tripCount;
            mi += addLeg(loc, vRef, i, locGame, trip, days[i]);
        } else {
            mi += addLeg(loc, vRef, i, locGame, prevOnRoad ? trip : null, days[i]);
            trip = null;
        }

        const prevTz = loc.tz;
        const homeOff = utcOffsetHours(home.tz, start);
        const venueOff = utcOffsetHours(venue.tz, start);
        const prevOff = utcOffsetHours(prevTz, start);
        const bodyHour = localHour(home.tz, start);
        const localH = localHour(venue.tz, start);
        const oppRest = restOf.get(`${g.id}|${opp}`) ?? null;
        const b2b = rest[i] === 0;
        const oppB2b = oppRest === 0;
        const dense: DensityKind[] = [];
        if (b2b || rest[i + 1] === 0) dense.push('b2b');
        if (in3.has(i)) dense.push('3in4');
        if (in4.has(i)) dense.push('4in6');
        if (in5.has(i)) dense.push('5in8');

        const event = classifyEvent(g.event, g.neutral, venue);
        const z = inputs.strength[opp] ?? 0;
        const neutralAbroad = event?.kind === 'global';
        const logit = DIFF.perSd * z + (neutralAbroad ? 0 : onRoad ? DIFF.homeIce : -DIFF.homeIce) + (b2b ? DIFF.b2b : 0) - (oppB2b ? DIFF.b2b : 0);

        const key = `${g.id}|${tri}`;
        const result = inputs.results?.get(key) ?? resultFromRaw(g, tri);
        const live = g.state === 'LIVE' || g.state === 'CRIT';
        sched.push({
            id: g.id,
            n: i + 1,
            date: g.date,
            start: g.start,
            home: isHome,
            opp,
            venue: venue.name,
            city: venue.city,
            place: venue.key,
            event,
            local: clockLabel(venue.tz, start),
            localTz: zoneLabel(venue.tz, start),
            et: clockLabel('America/New_York', start),
            body: clockLabel(home.tz, start),
            bodyHour,
            tzDelta: Math.round(venueOff - homeOff),
            tzShift: Math.round(venueOff - prevOff),
            rest: rest[i],
            oppRest,
            b2b,
            oppB2b,
            dense,
            onRoad,
            mi,
            trip: onRoad ? trip : null,
            oppRank: rankOf.get(opp) ?? 16,
            diff: 100 * sigmoid(logit),
            ribbon: 0,
            tags: [],
            state: result ? 'final' : live ? 'live' : 'future',
            result: result ?? null,
            winPct: result ? null : inputs.winPct?.get(key) ?? null,
        });
        localHours.push(localH);

        loc = { ...vRef, tz: venue.tz };
        locGame = i;
        prevOnRoad = onRoad;
    });
    // Home after the last game.
    if (prevOnRoad && list.length) legs.push({ from: placeRef(loc), to: placeRef(home), mi: haversineMi(loc, home), toGame: null, fromGame: list.length - 1, trip, day: days[days.length - 1] + 1 });


    // Rolling difficulty.
    const ribbon = rollingMean(sched.map(g => g.diff), RIBBON_GAMES);
    sched.forEach((g, i) => (g.ribbon = ribbon[i]));

    // Trips.
    const trips: Trip[] = [];
    for (const g of sched) {
        if (g.trip == null) continue;
        let t = trips.find(x => x.id === g.trip);
        if (!t) {
            t = { id: g.trip, first: g.n - 1, last: g.n - 1, games: 0, mi: 0, from: g.date, to: g.date, zones: [] };
            trips.push(t);
        }
        t.last = g.n - 1;
        t.games += 1;
        t.to = g.date;
        if (g.tzDelta !== 0 && !t.zones.includes(g.tzDelta)) t.zones.push(g.tzDelta);
    }
    for (const l of legs) {
        const t = l.trip != null ? trips.find(x => x.id === l.trip) : undefined;
        if (t) t.mi += l.mi;
    }

    // Tags.
    const isTripEnd = (i: number) => {
        const g = sched[i];
        if (g.trip == null) return false;
        const t = trips.find(x => x.id === g.trip)!;
        return t.last === i && t.games >= 4;
    };
    sched.forEach((g, i) => {
        const tags: Tag[] = [];
        if (g.b2b) tags.push('B2B');
        if (g.dense.includes('3in4')) tags.push('3IN4');
        if (g.dense.includes('4in6')) tags.push('4IN6');
        if (g.dense.includes('5in8')) tags.push('5IN8');
        if (g.oppB2b && (g.rest ?? 0) >= 1) tags.push('REST+');
        if (g.b2b && (g.oppRest ?? 0) >= 1) tags.push('REST-');
        if (localHours[i] < MATINEE_HOUR) tags.push('DAY');
        if (g.bodyHour >= LATE_BODY_HOUR) tags.push('LATE');
        else if (g.bodyHour < EARLY_BODY_HOUR) tags.push('EARLY');
        if (Math.abs(g.tzShift) >= 2) tags.push('TZ');
        if (g.event?.kind === 'outdoor') tags.push('OUTDOOR');
        if (g.event?.kind === 'global') tags.push('GLOBAL');
        if (g.event?.kind === 'neutral') tags.push('NEUTRAL');
        const weak = g.oppRank >= 22;
        const next = sched[i + 1];
        const lookAhead = !!next && next.oppRank <= 5 && (next.rest ?? 9) <= 1;
        if (weak && (g.b2b || isTripEnd(i) || lookAhead)) tags.push('TRAP');
        g.tags = tags;
    });

    // Density bands for drawing.
    const bands: Band[] = [];
    const b2bEnds = sched.map((g, i) => (g.b2b ? i : -1)).filter(i => i >= 0);
    for (const [kind, ends, n] of [
        ['b2b', b2bEnds, 2],
        ['3in4', ends3, 3],
        ['4in6', ends4, 4],
        ['5in8', ends5, 5],
    ] as [DensityKind, number[], number][]) {
        for (const [first, last] of mergeWindows(ends, n)) bands.push({ kind, first, last });
    }

    const breaks: Break[] = [];
    rest.forEach((r, i) => {
        if (r != null && r >= BREAK_DAYS) breaks.push({ after: i - 1, days: r });
    });

    // Homestands.
    let longestHomestand = 0;
    let run = 0;
    for (const g of sched) {
        run = g.onRoad ? 0 : run + 1;
        longestHomestand = Math.max(longestHomestand, run);
    }

    const peak = peakWindow(
        legs.map(l => ({ day: l.day, value: l.mi })),
        7,
    );
    const longest = trips.reduce<Trip | null>((best, t) => (!best || t.games > best.games || (t.games === best.games && t.mi > best.mi) ? t : best), null);
    const zonesCrossed = sched.reduce((s, g) => s + Math.abs(g.tzShift), 0) + (prevOnRoadAtEnd(sched) ? Math.abs(sched[sched.length - 1].tzDelta) : 0);
    const diffs = sched.map(g => g.diff);
    const summary: ScheduleSummary = {
        games: sched.length,
        mi: legs.reduce((s, l) => s + l.mi, 0),
        b2b: b2bEnds.length,
        b2bRoad: sched.filter(g => g.b2b && g.onRoad).length,
        in3of4: ends3.length,
        in4of6: ends4.length,
        in5of8: ends5.length,
        longestTrip: longest ? { games: longest.games, mi: longest.mi, trip: longest.id } : null,
        longestHomestand,
        matinees: sched.filter(g => g.tags.includes('DAY')).length,
        late: sched.filter(g => g.tags.includes('LATE')).length,
        early: sched.filter(g => g.tags.includes('EARLY')).length,
        restEdge: sched.filter(g => g.tags.includes('REST+')).length,
        restDeficit: sched.filter(g => g.tags.includes('REST-')).length,
        zonesCrossed,
        peakWeek: peak ? { mi: peak.value, first: peak.first, last: peak.last } : null,
        toughest: extremeStretch(diffs, STRETCH_GAMES, 'max'),
        softest: extremeStretch(diffs, STRETCH_GAMES, 'min'),
        sos: diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : 50,
        longestBreak: breaks.reduce<Break | null>((b, x) => (!b || x.days > b.days ? x : b), null),
    };
    return { tri, games: sched, legs, trips, bands, breaks, summary };
}

function prevOnRoadAtEnd(sched: SchedGame[]): boolean {
    return sched.length > 0 && sched[sched.length - 1].onRoad;
}

// ── league comparison ────────────────────────────────────────────────────────

export interface LeagueStat {
    value: number;
    avg: number;
    /** 1 = highest in the league. */
    rank: number;
    of: number;
}

export type ComparedKey = 'mi' | 'b2b' | 'in3of4' | 'in4of6' | 'matinees' | 'restNet' | 'sos' | 'zonesCrossed' | 'longestTrip';

export function compareToLeague(all: Map<string, TeamSchedule>, tri: string): Record<ComparedKey, LeagueStat> {
    const pick: Record<ComparedKey, (s: ScheduleSummary) => number> = {
        mi: s => s.mi,
        b2b: s => s.b2b,
        in3of4: s => s.in3of4,
        in4of6: s => s.in4of6,
        matinees: s => s.matinees,
        restNet: s => s.restEdge - s.restDeficit,
        sos: s => s.sos,
        zonesCrossed: s => s.zonesCrossed,
        longestTrip: s => s.longestTrip?.games ?? 0,
    };
    const teams = [...all.values()];
    const own = all.get(tri);
    const out = {} as Record<ComparedKey, LeagueStat>;
    for (const k of Object.keys(pick) as ComparedKey[]) {
        const vals = teams.map(t => pick[k](t.summary));
        const value = own ? pick[k](own.summary) : 0;
        out[k] = {
            value,
            avg: vals.reduce((a, b) => a + b, 0) / (vals.length || 1),
            rank: 1 + vals.filter(v => v > value + 1e-9).length,
            of: vals.length,
        };
    }
    return out;
}
