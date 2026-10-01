/**
 * Game lifecycle on the card: Pregame → Live → Final, driven by the NHL
 * score feed (app/api/scores) with the CSV's game_state as the fallback.
 */
import type { GameState, Prediction } from '../../types/prediction';

export interface LiveSide {
    score: number | null;
    sog: number | null;
}

export interface LiveGame {
    id: string;
    state: GameState;
    period: number | null;
    /** REG / OT / SO for the current (or last) period. */
    periodType: string | null;
    clock: string | null;
    intermission: boolean;
    /** How the game ended (gameOutcome.lastPeriodType). */
    lastPeriodType: string | null;
    away: LiveSide;
    home: LiveSide;
}

export type LiveMap = Record<string, LiveGame>;

export type Phase = 'pre' | 'live' | 'final';

const LIVE: GameState[] = ['LIVE', 'CRIT'];
const FINAL: GameState[] = ['FINAL', 'OFF'];

export function stateOf(p: Prediction, live?: LiveGame | null): GameState {
    return live?.state ?? p.gameState;
}

export function phaseOf(p: Prediction, live?: LiveGame | null): Phase {
    const s = stateOf(p, live);
    if (LIVE.includes(s)) return 'live';
    if (FINAL.includes(s)) return 'final';
    return 'pre';
}

const ORD = ['', '1st', '2nd', '3rd'];

/** "P2 12:41", "OT 3:12", "SO", "2nd INT". */
export function liveClock(g: LiveGame | null | undefined): string {
    if (!g || g.period == null) return 'Live';
    const pt = g.periodType ?? (g.period > 3 ? 'OT' : 'REG');
    if (pt === 'SO') return 'Shootout';
    const periodName = pt === 'OT' ? (g.period > 4 ? `${g.period - 3}OT` : 'OT') : `P${g.period}`;
    if (g.intermission) return pt === 'OT' ? 'OT INT' : `${ORD[g.period] ?? `P${g.period}`} INT`;
    if (g.clock === '00:00' || g.clock === '0:00') return `End ${periodName}`;
    return g.clock ? `${periodName} ${g.clock.replace(/^0(\d):/, '$1:')}` : periodName;
}

/** "FINAL", "FINAL/OT", "FINAL/SO". */
export function finalLabel(g: LiveGame | null | undefined): string {
    const t = g?.lastPeriodType ?? g?.periodType;
    return t === 'OT' ? 'FINAL/OT' : t === 'SO' ? 'FINAL/SO' : 'FINAL';
}

export function hasScore(g: LiveGame | null | undefined): g is LiveGame & { away: { score: number }; home: { score: number } } {
    return !!g && g.away.score != null && g.home.score != null;
}

/**
 * Did the pregame pick win? null when there was no pregame prediction, no
 * final score yet, or the pick was a dead-even 50/50.
 */
export function modelCorrect(p: Prediction, g: LiveGame | null | undefined): boolean | null {
    if (phaseOf(p, g) !== 'final' || !hasScore(g)) return null;
    if (p.status !== 'pregame' && p.status !== 'frozen') return null;
    const h = p.home.winPct;
    const a = p.away.winPct;
    if (h == null || a == null || h === a) return null;
    if (g.home.score === g.away.score) return null;
    const homeWon = g.home.score > g.away.score;
    return homeWon === h > a;
}

/** Card anchor: "#fla-car" (away-home). */
export function cardAnchor(p: Prediction): string {
    return `${p.away.team.triCode}-${p.home.team.triCode}`.toLowerCase();
}

const PHASE_ORDER: Record<Phase, number> = { live: 0, pre: 1, final: 2 };

/**
 * Slate order: LIVE, then upcoming (by puck drop), then FINAL.
 */
export function sortSlate(preds: Prediction[], live: LiveMap): Prediction[] {
    return [...preds].sort((a, b) => {
        const ph = PHASE_ORDER[phaseOf(a, live[a.id])] - PHASE_ORDER[phaseOf(b, live[b.id])];
        if (ph) return ph;
        const t = a.startTimeUtc.localeCompare(b.startTimeUtc);
        return t || a.id.localeCompare(b.id);
    });
}

/** Every game on the slate is final and has its score: nothing left to fetch. */
export function slateDone(preds: Prediction[], live: LiveMap): boolean {
    return preds.length > 0 && preds.every(p => phaseOf(p, live[p.id]) === 'final' && hasScore(live[p.id]));
}

/**
 * Polling cadence for the score feed (ms), or null for "don't poll":
 * every 30s while a game is live, in warm-up or due to start within 15
 * minutes; every 5 min otherwise once the slate has started; never before
 * the first puck drop is near, and never again once every game is final
 * with a score. (The hook also pauses while the tab is hidden.)
 */
export function pollInterval(preds: Prediction[], live: LiveMap, now: number): number | null {
    if (!preds.length) return null;
    let started = false;
    let hot = false;
    let allFinal = true;
    for (const p of preds) {
        const g = live[p.id];
        const ph = phaseOf(p, g);
        const t = new Date(p.startTimeUtc).getTime();
        if (ph !== 'final') allFinal = false;
        if (ph === 'live' || stateOf(p, g) === 'PRE') hot = true;
        if (ph !== 'final' && Number.isFinite(t) && t - now <= 15 * 60_000) {
            started = true;
            if (now >= t - 15 * 60_000 && now <= t + 4 * 3600_000) hot = true;
        }
        if (ph !== 'pre') started = true;
    }
    if (allFinal) {
        // Every game is over: one fetch to get the final scores, then stop.
        return preds.every(p => hasScore(live[p.id])) ? null : 30_000;
    }
    if (hot) return 30_000;
    return started ? 5 * 60_000 : null;
}

/** The default slate: today if it has games, else the next day that does, else the latest. */
export function defaultDate(dates: string[], today: string): string | null {
    if (!dates.length) return null;
    if (dates.includes(today)) return today;
    return dates.find(d => d > today) ?? dates[dates.length - 1];
}
