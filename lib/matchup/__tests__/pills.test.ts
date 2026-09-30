import { describe, expect, it } from 'vitest';
import { getGamePills, getPriorPills, getTeamPills, isOpener, pillText, priorSeriesNote } from '../pills';
import { byTeams, fixture } from './fixtures';

const texts = (pills: ReturnType<typeof getTeamPills>) => pills.map(pillText);

describe('getTeamPills (E2)', () => {
    const opening = fixture('opening_night');
    const week3 = fixture('week3');

    it('gives a lone opener one "Season opener" chip, and the game one shared chip when both teams open', () => {
        for (const p of opening) {
            const both = isOpener(p.home) && isOpener(p.away);
            for (const side of ['home', 'away'] as const) {
                if (!isOpener(p[side])) continue;
                expect(texts(getTeamPills(p, side))).toEqual(both ? [] : ['Season opener']);
            }
            expect(getGamePills(p).map(pillText).includes('Season opener · both teams')).toBe(both);
        }
    });

    it('shows Back-to-back, not "Season opener", for a 0-GP team on the second night of a back-to-back', () => {
        const [base] = opening;
        const p = {
            ...base,
            away: { ...base.away, gp: 0, isB2b: true, restDays: 0, gamesInLast4: 2 },
            home: { ...base.home, gp: 0, isB2b: false, restDays: 4, gamesInLast4: 1 },
        };
        const away = texts(getTeamPills(p, 'away'));
        expect(away).toContain('Back-to-back');
        expect(away).not.toContain('Season opener');
        expect(texts(getTeamPills(p, 'home'))).toEqual(['Season opener']);
        expect(getGamePills(p).map(pillText)).not.toContain('Season opener · both teams');
    });

    it('drops the opener chip entirely when the whole slate is openers', () => {
        for (const p of opening) {
            const q = { ...p, slateAllOpeners: true };
            const all = [...getTeamPills(q, 'home'), ...getTeamPills(q, 'away'), ...getGamePills(q)].map(pillText).join(' | ');
            expect(all).not.toContain('Season opener');
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

    it('keeps last season\'s special-teams ranks off the card; getPriorPills has only extreme ones tagged 25-26', () => {
        for (const p of [...opening, ...week3]) {
            for (const side of ['home', 'away'] as const) {
                expect(getTeamPills(p, side).some(x => x.state === 'prior')).toBe(false);
                for (const pill of getPriorPills(p, side)) {
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
