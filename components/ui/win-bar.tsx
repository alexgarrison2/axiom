import * as React from 'react';
import { cn } from '../../lib/utils';
import { deltaE, hexToRgb, readableTextOn, INK_LIGHT } from './color';
import { clashSafePair, MIN_TEAM_DELTA_E } from './team-color';

/**
 * WinBar — the fat two-team win bar.
 *
 *   <WinBar away="NYI" home="TOR" pAway={0.48} market={0.47} model={0.61} size="lg" />
 *
 * - Fill split = `pAway` (the published forecast). Team colours come from the
 *   clash-safe palette (or awayColor/homeColor overrides, ΔE-checked).
 * - Bold italic Chakra Petch % inside each fill.
 * - The favourite's segment glows; the underdog's is desaturated + darkened.
 * - Diagonal hatch texture over both fills.
 * - `market`: white MARKET tick at the vig-free market probability (away).
 * - `model`: magenta MODEL diamond under the bar at the raw model probability (away).
 * - `dimmed`: finals (bar at 55% opacity).
 * - Grows in once from both ends on first paint (transform only, CLS 0; the
 *   server HTML already holds the final split). Off under reduced motion.
 *
 * Pair with <WinBarLegend /> once per page, never per card.
 */
export interface WinBarProps {
    away: string;
    home: string;
    /** Forecast probability that the AWAY team wins (0–1). Drives the fill split. */
    pAway: number;
    /** Vig-free market probability for the AWAY team (0–1): white tick. */
    market?: number | null;
    /** Raw model probability for the AWAY team (0–1): magenta diamond under the bar. */
    model?: number | null;
    /** Override colours (otherwise the clash-safe team palette is used). */
    awayColor?: string;
    homeColor?: string;
    /** Fallback colours used when the overrides clash (ΔE < 25). */
    awayColor2?: string;
    homeColor2?: string;
    /** sm 28px (tables) · md 40px · lg 50px (matchup card). */
    size?: 'sm' | 'md' | 'lg';
    /** Grow in on first paint (CSS only; off under reduced motion). */
    animate?: boolean;
    /** Final / settled games: the bar fades back. */
    dimmed?: boolean;
    /** Show tricodes next to the % (off by default; the crests already say who is who). */
    showCodes?: boolean;
    /** Name of the fill probability for screen readers. */
    label?: string;
    className?: string;
}

const clamp01 = (p: number | null | undefined) => (p == null || !Number.isFinite(p) ? null : Math.min(1, Math.max(0, p)));
const pctN = (p: number) => Math.round(p * 100);

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

const toHex = (rgb: number[]) => `#${rgb.map(c => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`;

/**
 * The colour the % sits on: the outer (darker, 70%) end of the fill gradient,
 * run through the underdog filter (saturate .55, brightness .75) when `dog`.
 */
function labelBackdrop(hex: string, dog: boolean): string {
    let [r, g, b] = hexToRgb(hex).map(c => c * 0.7);
    if (dog) {
        const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        [r, g, b] = [r, g, b].map(c => (y + (c - y) * 0.55) * 0.75);
    }
    return toHex([r, g, b]);
}

const SIZES = {
    sm: { h: 28, num: 'text-[14px]', pad: 'px-2', numMin: 14, tick: '-top-[3px] -bottom-[3px]', code: 'text-micro' },
    md: { h: 40, num: 'text-[20px]', pad: 'px-3', numMin: 16, tick: '-top-[5px] -bottom-[5px]', code: 'text-caption' },
    lg: { h: 50, num: 'text-[26px]', pad: 'px-4', numMin: 18, tick: '-top-[6px] -bottom-[6px]', code: 'text-caption' },
} as const;

