import * as React from 'react';
import { cn } from '../../lib/utils';
import { deltaE, readableTextOn } from './color';
import { clashSafePair, MIN_TEAM_DELTA_E } from './team-color';

export interface MarketBand {
    /** Lowest away-win probability the market allows (1 − home implied, with vig). 0–1. */
    lo: number;
    /** Highest away-win probability the market allows (away implied, with vig). 0–1. */
    hi: number;
    label?: string;
}

export interface WinBarProps {
    away: string;
    home: string;
    /** Model probability that the AWAY team wins (0–1). */
    pAway: number;
    /** Override colours (otherwise the clash-safe team palette is used). */
    awayColor?: string;
    homeColor?: string;
    /** Fallback colours used when the overrides clash (ΔE < 25). */
    awayColor2?: string;
    homeColor2?: string;
    marketBand?: MarketBand | null;
    /** Bar height. */
    size?: 'sm' | 'md' | 'lg';
    /** Play the 50/50 → model split fill on first paint (CSS only; off under reduced motion). */
    animate?: boolean;
    /** Name of the probability for screen readers ("Model win probability"). */
    label?: string;
    className?: string;
}

const pctN = (p: number) => Number((p * 100).toFixed(0));
const pct = (p: number) => `${pctN(p)}%`;

/** Pick bar colours: explicit overrides get the same ΔE clash check as the team palette. */
export function resolveBarColors(p: Pick<WinBarProps, 'away' | 'home' | 'awayColor' | 'homeColor' | 'awayColor2' | 'homeColor2'>) {
    if (!p.awayColor || !p.homeColor) {
        const pair = clashSafePair(p.away, p.home);
        return { away: p.awayColor ?? pair.away, home: p.homeColor ?? pair.home };
    }
    const options: [string, string][] = [[p.awayColor, p.homeColor]];
    if (p.awayColor2) options.push([p.awayColor2, p.homeColor]);
    if (p.homeColor2) options.push([p.awayColor, p.homeColor2]);
    if (p.awayColor2 && p.homeColor2) options.push([p.awayColor2, p.homeColor2]);
    const ok = options.find(([a, h]) => deltaE(a, h) >= MIN_TEAM_DELTA_E);
    const [away, home] = ok ?? options.reduce((best, o) => (deltaE(o[0], o[1]) > deltaE(best[0], best[1]) ? o : best));
    return { away, home };
}

/**
 * Per size: bar height, type, padding, the fill width (container query on the
 * label box) from which the tricode also fits next to the %, and the share of
 * the bar (0–100) below which the % moves outside, under the bar.
 */
const SIZES = {
    sm: { bar: 'h-6', code: 'hidden text-micro font-semibold [@container(min-width:3.75rem)]:inline', num: 'text-body-sm font-bold', pad: 'px-2', numMin: 12 },
    md: { bar: 'h-9', code: 'hidden text-body-sm font-semibold [@container(min-width:4.75rem)]:inline', num: 'text-title font-extrabold', pad: 'px-3', numMin: 17 },
    lg: { bar: 'h-11', code: 'hidden text-body font-semibold [@container(min-width:6.25rem)]:inline', num: 'text-h2 font-black', pad: 'px-3.5', numMin: 20 },
} as const;

/** The side's percentage: SSR paints the final number; `.wb-num` counts 50 → n on first paint. */
function Num({ n, className }: { n: number; className: string }) {
    return (
        <span className={cn('tabular-nums tracking-tight', className)}>
            <span aria-hidden="true" className="wb-num" style={{ '--wb-to': n } as React.CSSProperties} />
            {/* Plain-text copy for find-in-page and innerText; the bar itself is role=img. */}
            <span className="sr-only">{n}%</span>
        </span>
    );
}

/**
 * Win-probability bar: away on the left, home on the right, a 2px ice
 * separator at the split, bold numbers inside each fill, and an optional
 * labelled market band underneath.
 *
 * The final split is in the server HTML. On first paint the fill grows from
 * 50/50 and the numbers count up (transform + a registered CSS property, so
 * no layout shift and no hydration dependency); reduced motion shows the end
 * state immediately. See the "Win bar" block in app/globals.css.
 */
