import 'server-only';
import { RANK_KEYS, type GameCounts, type LeagueRates } from '@/lib/game/league-ranks';
import type { PonySeason } from './data';

/**
 * Per team-game counts for and against (RANK_KEYS order) from a Pony Score
 * season: skater rows give goals, xG, shots, attempts, faceoff wins, hits,
 * blocks, takeaways, giveaways and penalty minutes; unblocked attempts are a
 * team's attempts less the opponents' blocks; high-danger shots and
 * power-play goals come from the opposing goalies' rows (high-danger shots
 * faced, goals allowed while shorthanded).
 */
function teamGames(data: PonySeason): Map<string, Map<number, number[]>> {
    const idx = Object.fromEntries(RANK_KEYS.map((k, i) => [k, i])) as Record<(typeof RANK_KEYS)[number], number>;
    const by = new Map<string, Map<number, number[]>>();
    const row = (team: string, game: number) => {
        let t = by.get(team);
        if (!t) by.set(team, (t = new Map()));
        let r = t.get(game);
        if (!r) t.set(game, (r = RANK_KEYS.map(() => 0)));
        return r;
    };
    for (const s of data.skaters) {
        const r = row(s.team, s.game);
        r[idx.goals] += s.g;
        r[idx.xg] += s.ixg;
        r[idx.sog] += s.sog;
        r[idx.hits] += s.hit;
        r[idx.blocks] += s.blk;
        r[idx.pim] += s.pim;
        if (s.box) {
            r[idx.attempts] += s.box.att;
            r[idx.fo] += s.box.foW;
            r[idx.takeaways] += s.box.tk;
            r[idx.giveaways] += s.box.gv;
        }
    }
    for (const g of data.goalies) {
        if (!g.box) continue;
        const r = row(g.opp, g.game);
        r[idx.hd] += g.box.hdSa;
        r[idx.pp] += g.box.pkGa;
    }
    // Unblocked: attempts less the opponents' blocks (needs both sides' rows).
    for (const g of data.games.values()) {
        const a = by.get(g.away)?.get(g.id);
        const h = by.get(g.home)?.get(g.id);
        if (!a || !h) continue;
        a[idx.unblocked] = a[idx.attempts] - h[idx.blocks];
        h[idx.unblocked] = h[idx.attempts] - a[idx.blocks];
    }
    return by;
}

/** Every club's per-game rates for and against, plus the team's own game rows. */
export function leagueRates(data: PonySeason, tri: string): LeagueRates {
    const by = teamGames(data);
    const teams: LeagueRates['teams'] = {};
    const own: Record<number, GameCounts> = {};
    for (const [team, games] of by) {
        const f = RANK_KEYS.map(() => 0);
        const ag = RANK_KEYS.map(() => 0);
        let gp = 0;
        for (const [id, r] of games) {
            const g = data.games.get(id);
            const opp = g && by.get(g.away === team ? g.home : g.away)?.get(id);
            if (!opp) continue;
            gp++;
            r.forEach((v, i) => (f[i] += v));
            opp.forEach((v, i) => (ag[i] += v));
            if (team === tri) own[id] = [r.map(v => Math.round(v * 1000) / 1000), opp.map(v => Math.round(v * 1000) / 1000)];
        }
        const per = (xs: number[]) => xs.map(v => (gp ? Math.round((v / gp) * 1000) / 1000 : 0));
        teams[team] = { gp, for: per(f), ag: per(ag) };
    }
    return { teams, own };
}
