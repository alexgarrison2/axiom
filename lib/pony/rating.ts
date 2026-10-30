import PONY_JSON from '@/public/data/pony_score.json';

/*
 * Pony Rating: one game's Pony Score read on a 0-10 scale against the player's
 * own position (forwards, defencemen and goalies apart). The anchors are last
 * season's percentiles (pipeline/tools/pony_score_calibrate.py `rating`):
 * median 5.0, 90th 7.5, 99th 9.0, top 0.1% 10.0, linear between them and
 * clamped to 0-10. A single game only: season totals and averages stay in goals.
 */

type Anchors = { pct: number[]; value: number[]; F: number[]; D: number[]; G: number[] };
const A = (PONY_JSON as unknown as { rating: Anchors }).rating;

export type RatingPos = 'F' | 'D' | 'G';

/** Any position code (C, L, R, LW, D, G, F) to its rating pool. */
export const ratingPos = (pos: string | null | undefined): RatingPos => (pos === 'D' ? 'D' : pos === 'G' ? 'G' : 'F');

/** The rating, rounded to one decimal so the tier always matches the figure shown. */
export function ponyRating(score: number, pos: string | null | undefined): number {
    const xs = A[ratingPos(pos)];
    const vs = A.value;
    let r: number;
    if (score <= xs[0]) r = vs[0];
    else if (score >= xs[xs.length - 1]) r = vs[vs.length - 1];
    else {
        let i = 1;
        while (score > xs[i]) i++;
        r = vs[i - 1] + ((score - xs[i - 1]) / (xs[i] - xs[i - 1])) * (vs[i] - vs[i - 1]);
    }
    return Math.round(Math.min(10, Math.max(0, r)) * 10) / 10;
}

export type Tier = { label: string; className: string };

/** Six bands on the rating: Incredible is the top 1%, Horrible the bottom 5%. */
const TIERS: [number, Tier][] = [
    [9, { label: 'Incredible', className: 'text-pos' }],
    [7.5, { label: 'Great', className: 'text-pos/80' }],
    [6, { label: 'Good', className: 'text-fg-1' }],
    [4, { label: 'Average', className: 'text-fg-2' }],
    [2.5, { label: 'Below avg', className: 'text-neg/80' }],
    [-Infinity, { label: 'Horrible', className: 'text-neg' }],
];

export const ponyTier = (rating: number): Tier => TIERS.find(([c]) => rating >= c)![1];

/** "8.6" */
export const fmtRating = (r: number) => r.toFixed(1);