/** The side's percentage: SSR paints the final number; `.wb-num` counts 0 → n on first paint. */
function Num({ n, tri, className }: { n: number; tri: string; className: string }) {
    return (
        <span className={cn('num-pct leading-none', className)}>
            <span aria-hidden="true" className="wb-num" style={{ '--wb-to': n } as React.CSSProperties} />
            <sup aria-hidden="true" className="ml-px align-[0.6em] text-[0.5em]">
                %
            </sup>
            {/* Plain-text copy for find-in-page and innerText; the bar itself is role=img. */}
            <span className="sr-only">
                {tri} {n}%
            </span>
        </span>
    );
}

export function WinBar({
    away,
    home,
    pAway,
    market,
    model,
    size = 'lg',
    animate = true,
    dimmed = false,
    showCodes = false,
    label = 'Win probability',
    className,
    ...colors
}: WinBarProps) {
    const p = clamp01(pAway) ?? 0.5;
    const mkt = clamp01(market);
    const mdl = clamp01(model);
    const { away: ac, home: hc } = resolveBarColors({ away, home, ...colors });
    const awayW = p * 100;
    const homeW = 100 - awayW;
    const awayN = pctN(p);
    const homeN = 100 - awayN;
    const awayDog = awayN < homeN;
    const homeDog = homeN < awayN;
    const awayInk = readableTextOn(labelBackdrop(ac, awayDog));
    const homeInk = readableTextOn(labelBackdrop(hc, homeDog));
    const sz = SIZES[size];

    const summary =
        `${label}: ${away} ${awayN}%, ${home} ${homeN}%.` +
        (mkt != null ? ` Market: ${away} ${pctN(mkt)}%.` : '') +
        (mdl != null ? ` Model: ${away} ${pctN(mdl)}%.` : '');

    const fillBase = 'wb-fill absolute inset-y-0 overflow-hidden';
    const inkShadow = (ink: string) => (ink === INK_LIGHT ? '0 1px 8px rgba(0,0,0,.45)' : 'none');

    return (
        <div className={cn('w-full', mdl != null && 'pb-2.5', className)}>
            <div
                role="img"
                aria-label={summary}
                className={cn('relative isolate w-full rounded-bar bg-track', animate && 'wb-anim', dimmed && 'opacity-[.55]')}
                style={{ height: sz.h }}
            >
                {/* Away fill: grows out from the left edge. */}
                <span
                    aria-hidden="true"
                    className={cn(fillBase, 'left-0 origin-left rounded-l-bar', homeW < 0.5 && 'rounded-r-bar')}
                    style={{
                        width: `${awayW}%`,
                        backgroundColor: ac,
                        backgroundImage: `linear-gradient(90deg, color-mix(in srgb, ${ac} 70%, #000), ${ac})`,
                        boxShadow: awayDog ? undefined : `0 0 26px -4px ${ac}`,
                        filter: awayDog ? 'saturate(.55) brightness(.75)' : undefined,
                    }}
                >
                    <span className="wb-hatch absolute inset-0" />
                </span>
                {/* Home fill: grows out from the right edge. */}
                <span
                    aria-hidden="true"
                    className={cn(fillBase, 'right-0 origin-right rounded-r-bar', awayW < 0.5 && 'rounded-l-bar')}
                    style={{
                        width: `${homeW}%`,
                        backgroundColor: hc,
                        backgroundImage: `linear-gradient(90deg, ${hc}, color-mix(in srgb, ${hc} 70%, #000))`,
                        boxShadow: homeDog ? undefined : `0 0 26px -4px ${hc}`,
                        filter: homeDog ? 'saturate(.55) brightness(.75)' : undefined,
                    }}
                >
                    <span className="wb-hatch absolute inset-0" />
                </span>

                {/* Percentages (not scaled with the fills). */}
                {awayW >= sz.numMin ? (
                    <span
                        className={cn('absolute inset-y-0 left-0 flex items-center gap-1.5 whitespace-nowrap', sz.pad)}
                        style={{ color: awayInk, textShadow: inkShadow(awayInk) }}
                    >
                        <Num n={awayN} tri={away} className={sz.num} />
                        {showCodes ? <span className={cn('font-bold tracking-wide opacity-80', sz.code)}>{away}</span> : null}
                    </span>
                ) : null}
                {homeW >= sz.numMin ? (
                    <span
                        className={cn('absolute inset-y-0 right-0 flex items-center justify-end gap-1.5 whitespace-nowrap', sz.pad)}
                        style={{ color: homeInk, textShadow: inkShadow(homeInk) }}
                    >
                        {showCodes ? <span className={cn('font-bold tracking-wide opacity-80', sz.code)}>{home}</span> : null}
                        <Num n={homeN} tri={home} className={sz.num} />
                    </span>
                ) : null}

                {/* MARKET tick */}
                {mkt != null ? (
                    <span aria-hidden="true" className={cn('wb-mark pointer-events-none absolute -ml-px w-0.5', sz.tick)} style={{ left: `${mkt * 100}%` }}>
                        <span className="block h-full w-full bg-white shadow-[0_0_8px_rgba(255,255,255,.8)]" />
                    </span>
                ) : null}
                {/* MODEL diamond */}
                {mdl != null ? (
                    <span aria-hidden="true" className="wb-mark pointer-events-none absolute -bottom-[13px] -ml-[4.5px] h-[9px] w-[9px]" style={{ left: `${mdl * 100}%` }}>
                        <span className="block h-full w-full rotate-45 bg-magenta shadow-[0_0_10px_rgb(var(--model-rgb))]" />
                    </span>
                ) : null}
            </div>

            {/* Labels for slivers too thin to hold text */}
            {awayW < sz.numMin || homeW < sz.numMin ? (
                <div aria-hidden="true" className={cn('flex justify-between text-caption font-bold text-fg-2', mdl != null ? 'mt-4' : 'mt-1')}>
                    <span>{awayW < sz.numMin ? `${away} ${awayN}%` : ''}</span>
                    <span>{homeW < sz.numMin ? `${homeN}% ${home}` : ''}</span>
                </div>
            ) : null}
        </div>
    );
}

