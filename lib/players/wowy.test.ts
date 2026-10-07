import { describe, expect, it } from 'vitest';
import { equalScale, minApart, placeLabels, rates, ticks, wowyFor, type Box, type WowyDoc } from './wowy';

const doc: WowyDoc = {
    season: '20252026',
    min_toi: 6000,
    team_gp: 82,
    season_games: 82,
    names: { '1': ['Ann', 'Alpha', 'C'], '2': ['Bo', 'Beta', 'D'], '3': ['Cy', 'Gamma', 'L'] },
    on_cols: ['player', 'team', 'toi', 'xgf', 'xga'],
    on: [
        [1, 'EDM', 72000, 60, 50],
        [2, 'EDM', 54000, 40, 35],
        [3, 'EDM', 36000, 20, 25],
        [3, 'VAN', 18000, 9, 11],
        [1, 'VAN', 1000, 1, 1],
    ],
    pair_cols: ['a', 'b', 'team', 'toi', 'xgf', 'xga'],
    pairs: [
        [1, 2, 'EDM', 36000, 32, 24],
        [1, 3, 'EDM', 7200, 5, 6],
        [2, 3, 'EDM', 9000, 6, 7],
    ],
};

describe('wowyFor', () => {
    it('derives together and both apart samples, most time together first', () => {
        const w = wowyFor(doc, 1)!;
        expect(w.teams.map(t => t.team)).toEqual(['EDM']);
        const [b, c] = w.teams[0].mates;
        expect(b.id).toBe(2);
        expect(b.last).toBe('Beta');
        expect(b.together).toEqual({ toi: 36000, xgf: 32, xga: 24 });
        expect(b.him).toEqual({ toi: 36000, xgf: 28, xga: 26 });
        expect(b.mate).toEqual({ toi: 18000, xgf: 8, xga: 11 });
        expect(c.id).toBe(3);
        // Apart is on the pair's team only: Gamma's VAN minutes do not count.
        expect(c.mate.toi).toBe(36000 - 7200);
        expect(w.teams[0].all.toi).toBe(72000);
    });
    it('the overall rate lies on the line through together and him apart', () => {
        const m = wowyFor(doc, 1)!.teams[0].mates[0];
        const all = rates(wowyFor(doc, 1)!.teams[0].all)!;
        const t = rates(m.together)!;
        const h = rates(m.him)!;
        const share = m.together.toi / (m.together.toi + m.him.toi);
        expect(all.f).toBeCloseTo(share * t.f + (1 - share) * h.f, 9);
        expect(all.a).toBeCloseTo(share * t.a + (1 - share) * h.a, 9);
    });
    it('is null for a player without a listed pair or without a file', () => {
        expect(wowyFor(doc, 99)).toBeNull();
        expect(wowyFor(null, 1)).toBeNull();
    });
});

describe('rates and thresholds', () => {
    it('per 60, null under the minimum', () => {
        expect(rates({ toi: 3600, xgf: 2.5, xga: 3 })).toEqual({ f: 2.5, a: 3 });
        expect(rates({ toi: 300, xgf: 1, xga: 1 }, 600)).toBeNull();
        expect(rates({ toi: 0, xgf: 0, xga: 0 })).toBeNull();
        expect(minApart(6000)).toBe(1500);
        expect(minApart(600)).toBe(600);
    });
});

