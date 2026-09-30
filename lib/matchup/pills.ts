/**
 * The one producer of context chips on the matchup card.
 *
 * Every rule here is season-aware (pipeline/CONTRACT.md): a value is shown as
 * current only when it belongs to this season and clears its sample gate;
 * last season's values stay off the card (getPriorPills feeds the Preview);
 * a team with no earlier game gets "Season opener" (one shared chip when both
 * teams open), and the fatigue chips are always evaluated first-hand.
 */
import type { Prediction, Side, SideData } from '../../types/prediction';
import { PREV_TAG } from './format';

export type PillTone = 'neutral' | 'pos' | 'neg' | 'warn' | 'info';
export type PillState = 'current' | 'small' | 'prior';

export interface Pill {
    key: string;
    label: string;
    value?: string;
    tone: PillTone;
    state: PillState;
    /** Sample size for `small` chips. */
    n?: number;
    /** Season tag for `prior` chips. */
    seasonTag?: string;
    /** Tooltip / accessible description. */
    title: string;
}

/** Sample below which a current-season record is flagged as small (dashed + n=). */
export const SMALL_SAMPLE_GP = 5;
/** Only extreme special-teams ranks are worth a chip. */
const TOP = 5;
const BOTTOM = 28;

export function parseRecord(rec: string | null | undefined): { w: number; l: number; o: number; gp: number; ptsPct: number } | null {
    if (!rec) return null;
    const m = rec.match(/^(\d+)-(\d+)(?:-(\d+))?$/);
    if (!m) return null;
    const w = Number(m[1]);
    const l = Number(m[2]);
    const o = Number(m[3] ?? 0);
    const gp = w + l + o;
    return { w, l, o, gp, ptsPct: gp ? (2 * w + o) / (2 * gp) : 0 };
}

const ord = (n: number) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

function rankPill(kind: 'PP' | 'PK', s: SideData): Pill | null {
    const rank = kind === 'PP' ? s.ppRank : s.pkRank;
    const prev = kind === 'PP' ? s.ppRankPrev : s.pkRankPrev;
    if (rank != null) {
        if (rank > TOP && rank < BOTTOM) return null;
        const pct = kind === 'PP' ? s.ppPct : s.pkPct;
        const pctText = pct != null ? ` · ${(pct * 100).toFixed(1)}%` : '';
        return {
            key: kind.toLowerCase(),
            label: kind,
            value: `#${rank}`,
            tone: rank <= TOP ? 'pos' : 'neg',
            state: 'current',
            title: `#${rank} ${kind}${pctText} · ${s.gp} GP (${ord(rank)} of 32 this season)`,
        };
    }
    if (prev != null && (prev <= TOP || prev >= BOTTOM)) {
        return {
            key: `${kind.toLowerCase()}-prev`,
            label: kind,
            value: `#${prev}`,
            tone: 'neutral',
            state: 'prior',
            seasonTag: PREV_TAG,
            title: `Last season's final ${kind} rank (${PREV_TAG}): ${ord(prev)} of 32. This season's ranks appear once every team has played 10 games.`,
        };
    }
    return null;
}

/**
 * First game of the season for this side: nothing played before tonight.
 * Uses the schedule columns, not GP, because GP lags a day (a team on the
 * second night of a back-to-back still shows 0 GP when the CSV was built
 * before its first game went final). games_in_last_4 counts tonight.
 */
export function isOpener(s: SideData): boolean {
    return s.gp <= 0 && !s.isB2b && (s.gamesInLast4 ?? 1) <= 1;
}

/** Both teams open their season in this game (one shared chip on the card). */
export function bothOpeners(p: Prediction): boolean {
    return isOpener(p.home) && isOpener(p.away);
}

function seasonText(p: Prediction): string {
    return p.seasonId ? `${p.seasonId.slice(0, 4)}-${p.seasonId.slice(6)}` : 'new';
}

