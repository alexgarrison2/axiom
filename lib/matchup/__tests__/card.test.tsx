// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatchupCard } from '../../../components/matchup/MatchupCard';
import { GoaliesPanel } from '../../../components/matchup/GoaliesPanel';
import type { LiveGame } from '../lifecycle';
import type { Prediction } from '../../../types/prediction';
import { byTeams, fixture, withOverrides } from './fixtures';
import { compactForClient } from '../parse';
import { WhyThisPick } from '../../../components/matchup/WhyThisPick';
import { gsaxTag } from '../format';
import type { GameDetails } from '../../client-data';

vi.mock('next/dynamic', () => ({ default: () => () => null }));

afterEach(cleanup);

function card(p: Prediction, live: LiveGame | null = null) {
    const { container } = render(
        <MatchupCard p={p} live={live} implication={null} playoffOdds={{}} favorites={[]} onFavorite={() => {}} />,
    );
    return container;
}

const text = (el: HTMLElement) => el.textContent ?? '';

describe('matchup card on the opening-night fixture (E2/E3)', () => {
    const opening = fixture('opening_night');

    it("never shows last season's context as current", () => {
        for (const p of opening) {
            const t = text(card(p));
            for (const bad of ['#16', '0-0-0 (L7)', 'GAS', 'PO ']) expect(t, `${p.away.team.triCode}@${p.home.team.triCode}`).not.toContain(bad);
            // Any date before this season must carry a 25-26 tag.
            for (const m of t.matchAll(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug) \d{1,2}\b/g)) {
                expect(t.slice(Math.max(0, (m.index ?? 0) - 8), m.index), m[0]).toContain('25-26');
            }
            cleanup();
        }
    });

    it('puts both tricodes in the collapsed card and an expand toggle in the h2', () => {
        const p = byTeams(opening, 'EDM', 'VAN');
        const el = card(p);
        expect(text(el)).toContain('EDM');
        expect(text(el)).toContain('VAN');
        const btn = el.querySelector('h2 button[aria-expanded]')!;
        expect(btn.getAttribute('aria-expanded')).toBe('false');
        expect(document.getElementById(btn.getAttribute('aria-controls')!)?.hidden).toBe(true);
        expect(el.querySelector('article')?.getAttribute('aria-labelledby')).toBeTruthy();
    });

    it('shows Model % and Market % on a card with odds, and no units while the gate is closed', () => {
        const t = text(card(byTeams(opening, 'PIT', 'PHI')));
        expect(t).toContain('Model');
        expect(t).toContain('Market');
        expect(t).not.toMatch(/\d(\.\d)?u\b/);
        expect(t).not.toContain('Edge');
    });

    it('renders the compacted page payload exactly like the full row', () => {
        for (const p of [...opening, ...fixture('week3'), ...fixture('playoffs')]) {
            const full = text(card(p));
            cleanup();
            expect(text(card(compactForClient(p)))).toBe(full);
            cleanup();
        }
    });

    it('shows "Season opener" for 0-GP teams', () => {
        expect(text(card(byTeams(opening, 'CHI', 'VGK')))).toContain('Season opener');
    });
});

