// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MatchupCard } from '../../../components/matchup/MatchupCard';
import { GoaliesPanel } from '../../../components/matchup/GoaliesPanel';
import { ArchiveCard } from '../../../components/matchup/ArchiveCard';
import type { LiveGame } from '../lifecycle';
import type { Prediction } from '../../../types/prediction';
import { byTeams, fixture, withOverrides } from './fixtures';
import { compactForClient } from '../parse';
import { WhyThisPick } from '../../../components/matchup/WhyThisPick';
import { goalieSeasonLine, gsaxTag, gsaxWindow, parseGoalieLine, railHeading, railLabel } from '../format';
import { modelLean } from '../edge';
import { teamChip } from '../pills';
import type { GameDetails } from '../../client-data';

vi.mock('next/dynamic', () => ({ default: () => () => null }));

afterEach(cleanup);

function card(p: Prediction, live: LiveGame | null = null) {
    const { container } = render(
        <MatchupCard p={p} live={live} implication={null} playoffOdds={{}} />,
    );
    return container;
}

const text = (el: HTMLElement) => el.textContent ?? '';

/** Visible text only (drops .sr-only copies), with spaces between elements. */
function visible(el: HTMLElement): string {
    const c = el.cloneNode(true) as HTMLElement;
    c.querySelectorAll('.sr-only').forEach(n => n.remove());
    return (c.innerHTML.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim());
}

const final = (p: Prediction, away: number, home: number, last: string | null = null): LiveGame => ({
    id: p.id,
    state: 'OFF',
    period: last === 'OT' ? 4 : 3,
    periodType: last ?? 'REG',
    clock: '00:00',
    intermission: false,
    lastPeriodType: last,
    away: { score: away, sog: 20 },
    home: { score: home, sog: 15 },
});

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

    it("tags every goalie season line from last season 25-26 (0 GP this season)", () => {
        for (const p of opening) {
            const el = card(p);
            for (const side of ['away', 'home'] as const) {
                const s = p[side];
                if (!s.goalie) continue;
                const prev = parseGoalieLine(s.goaliePrev);
                expect(s.goalieCurGp ?? 0).toBe(0);
                if (!prev) continue;
                const line = [...el.querySelectorAll<HTMLElement>('[class*="gstat"] > span')].find(n => text(n).includes(prev.record));
                expect(line, `${s.team.triCode} ${prev.record}`).toBeTruthy();
                expect(visible(line!)).toContain('25-26');
                expect(text(line!)).toContain('25-26 season');
            }
            cleanup();
        }
    });

    it("shows this season's goalie line, untagged, once he has played", () => {
        const p = withOverrides(byTeams(opening, 'PIT', 'PHI'), {}, { away: { goalieCur: '(1-0-0) | .950 | 1.00', goalieCurGp: 1 } });
        const line = goalieSeasonLine(p.away)!;
        expect(line).toEqual({ tag: null, record: '1-0-0', sv: '.950', gaa: '1.00' });
        const t = text(card(p));
        expect(t).toContain('This season: 1-0-0');
        expect(goalieSeasonLine({ goalieCur: '(1-0-0) | .950 | 1.00', goalieCurGp: 0, goaliePrev: '(19-12-8) | .888 | 3.07' })?.tag).toBe('25-26');
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

    it('draws the market tick and model diamond, shows book odds, and no units while the gate is closed', () => {
        const p = byTeams(opening, 'PIT', 'PHI');
        const el = card(p);
        const bar = el.querySelector('[role="img"]')!;
        expect(bar.getAttribute('aria-label')).toMatch(/Market: PIT \d+%\. Model: PIT \d+%\./);
        expect(text(el)).toContain('−');
        expect(text(el)).not.toMatch(/\d(\.\d)?u\b/);
        expect(text(el)).not.toContain('Edge');
    });

    it('has no sentence-length copy on a collapsed card', () => {
        for (const p of [...opening, ...fixture('week3'), ...fixture('playoffs')]) {
            const v = visible(card(p));
            expect(v, p.legacyId).not.toMatch(/[A-Za-z]{3,}(\s+[A-Za-z]{2,}){4,}/);
            expect(v).not.toMatch(/Our forecast|Model only|Early season|leans on|No market line/);
            cleanup();
        }
    });

    it('renders the compacted page payload exactly like the full row', () => {
        for (const p of [...opening, ...fixture('week3'), ...fixture('playoffs')]) {
            const full = text(card(p));
            cleanup();
            expect(text(card(compactForClient(p)))).toBe(full);
            cleanup();
        }
    });

    it('keeps the Opener tag off the collapsed card (it lives in the Why panel)', () => {
        for (const p of opening) {
            expect(teamChip(p, 'away')?.label ?? '').not.toMatch(/Opener/);
            expect(teamChip(p, 'home')?.label ?? '').not.toMatch(/Opener/);
            expect(visible(card(p))).not.toMatch(/\bOpener\b/);
            cleanup();
        }
    });

    it('flags a big model lean with the magenta diamond copy', () => {
        const p = byTeams(opening, 'CHI', 'VGK');
        const lean = modelLean(p)!;
        expect(lean.tri).toBe('VGK');
        expect(lean.pct).toBe(64);
        expect(visible(card(p))).toContain('◆ 64 VGK');
        cleanup();
        expect(modelLean(byTeams(opening, 'EDM', 'VAN'))).toBeNull();
        expect(visible(card(byTeams(opening, 'EDM', 'VAN')))).not.toContain('◆');
    });
});