function fatiguePills(s: SideData, side: Side): Pill[] {
    const pills: Pill[] = [];
    if (s.isB2b) {
        pills.push({ key: 'b2b', label: 'B2B', tone: 'warn', state: 'current', title: 'Played yesterday (0 days of rest)' });
    } else if ((s.gamesInLast4 ?? 0) >= 3) {
        pills.push({ key: '3in4', label: '3 in 4', tone: 'warn', state: 'current', title: 'Third game in four days' });
    }
    if (side === 'away' && (s.roadTripGameN ?? 0) >= 4) {
        pills.push({
            key: 'trip',
            label: 'Trip',
            value: `G${s.roadTripGameN}`,
            tone: 'neutral',
            state: 'current',
            title: `Game ${s.roadTripGameN} of a road trip`,
        });
    }
    return pills;
}

/**
 * Context chips for one team, in display order. Fatigue (back-to-back,
 * 3 in 4) is always evaluated, even at 0 GP. Last season's special-teams
 * ranks are not shown on the card (getPriorPills feeds the Preview).
 */
export function getTeamPills(p: Prediction, side: Side): Pill[] {
    const s = p[side];
    if (s.gp <= 0) {
        const fatigue = fatiguePills(s, side);
        // A shared opener is one centred game chip (getGamePills); when the
        // whole slate is openers the chip says nothing and is dropped.
        if (!isOpener(s) || bothOpeners(p) || p.slateAllOpeners) return fatigue;
        return [
            {
                key: 'opener',
                label: 'Opener',
                tone: 'info',
                state: 'current',
                title: `First game of the ${seasonText(p)} regular season for the ${s.team.commonName}. Form, home/road and special-teams chips appear once games are played.`,
            },
            ...fatigue,
        ];
    }

    const pills: Pill[] = [];

    // Recent form, labelled with its real window (L3 at 3 GP, L7 from 7 GP).
    const form = parseRecord(s.l7);
    if (s.l7 && form) {
        const label = s.l7Label ?? `L${s.l7N || form.gp}`;
        pills.push({
            key: 'form',
            label,
            value: s.l7,
            tone: form.ptsPct >= 0.643 ? 'pos' : form.ptsPct <= 0.357 ? 'neg' : 'neutral',
            state: s.gp < SMALL_SAMPLE_GP ? 'small' : 'current',
            n: s.gp < SMALL_SAMPLE_GP ? s.gp : undefined,
            title: `${s.l7} (W-L-OTL) over the last ${s.l7N || form.gp} game${(s.l7N || form.gp) === 1 ? '' : 's'} this season`,
        });
    }

    // Home/road record: this season only, published from 5 location games.
    const loc = parseRecord(s.locRecord);
    if (s.locRecord && loc && (loc.ptsPct >= 0.7 || loc.ptsPct <= 0.3)) {
        const where = side === 'home' ? 'Home' : 'Road';
        pills.push({
            key: 'loc',
            label: where,
            value: s.locRecord,
            tone: loc.ptsPct >= 0.7 ? 'pos' : 'neg',
            state: 'current',
            title: `${s.locRecord} ${side === 'home' ? 'at home' : 'on the road'} this season (${s.locGp} GP)`,
        });
    }

    const pp = rankPill('PP', s);
    if (pp && pp.state === 'current') pills.push(pp);
    const pk = rankPill('PK', s);
    if (pk && pk.state === 'current') pills.push(pk);

    pills.push(...fatiguePills(s, side));
    return pills;
}

/**
 * Last season's extreme special-teams ranks, tagged 25-26. Kept off the
 * collapsed card; the Preview can list them under "Last season".
 */
export function getPriorPills(p: Prediction, side: Side): Pill[] {
    const s = p[side];
    return [rankPill('PP', s), rankPill('PK', s)].filter((x): x is Pill => !!x && x.state === 'prior');
}