describe('lifecycle states on the card (E1)', () => {
    const opening = fixture('opening_night');
    const flaCar = byTeams(opening, 'FLA', 'CAR');

    it('FINAL 1-0 OT: FINAL/OT, 1-0, Model ✗, no EV or units', () => {
        const t = text(
            card(flaCar, {
                id: flaCar.id,
                state: 'OFF',
                period: 4,
                periodType: 'OT',
                clock: '00:05',
                intermission: false,
                lastPeriodType: 'OT',
                away: { score: 1, sog: 20 },
                home: { score: 0, sog: 15 },
            }),
        );
        expect(t).toContain('FINAL/OT');
        expect(t).toContain('1-0');
        expect(t).toContain('Model ✗');
        expect(t).not.toContain('EV');
        expect(t).not.toMatch(/\d(\.\d)?u\b/);
        expect(t).not.toContain('Edge');
    });

    it('LIVE: period and clock, pregame % dimmed, no edge or units', () => {
        const gated = withOverrides(flaCar, { evGated: true, betSide: 'home', units: 1.5, gameState: 'LIVE' }, { home: { ev: 0.05 } });
        const t = text(
            card(gated, {
                id: flaCar.id,
                state: 'LIVE',
                period: 2,
                periodType: 'REG',
                clock: '12:41',
                intermission: false,
                lastPeriodType: null,
                away: { score: 1, sog: 14 },
                home: { score: 1, sog: 9 },
            }),
        );
        expect(t).toContain('P2 12:41');
        expect(t).toContain('SOG 14–9');
        expect(t).toMatch(/Pregame FLA \d+% · CAR \d+%/);
        expect(t).not.toContain('Edge');
        expect(t).not.toContain('1.5u');
    });

    it('no_pregame_prediction: says so, no win bar', () => {
        const mtlTor = byTeams(opening, 'MTL', 'TOR');
        const el = card(mtlTor, {
            id: mtlTor.id,
            state: 'LIVE',
            period: 2,
            periodType: 'REG',
            clock: '05:00',
            intermission: false,
            lastPeriodType: null,
            away: { score: 2, sog: 10 },
            home: { score: 1, sog: 8 },
        });
        expect(text(el)).toContain('No pregame prediction');
        expect(el.querySelector('[role="img"][aria-label^="Model win probability"]')).toBeNull();
    });

    it('shows the edge chip with units only when the gate is open', () => {
        const p = byTeams(opening, 'PIT', 'PHI');
        const open = withOverrides(p, { evGated: true, betSide: 'away', units: 0.8 }, { away: { ev: 0.041 } });
        const t = text(card(open));
        expect(t).toContain('Edge +4.1% PIT');
        expect(t).toContain('0.8u');
    });
});

describe('playoff goalie line (Goalies tab)', () => {
    const goalies = (p: Prediction) => text(render(<GoaliesPanel p={p} state={{ status: 'ready', data: null }} />).container);

    it('appears for a playoff game', () => {
        const [po] = fixture('playoffs');
        expect(goalies(po)).toContain('Career playoffs 61-50 · .907 · 2.71');
    });

    it('never appears for a regular-season game', () => {
        for (const p of [...fixture('week3'), ...fixture('opening_night')]) {
            expect(goalies(p)).not.toContain('Career playoffs');
            cleanup();
        }
    });

    it("shows this season's line first and last season's muted, or Season debut", () => {
        const [po] = fixture('playoffs');
        const t = goalies(po);
        expect(t).toContain('26-27 1-0-0');
        expect(t).toContain('25-26 31-18-4');
        const nyiTor = fixture('opening_night').find(p => p.away.team.triCode === 'NYI')!;
        expect(goalies(nyiTor)).toContain('Season debut');
    });
});

describe('review fixes', () => {
    it("calls a forecast that rounds to 50-50 a coin flip, not 'favored'", () => {
        const p = withOverrides(byTeams(fixture('opening_night'), 'PIT', 'PHI'), {
            breakdown: [
                { factor: 'home_ice', label: 'Home ice', wp_delta_pts: 0.6 },
                { factor: 'rest', label: 'Rest', wp_delta_pts: -0.2 },
            ],
        });
        const t = text(render(<WhyThisPick p={p} />).container);
        expect(t).toContain("Why it's a coin flip");
        expect(t).not.toContain('favored');
        cleanup();
        const clear = withOverrides(p, { breakdown: [{ factor: 'home_ice', label: 'Home ice', wp_delta_pts: 6 }] });
        expect(text(render(<WhyThisPick p={clear} />).container)).toContain(`Why the ${p.home.team.commonName} are favored`);
    });

    it("tags the starter's GSAx by the games the rating holds, not the goalie's line", () => {
        const p = withOverrides(byTeams(fixture('opening_night'), 'PIT', 'PHI'), {}, { home: { gsax: -0.12, goalieCurGp: 1 } });
        const goalie = { name: p.home.goalie ?? 'X', starter: true, cur: null, prev: null, gsaxPerGame: -0.12, gsaxSeason: gsaxTag(0) };
        const side = { goalies: [goalie] } as unknown as GameDetails['home'];
        const data = { home: side, away: { goalies: [] } } as unknown as GameDetails;
        const t = text(render(<GoaliesPanel p={p} state={{ status: 'ready', data }} />).container);
        expect(t).toMatch(/Rating.*GSAx\/gm\s*\(regressed · 25-26\)/);
        expect(t).not.toMatch(/GSAx\/gm\s*\(regressed · 26-27/);
        expect(gsaxTag(3)).toBe('26-27 · 3 GP');
    });
});
