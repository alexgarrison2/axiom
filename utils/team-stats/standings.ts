import { isWin } from './game-row';
import { CONFERENCE_OF, DIVISION_OF, DIVISIONS } from './teams';
import type { Division, GameRow, TeamStat } from './types';

const INITIAL: Record<Division, string> = { Atlantic: 'A', Metro: 'M', Central: 'C', Pacific: 'P' };

const pointsOf = (g: GameRow) => (isWin(g.result) ? 2 : g.result === 'OTL' || g.result === 'SOL' ? 1 : 0);

export interface StandingsInfo {
    ranking: string;
    divRank: number;
    isPlayoff: boolean;
    magic_number?: number;
    tragic_number?: number;
}

export interface Bracket {
    conf: 'Eastern' | 'Western';
    matchups: [string, string][]; // [higher seed, lower seed] tricodes
}

/**
 * Official NHL order: points → regulation wins → regulation + OT wins →
 * head-to-head points (pairwise) → conference points → goal differential.
 * `standings` must be regular-season rows; `games` the same season's
 * regular-season games (for the head-to-head and conference tiebreaks).
 */
export function makeComparator(games: GameRow[]) {
    const h2h = new Map<string, number>();
    const conf = new Map<string, number>();
    for (const g of games) {
        if (g.type !== 2) continue;
        const pts = pointsOf(g);
        h2h.set(`${g.tri}|${g.opp}`, (h2h.get(`${g.tri}|${g.opp}`) ?? 0) + pts);
        const d1 = DIVISION_OF[g.tri];
        const d2 = DIVISION_OF[g.opp];
        if (d1 && d2 && CONFERENCE_OF[d1] === CONFERENCE_OF[d2]) conf.set(g.tri, (conf.get(g.tri) ?? 0) + pts);
    }
    return (a: TeamStat, b: TeamStat) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.rw !== a.rw) return b.rw - a.rw;
        if (b.row !== a.row) return b.row - a.row;
        const ah = h2h.get(`${a.tri}|${b.tri}`) ?? 0;
        const bh = h2h.get(`${b.tri}|${a.tri}`) ?? 0;
        if (ah !== bh) return bh - ah;
        const ac = conf.get(a.tri) ?? 0;
        const bc = conf.get(b.tri) ?? 0;
        if (ac !== bc) return bc - ac;
        if (b.goal_diff !== a.goal_diff) return b.goal_diff - a.goal_diff;
        return a.tri.localeCompare(b.tri);
    };
}

/**
 * Division ranks, the 16 playoff spots (top 3 per division + 2 wild cards
 * per conference), magic / tragic numbers and the first-round bracket.
 * Before any game is played nobody is ranked.
 */
export function computeStandings(standings: TeamStat[], games: GameRow[], seasonGames: number) {
    const cmp = makeComparator(games);
    const info = new Map<string, StandingsInfo>();
    const brackets: Bracket[] = [];
    const anyPlayed = standings.some(s => s.gp > 0);

    const divMap = new Map<Division, TeamStat[]>();
    for (const d of DIVISIONS) divMap.set(d, []);
    for (const s of standings) {
        const d = DIVISION_OF[s.tri];
        if (d) divMap.get(d)!.push(s);
    }
    for (const list of divMap.values()) list.sort(cmp);

    const playoff = new Set<string>();
    for (const list of divMap.values()) list.slice(0, 3).forEach(t => playoff.add(t.tri));

    for (const conf of ['Eastern', 'Western'] as const) {
        const divs = DIVISIONS.filter(d => CONFERENCE_OF[d] === conf);
        const confTeams = standings.filter(s => DIVISION_OF[s.tri] && CONFERENCE_OF[DIVISION_OF[s.tri]] === conf).sort(cmp);
        const wc = confTeams.filter(t => !playoff.has(t.tri)).slice(0, 2);
        wc.forEach(t => playoff.add(t.tri));

        // Magic / tragic numbers against the conference cut line.
        const inConf = confTeams.filter(t => playoff.has(t.tri));
        const outConf = confTeams.filter(t => !playoff.has(t.tri));
        const seed8 = inConf[inConf.length - 1];
        const seed9 = outConf[0];
        const maxPts = (t: TeamStat) => t.points + (seasonGames - t.gp) * 2;
        for (const t of confTeams) {
            const d = DIVISION_OF[t.tri];
            const divRank = divMap.get(d)!.findIndex(x => x.tri === t.tri) + 1;
            const entry: StandingsInfo = {
                ranking: anyPlayed ? `${INITIAL[d]}${divRank}` : '—',
                divRank,
                isPlayoff: anyPlayed && playoff.has(t.tri),
            };
            if (anyPlayed && seed8 && seed9) {
                if (playoff.has(t.tri)) {
                    entry.magic_number = Math.max(0, maxPts(seed9) - t.points + 1);
                    entry.tragic_number = Math.max(0, maxPts(t) - seed9.points + 1);
                } else {
                    entry.magic_number = Math.max(0, maxPts(seed8) - t.points + 1);
                    entry.tragic_number = Math.max(0, maxPts(t) - seed8.points + 1);
                }
            }
            info.set(t.tri, entry);
        }

        if (!anyPlayed) continue;
        const winners = divs.map(d => divMap.get(d)!).filter(l => l.length >= 3).sort((a, b) => cmp(a[0], b[0]));
        if (winners.length < 2 || wc.length < 2) continue;
        const [d1, d2] = winners;
        brackets.push({
            conf,
            matchups: [
                [d1[0].tri, wc[1].tri],
                [d2[0].tri, wc[0].tri],
                [d1[1].tri, d1[2].tri],
                [d2[1].tri, d2[2].tri],
            ],
        });
    }

    return { info, brackets, compare: cmp };
}

/** Attach ranking / playoff flags / magic numbers to rows (returns new objects). */
export function withStandings<T extends TeamStat>(rows: T[], info: Map<string, StandingsInfo>): T[] {
    return rows.map(r => {
        const i = info.get(r.tri);
        return i ? { ...r, ranking: i.ranking, divRank: i.divRank, isPlayoff: i.isPlayoff, magic_number: i.magic_number, tragic_number: i.tragic_number } : r;
    });
}