/** Chips that describe the matchup rather than one team (season series). */
export function getGamePills(p: Prediction): Pill[] {
    const pills: Pill[] = [];
    if (bothOpeners(p) && !p.slateAllOpeners) {
        pills.push({
            key: 'opener',
            label: 'Opener · both',
            tone: 'info',
            state: 'current',
            title: `First game of the ${seasonText(p)} regular season for both the ${p.away.team.commonName} and the ${p.home.team.commonName}. Form, home/road and special-teams chips appear once games are played.`,
        });
    }
    // Shown from the 2nd meeting (one meeting already played); before that
    // last season's series lives only in the tooltip-free prior note.
    if (p.h2hGp >= 1 && p.away.h2hRecord) {
        const prev = p.away.h2hPrev ? ` Last season (${PREV_TAG}): ${p.away.team.triCode} ${p.away.h2hPrev}.` : '';
        pills.push({
            key: 'h2h',
            label: 'H2H',
            value: `${p.away.team.triCode} ${p.away.h2hRecord}`,
            tone: 'neutral',
            state: p.h2hGp < 2 ? 'small' : 'current',
            n: p.h2hGp < 2 ? p.h2hGp : undefined,
            title: `This season's meetings before tonight: ${p.away.team.triCode} ${p.away.h2hRecord} vs ${p.home.team.triCode} (${p.h2hGp} GP).${prev}`,
        });
    }
    return pills;
}

/** Last season's series, for the Preview tab before the teams have met this season. */
export function priorSeriesNote(p: Prediction): string | null {
    if (p.h2hGp >= 1 || !p.away.h2hPrev) return null;
    return `${PREV_TAG} season series: ${p.away.team.triCode} ${p.away.h2hPrev} vs ${p.home.team.triCode}`;
}

/** Last season's series as a tagged chip ({ tag: "25-26", text: "NYI 2-1-1" }) before the teams meet this season. */
export function priorSeries(p: Prediction): { tag: string; text: string } | null {
    if (p.h2hGp >= 1 || !p.away.h2hPrev) return null;
    return { tag: PREV_TAG, text: `${p.away.team.triCode} ${p.away.h2hPrev}` };
}

/** Visible text of a pill, as rendered by <StatChip> (for tests and aria). */
export function pillText(pill: Pill): string {
    return [pill.state === 'prior' ? pill.seasonTag : null, pill.label, pill.value].filter(Boolean).join(' ');
}

/** The one situational chip on a collapsed card (top-right). */
export interface CardChip {
    /** 1-3 short uppercase words, e.g. "B2B NYI". */
    label: string;
    /** Screen-reader / tooltip wording. */
    title: string;
}

/**
 * At most one chip per card, by priority: playoff series score, back-to-back,
 * 3 games in 4 nights, then a long road trip (game 4+). Everything else
 * (openers included) lives in the expanded panel.
 */
export function situationChip(p: Prediction, series?: { away: number; home: number } | null): CardChip | null {
    const a = p.away.team.triCode;
    const h = p.home.team.triCode;
    if (series) {
        const lead = series.away === series.home ? null : series.away > series.home ? a : h;
        const hi = Math.max(series.away, series.home);
        const lo = Math.min(series.away, series.home);
        return lead
            ? { label: `${lead} ${hi}-${lo}`, title: `Series: ${lead} leads ${hi}-${lo}` }
            : { label: `Tied ${hi}-${lo}`, title: `Series tied ${hi}-${lo}` };
    }
    const who = (f: (s: SideData) => boolean): string | null => {
        const aa = f(p.away);
        const hh = f(p.home);
        return aa && hh ? 'Both' : aa ? a : hh ? h : null;
    };
    const b2b = who(s => s.isB2b);
    if (b2b) return { label: `B2B ${b2b}`, title: `Back-to-back: ${b2b === 'Both' ? 'both teams' : b2b} played yesterday` };
    const three = who(s => !s.isB2b && (s.gamesInLast4 ?? 0) >= 3);
    if (three) return { label: `3in4 ${three}`, title: `Third game in four nights: ${three === 'Both' ? 'both teams' : three}` };
    const trip = p.away.roadTripGameN ?? 0;
    if (trip >= 4) return { label: `Trip G${trip}`, title: `${a}: game ${trip} of a road trip` };
    // Season openers stay in the expanded panel: in opening week they would tag most of the slate.
    return null;
}