export function WinBar({ away, home, pAway, marketBand, size = 'md', animate = true, label = 'Model win probability', className, ...colors }: WinBarProps) {
    const p = Math.min(1, Math.max(0, Number.isFinite(pAway) ? pAway : 0.5));
    const { away: ac, home: hc } = resolveBarColors({ away, home, ...colors });
    const awayInk = readableTextOn(ac);
    const homeInk = readableTextOn(hc);
    const awayW = p * 100;
    const homeW = 100 - awayW;
    const awayN = pctN(p);
    const homeN = pctN(1 - p);
    const sz = SIZES[size];
    const band = marketBand && marketBand.hi > marketBand.lo ? marketBand : null;
    const bandLabel = band?.label ?? 'Market range';
    const summary =
        `${label}: ${away} ${awayN}%, ${home} ${homeN}%.` +
        (band ? ` ${bandLabel} for ${away}: ${pct(band.lo)} to ${pct(band.hi)}.` : '');
    // Start scale that makes the final-width fill look exactly 50% wide.
    const s0 = awayW >= 1 ? 50 / awayW : 1;

    return (
        <div className={cn('w-full', className)}>
            <div
                role="img"
                aria-label={summary}
                className={cn('relative isolate w-full overflow-hidden rounded-control shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]', sz.bar, animate && 'wb-anim')}
                style={{ backgroundColor: hc }}
            >
                {/* Away fill, drawn at its final width and scaled from 50% on first paint. */}
                <span
                    aria-hidden="true"
                    className="wb-fill absolute inset-y-0 left-0 origin-left"
                    style={{ width: `${awayW}%`, backgroundColor: ac, '--wb-s0': s0 } as React.CSSProperties}
                />
                {/* 2px ice separator; the layer spans the bar so translateX(%) is a bar percentage. */}
                <span aria-hidden="true" className="wb-split pointer-events-none absolute inset-0" style={{ transform: `translateX(${awayW}%)` }}>
                    <span className="absolute inset-y-0 -left-px w-0.5 bg-bg" />
                </span>
                {/* One-shot sheen after the fill settles (invisible at rest). */}
                <span
                    aria-hidden="true"
                    className="wb-sheen pointer-events-none absolute inset-y-0 left-0 w-1/5 -skew-x-12 bg-gradient-to-r from-transparent via-white/30 to-transparent opacity-0"
                />

                {awayW >= sz.numMin ? (
                    <span className={cn('absolute inset-y-0 left-0 flex items-center gap-1.5 overflow-hidden whitespace-nowrap [container-type:inline-size]', sz.pad)} style={{ width: `${awayW}%`, color: awayInk }}>
                        <span className={sz.code}>{away}</span>
                        <Num n={awayN} className={sz.num} />
                    </span>
                ) : null}
                {homeW >= sz.numMin ? (
                    <span className={cn('absolute inset-y-0 right-0 flex items-center justify-end gap-1.5 overflow-hidden whitespace-nowrap [container-type:inline-size]', sz.pad)} style={{ width: `${homeW}%`, color: homeInk }}>
                        <Num n={homeN} className={sz.num} />
                        <span className={sz.code}>{home}</span>
                    </span>
                ) : null}
            </div>

            {/* Labels for slivers too thin to hold text */}
            {awayW < sz.numMin || homeW < sz.numMin ? (
                <div aria-hidden="true" className="mt-1 flex justify-between text-caption font-semibold text-fg-2">
                    <span>{awayW < sz.numMin ? `${away} ${awayN}%` : ''}</span>
                    <span>{homeW < sz.numMin ? `${homeN}% ${home}` : ''}</span>
                </div>
            ) : null}

            {band ? (
                <div aria-hidden="true" className="mt-1.5">
                    <div className="relative h-2 w-full rounded-full bg-fg-3/15">
                        <span
                            className="absolute inset-y-0 rounded-full border border-fg-2/70 bg-fg-2/20"
                            style={{ left: `${band.lo * 100}%`, width: `${(band.hi - band.lo) * 100}%` }}
                        />
                        {/* model split tick */}
                        <span className="absolute -inset-y-0.5 w-0.5 -translate-x-1/2 rounded-full bg-brand" style={{ left: `${awayW}%` }} />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-micro text-fg-3">
                        <span className="inline-flex items-center gap-1">
                            <span className="inline-block h-2 w-3 rounded-sm border border-fg-2/70 bg-fg-2/20" />
                            {bandLabel} {pct(band.lo)}–{pct(band.hi)} {away}
                        </span>
                        <span className="inline-flex items-center gap-1">
                            <span className="inline-block h-2.5 w-0.5 rounded-full bg-brand" />
                            Model
                        </span>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

/** Market band (away-win probability range) from American moneylines, vig included. */
export function marketBandFromOdds(awayOdds?: number | string | null, homeOdds?: number | string | null): MarketBand | null {
    const a = typeof awayOdds === 'string' ? parseInt(awayOdds, 10) : awayOdds;
    const h = typeof homeOdds === 'string' ? parseInt(homeOdds, 10) : homeOdds;
    if (!a || !h || !Number.isFinite(a) || !Number.isFinite(h)) return null;
    const implied = (o: number) => (o > 0 ? 100 / (o + 100) : -o / (-o + 100));
    const awayImp = implied(a);
    const homeImp = implied(h);
    const lo = Math.max(0, 1 - homeImp);
    const hi = Math.min(1, awayImp);
    return hi > lo ? { lo, hi } : null;
}

export default WinBar;