describe('lifecycle states on the card (E1)', () => {
    const opening = fixture('opening_night');
    const flaCar = byTeams(opening, 'FLA', 'CAR');

    it('FINAL 1-0 OT: FINAL · OT, 1-0, ✕ Pick, dimmed bar, no EV or units', () => {
        const el = card(flaCar, final(flaCar, 1, 0, 'OT'));
        const t = text(el);
        expect(t).toContain('FINAL · OT');
        expect(t).toContain('1-0');
        expect(t).toContain('Model pick wrong');
        expect(visible(el)).toContain('✕ Pick');
        expect(el.querySelector('[role="img"]')?.getAttribute('data-dimmed')).toBe('true');
        expect(t).not.toContain('EV');
        expect(t).not.toMatch(/\d(\.\d)?u\b/);
        expect(t).not.toContain('Edge');
    });

    it('LIVE: green clock with a live dot, pregame bar dimmed, no edge or units', () => {
        const gated = withOverrides(flaCar, { evGated: true, betSide: 'home', units: 1.5, gameState: 'LIVE' }, { home: { ev: 0.05 } });
        const el = card(gated, {
            id: flaCar.id,
            state: 'LIVE',
            period: 2,
            periodType: 'REG',
            clock: '12:41',
            intermission: false,
            lastPeriodType: null,
            away: { score: 1, sog: 14 },
            home: { score: 1, sog: 9 },
        });
        const t = text(el);
        expect(t).toContain('P2 12:41');
        expect(t).toContain('SOG 14–9');
        expect(el.querySelector('.live-dot')).not.toBeNull();
        expect(el.querySelector('[role="img"]')?.getAttribute('aria-label')).toMatch(/^Pregame win probability: FLA \d+%, CAR \d+%/);
        expect(t).not.toContain('Edge');
        expect(t).not.toContain('1.5u');
    });

    it('no_pregame_prediction: says No pick, no win bar', () => {
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
        expect(text(el)).toContain('No pick');
        expect(el.querySelector('[role="img"][aria-label*="win probability"]')).toBeNull();
    });

    it('pregame win bar: SSR paints the final split and numbers (animation is CSS-only)', () => {
        const p = byTeams(opening, 'PIT', 'PHI');
        const el = card(p);
        const bar = el.querySelector<HTMLElement>('[role="img"][aria-label^="Our forecast win probability"]');
        expect(bar).not.toBeNull();
        const m = bar!.getAttribute('aria-label')!.match(/PIT (\d+)%, PHI (\d+)%/);
        expect(m).not.toBeNull();
        const [awayN, homeN] = [Number(m![1]), Number(m![2])];
        expect(awayN + homeN).toBe(100);
        const fill = bar!.querySelector<HTMLElement>('.wb-fill')!;
        expect(fill.style.width).toBe(`${awayN}%`);
        expect(bar!.className).toContain('wb-anim');
        const targets = [...bar!.querySelectorAll<HTMLElement>('.wb-num')].map(n => n.style.getPropertyValue('--wb-to'));
        expect(targets).toEqual([String(awayN), String(homeN)]);
        expect(bar!.textContent).toContain(`${awayN}%`);
        expect(bar!.textContent).toContain(`${homeN}%`);
        expect(bar!.outerHTML).not.toMatch(/opacity:\s*0/);
    });

    it('shows the +EV flag with units when the gate is open', () => {
        const p = byTeams(opening, 'PIT', 'PHI');
        const open = withOverrides(p, { evGated: true, betSide: 'away', units: 0.8 }, { away: { ev: 0.041 } });
        const t = text(card(open));
        expect(t).toContain('+EV 4.1% PIT');
        expect(t).toContain('0.8u');
        expect(t).not.toContain('unofficial');
    });
});