/** The single legend row for a page of win bars: "| MARKET  ◆ MODEL". */
export function WinBarLegend({ className, market = true, model = true }: { className?: string; market?: boolean; model?: boolean }) {
    return (
        <p className={cn('flex items-center gap-4 text-micro uppercase tracking-wide text-fg-3', className)}>
            {market ? (
                <span className="inline-flex items-center gap-1.5">
                    <i aria-hidden="true" className="inline-block h-3 w-0.5 bg-white" />
                    Market
                </span>
            ) : null}
            {model ? (
                <span className="inline-flex items-center gap-1.5">
                    <i aria-hidden="true" className="inline-block h-2 w-2 rotate-45 bg-magenta" />
                    Model
                </span>
            ) : null}
        </p>
    );
}

const implied = (o: number) => (o > 0 ? 100 / (o + 100) : -o / (-o + 100));
const parseOdds = (o?: number | string | null) => {
    const n = typeof o === 'string' ? parseInt(o, 10) : o;
    return n && Number.isFinite(n) ? n : null;
};

/** Vig-free (proportional) market probability for the AWAY team from American moneylines. */
export function marketProbFromOdds(awayOdds?: number | string | null, homeOdds?: number | string | null): number | null {
    const a = parseOdds(awayOdds);
    const h = parseOdds(homeOdds);
    if (a == null || h == null) return null;
    const ai = implied(a);
    const hi = implied(h);
    return ai + hi > 0 ? ai / (ai + hi) : null;
}

export interface MarketBand {
    lo: number;
    hi: number;
    label?: string;
}

/** Market band (away-win probability range) from American moneylines, vig included. */
export function marketBandFromOdds(awayOdds?: number | string | null, homeOdds?: number | string | null): MarketBand | null {
    const a = parseOdds(awayOdds);
    const h = parseOdds(homeOdds);
    if (a == null || h == null) return null;
    const lo = Math.max(0, 1 - implied(h));
    const hi = Math.min(1, implied(a));
    return hi > lo ? { lo, hi } : null;
}

export default WinBar;
