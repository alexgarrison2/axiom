import { describe, expect, it } from 'vitest';
import { getGamePills, getTeamPills, pillText, priorSeriesNote } from '../pills';
import { byTeams, fixture } from './fixtures';

const texts = (pills: ReturnType<typeof getTeamPills>) => pills.map(pillText);

describe('getTeamPills (E2)', () => {
    const opening = fixture('opening_night');
    const week3 = fixture('week3');

    it('gives every 0-GP team a single "Season opener" chip on opening night', () => {
        for (const p of opening) {
            for (const side of ['home', 'away'] as const) {
                if (p[side].gp !== 0) continue;
                expect(texts(getTeamPills(p, side))).toEqual(['Season opener']);
            }
        }
    });

    it('never shows last season as current on opening night', () => {
        const all = opening.flatMap(p => [...getTeamPills(p, 'home'), ...getTeamPills(p, 'away'), ...getGamePills(p)].map(pillText)).join(' | ');
        for (const bad of ['#16', '0-0-0 (L7)', '(L7)', 'GAS', 'PO ', 'H2H']) expect(all).not.toContain(bad);
    });

    it('labels recent form with its real window (L3 at 3 GP) and flags the small sample', () => {
        const p = byTeams(week3, 'TBL', 'LAK');
        expect(p.away.gp).toBe(3);
        const form = getTeamPills(p, 'away').find(x => x.key === 'form')!;
        expect(pillText(form)).toBe('L3 1-2-0');
        expect(form.state).toBe('small');
        expect(pillText(form)).not.toContain('L7');
    });

    it('shows L7 only once a team has 7+ games', () => {
        for (const p of week3) {
            for (const side of ['home', 'away'] as const) {
                const form = getTeamPills(p, side).find(x => x.key === 'form');
                if (form && form.label === 'L7') expect(p[side].gp).toBeGreaterThanOrEqual(7);
            }
        }
    });

    it('shows no current PP/PK rank while ranks are gated, only extreme prior ranks tagged 25-26', () => {
        for (const p of [...opening, ...week3]) {
            for (const side of ['home', 'away'] as const) {
                const pills = getTeamPills(p, side).filter(x => x.label === 'PP' || x.label === 'PK');
                for (const pill of pills) {
                    expect(pill.state).toBe('prior');
                    expect(pill.seasonTag).toBe('25-26');
                    const r = Number(pill.value!.slice(1));
                    expect(r <= 5 || r >= 28).toBe(true);
                }
            }
        }
    });

    it('shows a current rank with its tooltip when ranks are published', () => {
        const p = { ...week3[0], home: { ...week3[0].home, ppRank: 3, ppPct: 0.271, gp: 14 } };
        const pill = getTeamPills(p, 'home').find(x => x.key === 'pp')!;
        expect(pillText(pill)).toBe('PP #3');
        expect(pill.title).toContain('#3 PP · 27.1% · 14 GP');
    });

    it('takes the location chip from side_loc_record only', () => {
        const p = byTeams(week3, 'EDM', 'VAN');
        // VAN 3-2-0 at home is middling (no chip); EDM 5-0-0 on the road is.
        expect(getTeamPills(p, 'home').some(x => x.key === 'loc')).toBe(false);
        expect(pillText(getTeamPills(p, 'away').find(x => x.key === 'loc')!)).toBe('Road 5-0-0');
    });

    it('uses rest columns for fatigue (no GAS)', () => {
        const p = { ...week3[0], away: { ...week3[0].away, isB2b: true } };
        expect(texts(getTeamPills(p, 'away'))).toContain('Back-to-back');
    });

    it('labels head-to-head "this season" from the second meeting, prior season before that', () => {
        const met1 = byTeams(week3, 'NYI', 'TOR');
        expect(met1.h2hGp).toBe(1);
        expect(pillText(getGamePills(met1)[0])).toBe('H2H this season NYI 1-0-0');
        const never = byTeams(week3, 'TBL', 'LAK');
        expect(getGamePills(never)).toEqual([]);
        expect(priorSeriesNote(never)).toBe('25-26 season series: TBL 1-1-0 vs LAK');
    });
});

describe('playoff goalie line', () => {
    it('is parsed only for game_type 03', () => {
        const [po] = fixture('playoffs');
        expect(po.gameType).toBe('03');
        expect(po.away.goaliePo).toBe('61-50 | .907 | 2.71');
        for (const p of [...fixture('opening_night'), ...fixture('week3')]) {
            expect(p.home.goaliePo).toBeNull();
            expect(p.away.goaliePo).toBeNull();
        }
    });
});