describe('archive card', () => {
    it('shows the score, FINAL and the graded pick flag', () => {
        const { container } = render(
            <ArchiveCard
                g={{
                    id: '1',
                    date: '2026-09-29',
                    startTimeUtc: '2026-09-29T23:00:00Z',
                    state: 'OFF',
                    lastPeriodType: 'OT',
                    away: { tri: 'VAN', name: 'Canucks', score: 6 },
                    home: { tri: 'EDM', name: 'Oilers', score: 5 },
                    pick: { tri: 'EDM', pct: 73, correct: false },
                }}
            />,
        );
        const v = visible(container);
        expect(v).toContain('FINAL · OT');
        expect(v).toMatch(/6 - 5/);
        expect(v).toContain('✕ Pick EDM');
        expect(container.querySelector('[role="img"]')?.getAttribute('aria-label')).toMatch(/EDM 73%/);
        expect(text(container)).toContain('Model pick wrong');
    });
});

describe('Goalies tab', () => {
    const goalies = (p: Prediction) => text(render(<GoaliesPanel p={p} state={{ status: 'ready', data: null }} />).container);

    it('shows the career playoff line for a playoff game only', () => {
        const [po] = fixture('playoffs');
        expect(goalies(po)).toMatch(/Career PO\s*61-50 \.907 2\.71/);
        cleanup();
        for (const p of [...fixture('week3'), ...fixture('opening_night')]) {
            expect(goalies(p)).not.toContain('Career PO');
            cleanup();
        }
    });

    it("shows this season's line first and last season's tagged, or 0 GP", () => {
        const [po] = fixture('playoffs');
        const t = goalies(po);
        expect(t).toMatch(/26-27\s*1-0-0/);
        expect(t).toMatch(/25-26\s*31-18-4/);
        cleanup();
        const nyiTor = fixture('opening_night').find(p => p.away.team.triCode === 'NYI')!;
        expect(goalies(nyiTor)).toMatch(/26-27\s*0 GP/);
    });
});

