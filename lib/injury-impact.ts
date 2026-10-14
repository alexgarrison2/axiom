import 'server-only';
import { loadPonySeason } from '@/lib/pony/data';
import { prevSeasonId } from '@/utils/team-stats/season';
import { SEASON_ID } from '@/lib/season';

/**
 * How much an injured player matters to his team right now, for ordering
 * injury lists (team page, matchup cards): players who dressed in one of the
 * team's last two games come first, then everyone by role. Role is his share
 * of the team's minutes plus scoring, per team game, blended from last season
 * toward this one as this season's games come in (a star hurt in camp still
 * ranks as a star). Goalies count by their share of the crease the same way.
 * Built from the Pony Score season files, cached per process.
 */

export interface InjuryImpact {
    /** Dressed in one of his team's last two games this season. */
    recent: boolean;
    /** Minutes per team game plus 6 x points per team game, blended across seasons. */
    score: number;
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, '').trim();

interface Usage {
    toi: number;
    pts: number;
    team: string;
}

function usage(season: string) {
    const data = loadPonySeason(season);
    const byId = new Map<number, Usage>();
    const teamGames = new Map<string, string[]>();
    const lastTwo = new Map<string, Set<number>>();
    const names = new Map<string, number>();
    const recent = new Set<string>();
    if (!data) return { byId, teamGames, lastTwo, names, recent, data };
    for (const g of data.games.values()) for (const t of [g.away, g.home]) teamGames.set(t, [...(teamGames.get(t) ?? []), `${g.date}|${g.id}`]);
    for (const [t, list] of teamGames) {
        list.sort();
        lastTwo.set(t, new Set(list.slice(-2).map(k => Number(k.split('|')[1]))));
    }
    const add = (id: number, team: string, toi: number, pts: number) => {
        const u = byId.get(id) ?? { toi: 0, pts: 0, team };
        u.toi += toi;
        u.pts += pts;
        u.team = team;
        byId.set(id, u);
    };
    for (const s of data.skaters) add(s.player, s.team, s.toi, s.g + s.a1 + s.a2);
    for (const g of data.goalies) add(g.player, g.team, g.toi, 0);
    for (const r of [...data.skaters, ...data.goalies]) if (lastTwo.get(r.team)?.has(r.game)) recent.add(`${r.player}|${r.team}`);
    for (const p of data.players.values()) names.set(norm(`${p.first} ${p.last}`), p.id);
    return { byId, teamGames, lastTwo, names, recent, data };
}

let cache: { key: string; fn: (id: number | null | undefined, name: string, team: string) => InjuryImpact } | null = null;

/** A scorer for injured players; call once per request and reuse. */
export function injuryImpactScorer(): (id: number | null | undefined, name: string, team: string) => InjuryImpact {
    const cur = usage(SEASON_ID);
    const prev = usage(prevSeasonId(SEASON_ID));
    const key = `${cur.data?.builtAt ?? ''}|${prev.data?.builtAt ?? ''}`;
    if (cache?.key === key) return cache.fn;

    const rate = (u: ReturnType<typeof usage>, id: number, team: string | null) => {
        const r = u.byId.get(id);
        if (!r) return 0;
        const games = u.teamGames.get(team ?? r.team)?.length ?? 0;
        return games ? r.toi / 60 / games + (6 * r.pts) / games : 0;
    };
    const fn = (id: number | null | undefined, name: string, team: string): InjuryImpact => {
        const pid = id ?? cur.names.get(norm(name)) ?? prev.names.get(norm(name)) ?? null;
        if (pid == null) return { recent: false, score: 0 };
        const played = cur.recent.has(`${pid}|${team}`);
        const n = cur.teamGames.get(team)?.length ?? 0;
        const w = Math.min(1, n / 20);
        // This season is per team game for his current team; last season per game of the team he played for.
        const score = w * rate(cur, pid, team) + (1 - w) * rate(prev, pid, null);
        return { recent: !!played, score: Math.round(score * 100) / 100 };
    };
    cache = { key, fn };
    return fn;
}

/** Most immediate first: dressed in the last two games, then by role. */
export function byImpact<T>(items: T[], impact: (x: T) => InjuryImpact): T[] {
    const k = new Map(items.map(x => [x, impact(x)]));
    return [...items].sort((a, b) => {
        const ia = k.get(a)!;
        const ib = k.get(b)!;
        return Number(ib.recent) - Number(ia.recent) || ib.score - ia.score;
    });
}

/**
 * The report's note without the byline ("…, Lia Assimakopoulos of The Dallas Morning News reports."), or
 * null when ESPN only repeats the status ("ir-nr", "day-to-day").
 */
export function injuryNote(comment: string | null | undefined): string | null {
    const c = (comment ?? '').trim();
    if (c.length < 24 || !/\s/.test(c)) return null;
    return c.replace(/,\s+[^,]{3,80}\s+(?:of|from)\s+[^,]{3,80}\s+(?:reports|relays|writes|tweets|says)\.?$/i, '.').replace(/\s+/g, ' ');
}