describe('equalScale', () => {
    it('keeps units across and down within the ratio and contains every point', () => {
        const pts = [
            { f: 2, a: 2 },
            { f: 4, a: 2.5 },
            { f: 3, a: 3.2 },
        ];
        const s = equalScale(pts, 400, 300);
        expect(s.kx / s.ky).toBeLessThanOrEqual(1.6 + 1e-9);
        expect(s.ky / s.kx).toBeLessThanOrEqual(1.6 + 1e-9);
        expect(equalScale(pts, 400, 300, 0.08, 1).kx).toBeCloseTo(equalScale(pts, 400, 300, 0.08, 1).ky, 9);
        for (const p of pts) {
            expect(s.x(p.f)).toBeGreaterThanOrEqual(0);
            expect(s.x(p.f)).toBeLessThanOrEqual(400);
            expect(s.y(p.a)).toBeGreaterThanOrEqual(0);
            expect(s.y(p.a)).toBeLessThanOrEqual(300);
        }
        // Less against sits higher (smaller y).
        expect(s.y(2)).toBeLessThan(s.y(3));
    });
    it('ticks are round and far enough apart', () => {
        expect(ticks(1.9, 3.1, 100)).toEqual([2, 2.5, 3]);
        expect(ticks(1.9, 3.1, 200)).toEqual([2, 2.25, 2.5, 2.75, 3]);
    });
});

describe('placeLabels', () => {
    const bounds: Box = { x: 0, y: 0, w: 300, h: 200 };
    const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

    it('never overlaps labels, obstacles or other points, and stays in bounds', () => {
        const items = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, x: 100 + (i % 4) * 12, y: 80 + Math.floor(i / 4) * 10, w: 48, h: 15 }));
        const obstacles: Box[] = [{ x: 0, y: 0, w: 40, h: 16 }];
        const out = placeLabels(items, obstacles, bounds);
        const boxes = out.filter(o => o != null).map(o => o!.box);
        expect(boxes.length).toBeGreaterThan(4);
        for (let i = 0; i < boxes.length; i++) {
            const b = boxes[i];
            expect(b.x).toBeGreaterThanOrEqual(0);
            expect(b.y).toBeGreaterThanOrEqual(0);
            expect(b.x + b.w).toBeLessThanOrEqual(300);
            expect(b.y + b.h).toBeLessThanOrEqual(200);
            expect(overlaps(b, obstacles[0])).toBe(false);
            for (let j = i + 1; j < boxes.length; j++) expect(overlaps(b, boxes[j])).toBe(false);
        }
        out.forEach((o, i) => {
            if (!o) return;
            items.forEach((it, j) => {
                if (j !== i) expect(overlaps(o.box, { x: it.x - 4, y: it.y - 4, w: 8, h: 8 })).toBe(false);
            });
        });
    });
    it('prefers the spot right of the point and flips left at the edge', () => {
        const [a, b] = placeLabels(
            [
                { id: 1, x: 50, y: 100, w: 40, h: 15 },
                { id: 2, x: 290, y: 100, w: 40, h: 15 },
            ],
            [],
            bounds,
        );
        expect(a!.box.x).toBeGreaterThan(50);
        expect(a!.lead).toBe(false);
        expect(b!.box.x + b!.box.w).toBeLessThan(290);
    });
    it('a leader line does not run through another label', () => {
        // Two points side by side, crowded by obstacles around them: whatever is placed must not be crossed by a leader.
        const items = [
            { id: 1, x: 150, y: 100, w: 50, h: 15 },
            { id: 2, x: 160, y: 102, w: 50, h: 15 },
        ];
        const out = placeLabels(items, [{ x: 100, y: 85, w: 130, h: 30 }], bounds);
        const [a, b] = out;
        for (const [o, it, other] of [
            [a, items[0], b],
            [b, items[1], a],
        ] as const) {
            if (!o?.lead || !other) continue;
            const ex = Math.max(o.box.x, Math.min(o.box.x + o.box.w, it.x));
            const ey = Math.max(o.box.y, Math.min(o.box.y + o.box.h, it.y));
            for (let s = 1; s < 8; s++) {
                const px = it.x + ((ex - it.x) * s) / 8;
                const py = it.y + ((ey - it.y) * s) / 8;
                expect(px > other.box.x && px < other.box.x + other.box.w && py > other.box.y && py < other.box.y + other.box.h).toBe(false);
            }
        }
        expect(out.some(o => o?.lead)).toBe(true);
    });
    it('drops a label with nowhere to go', () => {
        const out = placeLabels([{ id: 1, x: 10, y: 10, w: 400, h: 15 }], [], bounds);
        expect(out[0]).toBeNull();
    });
});