describe('review fixes', () => {
    it("calls a forecast that rounds to 50-50 a coin flip, not a favourite", () => {
        const p = withOverrides(byTeams(fixture('opening_night'), 'PIT', 'PHI'), {
            breakdown: [
                { factor: 'home_ice', label: 'Home ice', wp_delta_pts: 0.6 },
                { factor: 'rest', label: 'Rest', wp_delta_pts: -0.2 },
            ],
        });
        const t = text(render(<WhyThisPick p={p} />).container);
        expect(t).toContain('Why: coin flip');
        expect(t).toContain('50-50');
        cleanup();
        const clear = withOverrides(p, { breakdown: [{ factor: 'home_ice', label: 'Home ice', wp_delta_pts: 6 }] });
        expect(text(render(<WhyThisPick p={clear} />).container)).toContain('Why: PHI 56%');
    });

    it('shows the lineup / starting-goalie factor as its own bar: label and number only', () => {
        const p = withOverrides(byTeams(fixture('opening_night'), 'PIT', 'PHI'), {
            breakdown: [
                { factor: 'home_ice', wp_delta_pts: 2 },
                { factor: 'goaltending', wp_delta_pts: -1 },
                { factor: 'lineup_goalie', wp_delta_pts: -2.4 },
            ],
        });
        const { container } = render(<WhyThisPick p={p} />);
        const rows = [...container.querySelectorAll('li')].map(li => text(li));
        const row = rows.find(r => r.includes('Who plays'));
        expect(row).toBeDefined();
        expect(row).toContain('+2.4');
        expect(row).toContain('PIT');
        // compactForClient drops the label of a factor the UI names itself
        expect(compactForClient(p).breakdown.find(f => f.factor === 'lineup_goalie')).toEqual({ factor: 'lineup_goalie', wp_delta_pts: -2.4 });
        expect(container.querySelectorAll('[class*="whyFill"]').length).toBe(4);
    });

    it('draws why-bars from the centre toward the team each factor helps', () => {
        const p = withOverrides(byTeams(fixture('opening_night'), 'PIT', 'PHI'), {
            breakdown: [
                { factor: 'goaltending', wp_delta_pts: -3 },
                { factor: 'home_ice', wp_delta_pts: 2 },
            ],
        });
        const { container } = render(<WhyThisPick p={p} />);
        const fills = [...container.querySelectorAll<HTMLElement>('[class*="whyFill"]')];
        expect(fills[0].style.right).toBe('50%');
        expect(fills[1].style.left).toBe('50%');
        expect(parseFloat(fills[0].style.width)).toBeGreaterThan(parseFloat(fills[1].style.width));
    });

    it("labels the starter's GSAx as a regressed rating with its season window, plus the raw current GSAx and IR tag", () => {
        const p = withOverrides(byTeams(fixture('opening_night'), 'PIT', 'PHI'), {}, { home: { gsax: -0.08, goalieCurGp: 1 } });
        const goalie = {
            name: p.home.goalie ?? 'X',
            starter: true,
            cur: null,
            prev: null,
            gsaxPerGame: -0.08,
            gsaxSeason: gsaxWindow(['2024-25', '2025-26'], true),
            gsaxCur: 1.82,
            gsaxCurGp: 1,
            injury: null,
        };
        const backup = { name: 'Frederik Andersen', starter: false, cur: null, prev: null, gsaxPerGame: 0, gsaxSeason: gsaxWindow(['2024-25', '2025-26'], false), injury: { status: 'IR', returnLabel: 'Dec 30' } };
        const side = { goalies: [goalie, backup] } as unknown as GameDetails['home'];
        const data = { home: side, away: { goalies: [] } } as unknown as GameDetails;
        const t = text(render(<GoaliesPanel p={p} state={{ status: 'ready', data }} />).container);
        // 1 GP this season: neutral colour and the rating window's tag.
        expect(t).toMatch(/−0\.08\s*GSAx\/gm\s*24-27 rating/);
        expect(t).toMatch(/GSAx\/GS 26-27\s*\+1\.82 · 1 GS/);
        expect(t).toMatch(/IR · ~Dec 30/);
        expect(gsaxWindow(['2024-25'], false)).toBe('2024-25');
        expect(gsaxTag(3)).toBe('26-27 · 3 GP');
    });
});

describe('slate rail labels', () => {
    it('names days relative to today', () => {
        expect(railLabel('2026-09-30', '2026-09-30')).toBe('Tonight');
        expect(railLabel('2026-09-29', '2026-09-30')).toBe('Yesterday');
        expect(railLabel('2026-10-01', '2026-09-30')).toBe('Thu');
        expect(railLabel('2026-10-09', '2026-09-30')).toBe('Oct 9');
        expect(railHeading('2026-09-30', '2026-09-30')).toBe('Wed · Sep 30');
        expect(railHeading('2025-04-02', '2026-09-30')).toBe('Wed · Apr 2 2025');
    });
});
