import { describe, expect, it } from 'vitest';
import { NAV_ITEMS, isItemActive, playoffsLink, shortSeason } from './nav-items';

describe('nav items', () => {
    it('is one fixed set that ends with the methodology link', () => {
        expect(NAV_ITEMS.map(i => i.href)).toEqual(['/', '/teams', '/players', '/props', '/standings', '/accuracy', '/news', '/methodology']);
        expect(NAV_ITEMS.some(i => 'playoffsOnly' in i)).toBe(false);
    });

    it('marks methodology current on /methodology and standings on the playoff archive', () => {
        const active = (path: string) => NAV_ITEMS.filter(i => isItemActive(i, path)).map(i => i.key);
        expect(active('/methodology')).toEqual(['methodology']);
        expect(active('/playoffs/20252026')).toEqual(['standings']);
        expect(active('/teams/TOR')).toEqual(['teams']);
        expect(active('/')).toEqual(['tonight']);
    });

    it('builds the playoff archive link from a season id', () => {
        expect(shortSeason('20252026')).toBe('25-26');
        expect(playoffsLink('20252026')).toMatchObject({ href: '/playoffs/20252026', label: 'Playoffs 25-26' });
        expect(playoffsLink('')).toBeNull();
        expect(playoffsLink('2025')).toBeNull();
    });
});
