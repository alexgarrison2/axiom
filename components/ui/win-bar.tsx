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
    className?: string;
}

const pct = (p: number) => `${(p * 100).toFixed(0)}%`;

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

const heights = { sm: 'h-6 text-caption', md: 'h-8 text-body-sm', lg: 'h-10 text-body' };

/**
 * Model win-probability bar: away on the left, home on the right, a 2px ice
 * separator at the split, readable labels inside each fill, and an optional
 * labelled market band underneath.
 */
export function WinBar({ away, home, pAway, marketBand, size = 'md', animate = true, className, ...colors }: WinBarProps) {
    const p = Math.min(1, Math.max(0, Number.isFinite(pAway) ? pAway : 0.5));
    const { away: ac, home: hc } = resolveBarColors({ away, home, ...colors });
    const awayInk = readableTextOn(ac);
    const homeInk = readableTextOn(hc);
    const awayW = p * 100;
    const homeW = 100 - awayW;
    const band = marketBand && marketBand.hi > marketBand.lo ? marketBand : null;
    const bandLabel = band?.label ?? 'Market range';
    const summary =
        `Model win probability: ${away} ${pct(p)}, ${home} ${pct(1 - p)}.` +
        (band ? ` ${bandLabel} for ${away}: ${pct(band.lo)} to ${pct(band.hi)}.` : '');

    return (
        <div className={cn('w-full', className)}>
            <div role="img" aria-label={summary} className={cn('relative flex w-full overflow-hidden rounded-control font-semibold', heights[size])}>
                <div
                    className={cn('relative flex min-w-0 items-center justify-start pl-2.5', animate && 'motion-safe:animate-[winbar-fill_700ms_cubic-bezier(0.2,0.8,0.2,1)_both]')}
                    style={{ width: `${awayW}%`, backgroundColor: ac, color: awayInk }}
                >
                    {awayW >= 14 ? (
                        <span className="truncate">
                            <span className="font-medium">{away}</span> <span className="font-bold tabular-nums">{pct(p)}</span>
                        </span>
                    ) : null}
                </div>
                <div className="flex min-w-0 flex-1 items-center justify-end pr-2.5" style={{ backgroundColor: hc, color: homeInk }}>
                    {homeW >= 14 ? (
                        <span className="truncate">
                            <span className="font-bold tabular-nums">{pct(1 - p)}</span> <span className="font-medium">{home}</span>
                        </span>
                    ) : null}
                </div>
                {/* 2px ice separator at the split */}
                <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-bg"
                    style={{ left: `${awayW}%` }}
                />
            </div>

            {/* Labels for slivers too thin to hold text */}
            {awayW < 14 || homeW < 14 ? (
                <div aria-hidden="true" className="mt-1 flex justify-between text-caption font-semibold text-fg-2">
                    <span>{awayW < 14 ? `${away} ${pct(p)}` : ''}</span>
                    <span>{homeW < 14 ? `${pct(1 - p)} ${home}` : ''}</span>
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
