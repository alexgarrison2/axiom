import { describe, expect, it } from 'vitest';
import { cardAnchor, defaultDate, finalLabel, liveClock, modelCorrect, phaseOf, pollInterval, slateDone, sortSlate, type LiveGame } from '../lifecycle';
import { dayLabel, fmtTime, easternDate, slateDate } from '../format';
import { byTeams, fixture } from './fixtures';

const opening = fixture('opening_night');
const g = (id: string, o: Partial<LiveGame>): LiveGame => ({
    id,
    state: 'FUT',
    period: null,
    periodType: null,
    clock: null,
    intermission: false,
    lastPeriodType: null,
    away: { score: null, sog: null },
    home: { score: null, sog: null },
    ...o,
});

describe('game lifecycle (E1)', () => {
    const flaCar = byTeams(opening, 'FLA', 'CAR');

    it('grades the FLA@CAR final 1-0 OT as a model miss', () => {
        const live = g(flaCar.id, { state: 'OFF', period: 4, periodType: 'OT', lastPeriodType: 'OT', away: { score: 1, sog: 20 }, home: { score: 0, sog: 15 } });
        expect(phaseOf(flaCar, live)).toBe('final');
        expect(finalLabel(live)).toBe('FINAL/OT');
        expect(flaCar.home.winPct).toBeGreaterThan(50); // model liked CAR
        expect(modelCorrect(flaCar, live)).toBe(false);
    });

    it('formats the live clock', () => {
        expect(liveClock(g('1', { state: 'LIVE', period: 2, periodType: 'REG', clock: '12:41' }))).toBe('P2 12:41');
        expect(liveClock(g('1', { state: 'LIVE', period: 4, periodType: 'OT', clock: '03:12' }))).toBe('OT 3:12');
        expect(liveClock(g('1', { state: 'LIVE', period: 2, periodType: 'REG', clock: '18:00', intermission: true }))).toBe('2nd INT');
    });

    it('has no grade for a game without a pregame prediction', () => {
        const mtlTor = byTeams(opening, 'MTL', 'TOR');
        expect(mtlTor.status).toBe('no_pregame_prediction');
        expect(modelCorrect(mtlTor, g(mtlTor.id, { state: 'FINAL', away: { score: 3, sog: 1 }, home: { score: 2, sog: 1 } }))).toBeNull();
    });

    it('sorts LIVE, then upcoming by puck drop, then FINAL', () => {
        const live = { [byTeams(opening, 'MTL', 'TOR').id]: g('x', { state: 'LIVE', period: 2 }) };
        const day = opening.filter(p => p.date === '2026-09-29');
        const order = sortSlate(day, live).map(cardAnchor);
        expect(order[0]).toBe('mtl-tor');
        expect(order[order.length - 1]).toBe('fla-car');
        expect(order.slice(1, -1)).toEqual(['chi-vgk', 'edm-van']);
    });

    it('renders 21:00Z as 5:00 PM EDT in America/New_York', () => {
        expect(fmtTime('2026-09-29T21:00:00Z', 'America/New_York')).toBe('5:00 PM EDT');
        expect(easternDate(new Date('2026-09-30T03:30:00Z'))).toBe('2026-09-29');
    });

    it('keeps last night as the slate day until 3:00 am ET (wall clock, across DST)', () => {
        // EDT (UTC-4): 23:59, 00:30 and 02:59 ET belong to Oct 3's slate; 03:00 ET starts Oct 4.
        expect(slateDate(new Date('2026-10-04T03:59:00Z'))).toBe('2026-10-03');
        expect(slateDate(new Date('2026-10-04T04:30:00Z'))).toBe('2026-10-03');
        expect(slateDate(new Date('2026-10-04T06:59:00Z'))).toBe('2026-10-03');
        expect(slateDate(new Date('2026-10-04T07:00:00Z'))).toBe('2026-10-04');
        expect(slateDate(new Date('2026-10-04T16:00:00Z'))).toBe('2026-10-04');
        // EST (UTC-5): 02:30 ET is 07:30Z; 03:00 ET is 08:00Z.
        expect(slateDate(new Date('2026-12-02T07:30:00Z'))).toBe('2026-12-01');
        expect(slateDate(new Date('2026-12-02T08:00:00Z'))).toBe('2026-12-02');
        // Fall-back night (Nov 1, 2026): 02:30 EST is still Oct 31's slate.
        expect(slateDate(new Date('2026-11-01T07:30:00Z'))).toBe('2026-10-31');
        expect(slateDate(new Date('2026-11-01T08:00:00Z'))).toBe('2026-11-01');
        // The default slate follows it: at 00:30 ET last night's games are still the default.
        expect(defaultDate(['2026-10-03', '2026-10-04'], slateDate(new Date('2026-10-04T04:30:00Z')))).toBe('2026-10-03');
        expect(defaultDate(['2026-10-03', '2026-10-04'], slateDate(new Date('2026-10-04T07:00:00Z')))).toBe('2026-10-04');
    });

    it('labels date tabs Today / Tomorrow', () => {
        expect(dayLabel('2026-09-30', '2026-09-30')).toBe('Today');
        expect(dayLabel('2026-10-01', '2026-09-30')).toBe('Tomorrow');
        expect(dayLabel('2026-10-02', '2026-09-30')).toBe('Fri, Oct 2');
    });

    it('defaults to today, else the next game day', () => {
        expect(defaultDate(['2026-09-30', '2026-10-01'], '2026-09-30')).toBe('2026-09-30');
        expect(defaultDate(['2026-10-01', '2026-10-03'], '2026-10-02')).toBe('2026-10-03');
        expect(defaultDate([], '2026-10-02')).toBeNull();
    });
});

describe('score polling cadence', () => {
    const day = opening.filter(p => p.date === '2026-09-29');
    const start = Date.parse('2026-09-29T21:00:00Z');

    it('does not poll a slate that has not started', () => {
        const tomorrow = opening.filter(p => p.date === '2026-09-30').map(p => ({ ...p, gameState: 'FUT' as const }));
        expect(pollInterval(tomorrow, {}, start)).toBeNull();
    });

    it('polls every 30s while a game is live', () => {
        expect(pollInterval(day, {}, start + 3600_000)).toBe(30_000);
    });

    it('stops once every game is final with a score', () => {
        const live = Object.fromEntries(day.map(p => [p.id, g(p.id, { state: 'OFF', away: { score: 1, sog: 1 }, home: { score: 2, sog: 1 } })]));
        expect(slateDone(day, live)).toBe(true);
        expect(pollInterval(day, live, start + 12 * 3600_000)).toBeNull();
    });
});
