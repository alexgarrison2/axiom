import { describe, expect, it } from 'vitest';
import { filterGames, leagueRank, refKey, sideValues, TEAM_STAT_KEYS, STAT_BY_KEY, unpackTeamGames, type LastKey, type LocationKey, type RestKey } from '../matchup-stats';
import { leagueReference, teamGamesPayload, windowGames } from '../matchup-stats-server';

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const LOCS: LocationKey[] = ['all', 'home', 'road'];
const RESTS: RestKey[] = ['all', 0, 1, 2, 3];
const LASTS: LastKey[] = ['all', 5, 10];

// Real data: the league reference against the team payloads the browser ranks with.
describe('league reference (real data)', () => {
    const league = leagueReference();
    const teams = [...windowGames().keys()].flatMap(tri => {
        const p = teamGamesPayload(tri);
        return p ? [{ tri, games: unpackTeamGames(p) }] : [];
    });

    it('holds every team at most once per slice', () => {
        for (const slice of Object.values(league.ref)) for (const vals of Object.values(slice)) expect(vals!.length).toBeLessThanOrEqual(teams.length);
    });

    it("puts each team's unfiltered value (as the browser computes it) on its own entry", () => {
        for (const { tri, games } of teams) {
            for (const location of LOCS)
                for (const rest of RESTS)
                    for (const last of LASTS) {
                        const v = sideValues(tri, filterGames(games, { location, rest, starter: null, last }));
                        const slice = league.ref[refKey(location, rest, last)];
                        for (const k of TEAM_STAT_KEYS) {
                            const x = v[k];
                            if (x == null || !Number.isFinite(x)) continue;
                            expect(slice[k]!.some(y => Math.abs(y - r3(x)) < 1e-9), `${tri} ${refKey(location, rest, last)} ${k}`).toBe(true);
                        }
                    }
        }
    });

    it('never ranks a starter-filtered side past the number of teams', () => {
        for (const { tri, games } of teams) {
            const starters = new Set(games.map(g => g.row.starter).filter((s): s is string => !!s));
            for (const starter of starters) {
                const f = { location: 'all' as const, rest: 'all' as const, starter, last: 'all' as const };
                const v = sideValues(tri, filterGames(games, f));
                const own = sideValues(tri, filterGames(games, { ...f, starter: null }));
                const slice = league.ref[refKey('all', 'all')];
                for (const k of TEAM_STAT_KEYS) {
                    const r = leagueRank(v[k], slice[k], STAT_BY_KEY.get(k)!.higherBetter, own[k]);
                    if (!r) continue;
                    expect(r.outOf, `${tri} ${starter} ${k}`).toBeLessThanOrEqual(teams.length);
                    expect(r.rank).toBeLessThanOrEqual(r.outOf);
                }
            }
        }
    });
});
