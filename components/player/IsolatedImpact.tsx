'use client';

import * as React from 'react';
import Link from 'next/link';
import * as Popover from '@radix-ui/react-popover';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/utils';
import { isoRings, levels, resample, ringsPath, type Pt } from '@/lib/players/isolate-contour';
import { minutes, ordinal, PART_KEYS, PART_LABEL, sgn, sgnPct, THIN_MIN, windowLabel, type IsolateView, type MapKey, type PartKey } from '@/lib/players/isolate';

/**
 * Isolated impact, after HockeyViz: where on the ice a skater changes his
 * team's shots (offence) and the opponents' (defence) against an average
 * player in his place, with teammates, opponents, score and zone starts held
 * fixed. Half rinks with the net at the top, the shooter's left on the left:
 * orange where more unblocked shots come from than with an average skater,
 * blue where fewer. Each map carries its xG/60 impact; the parts list sums
 * to goals over a standard season. Hover (mouse) or tap a map or a part for
 * its numbers; tap again or elsewhere to close. 5v5 by default, the power
 * play and penalty kill behind the toggle.
 */

const MORE = '#f39143';
const FEWER = '#38c6e6';
const PANEL = '#0a0e15';
/** Band opacities, low to high; the thresholds are evenly spaced codes up to TOP. */
const ALPHA = [0.2, 0.36, 0.53, 0.7, 0.88];
const TOP = 110;
const W = 85;
const H = 80;
const CORNER = 28;

type Strength = 'ev' | 'st';

function mix(hex: string, a: number): string {
    const p = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
    const c = [1, 3, 5].map(i => Math.round(p(hex, i) * a + p(PANEL, i) * (1 - a)));
    return `rgb(${c.join(',')})`;
}

const RINK = `M0,${H}L0,${CORNER}A${CORNER},${CORNER} 0 0 1 ${CORNER},0L${W - CORNER},0A${CORNER},${CORNER} 0 0 1 ${W},${CORNER}L${W},${H}Z`;
// Goal line 11 ft from the end boards, where it meets the rounded corners.
const GOAL_Y = 11;
const GOAL_X = CORNER - Math.sqrt(CORNER ** 2 - (CORNER - GOAL_Y) ** 2);

/** The half rink's markings (net at the top), under the data. */
function RinkLines() {
    return (
        <g fill="none" className="stroke-fg-3" strokeOpacity={0.45} strokeWidth={0.45}>
            <line x1={GOAL_X} x2={W - GOAL_X} y1={GOAL_Y} y2={GOAL_Y} />
            <line x1={0} x2={W} y1={75} y2={75} strokeWidth={1.1} />
            {[20.5, 64.5].map(cx => (
                <g key={cx}>
                    <circle cx={cx} cy={31} r={15} />
                    <circle cx={cx} cy={31} r={0.9} className="fill-fg-3" stroke="none" fillOpacity={0.6} />
                </g>
            ))}
            <path d={`M${W / 2 - 6},${GOAL_Y}A6,6 0 0 0 ${W / 2 + 6},${GOAL_Y}`} />
            <rect x={W / 2 - 3} y={GOAL_Y - 3.3} width={6} height={3.3} rx={0.6} />
        </g>
    );
}

interface MapSpec {
    key: MapKey;
    label: string;
    unit: string;
    value: number;
    league: number;
    codes: number[] | null;
}

/** Filled contour bands for one map's int8 codes. */
function useBands(codes: number[] | null, nx: number, ny: number) {
    return React.useMemo(() => {
        if (!codes) return null;
        const lat = resample(codes, nx, ny, 4);
        const neg = { ...lat, v: lat.v.map(x => -x) };
        const cellPx = 5 * lat.step;
        // lattice (i along the rink, j across) -> drawing: net at the top, the shooter's left on the left
        const to = ([i, j]: Pt): Pt => [W - j * cellPx, H - i * cellPx];
        const ts = levels(TOP, ALPHA.length);
        return {
            more: ts.map(t => ringsPath(isoRings(lat, t), to, 1)),
            fewer: ts.map(t => ringsPath(isoRings(neg, t), to, 1)),
        };
    }, [codes, nx, ny]);
}

function RinkMap({ spec, nx, ny, thin, id }: { spec: MapSpec; nx: number; ny: number; thin: boolean; id: string }) {
    const bands = useBands(spec.codes, nx, ny);
    return (
        <svg viewBox={`-1 -1 ${W + 2} ${H + 2}`} className="block h-auto w-full select-none" aria-hidden="true">
            <defs>
                <clipPath id={id}>
                    <path d={RINK} />
                </clipPath>
            </defs>
            <path d={RINK} fill={PANEL} />
            <g clipPath={`url(#${id})`} opacity={thin ? 0.6 : 1}>
                {bands
                    ? ALPHA.map((a, k) => (
                          <React.Fragment key={k}>
                              {bands.more[k] ? <path d={bands.more[k]} fill={mix(MORE, a)} fillRule="evenodd" /> : null}
                              {bands.fewer[k] ? <path d={bands.fewer[k]} fill={mix(FEWER, a)} fillRule="evenodd" /> : null}
                          </React.Fragment>
                      ))
                    : null}
            </g>
            <RinkLines />
            <path d={RINK.replace(/Z$/, '')} fill="none" className="stroke-line-strong" strokeWidth={0.7} />
            {!spec.codes ? (
                <text x={W / 2} y={H / 2 + 8} textAnchor="middle" className="fill-fg-3 uppercase" style={{ fontSize: 4.2, letterSpacing: '0.16em' }}>
                    No time
                </text>
            ) : null}
        </svg>
    );
}

/** The legend: five bands each way, fewer (blue) to more (orange) shots. */
function Ramp() {
    return (
        <span className="flex items-center gap-1.5">
            Fewer
            <span className="flex" aria-hidden="true">
                {[...ALPHA].reverse().map(a => (
                    <span key={`f${a}`} className="h-2.5 w-2.5" style={{ background: mix(FEWER, a) }} />
                ))}
                {ALPHA.map(a => (
                    <span key={`m${a}`} className="h-2.5 w-2.5" style={{ background: mix(MORE, a) }} />
                ))}
            </span>
            More shots
        </span>
    );
}

type CardKey = PartKey;

/** The numbers behind one map or part: label / value pairs, no prose. */
function NumbersCard({ k, v }: { k: CardKey; v: IsolateView }) {
    const p = v.player;
    const L = v.league;
    const rows: [string, React.ReactNode, string?][] = [];
    const xg = (n: number) => <span className="text-model">{sgn(n)}</span>;
    if (k === 'evOff') rows.push(['xGF/60', xg(p.evOff)], ['vs league', sgnPct(p.evOff / L.ev_xg)], ['Shots/60', sgn(p.evOffSh, 1)], ['5v5 min', minutes(p.toi)]);
    if (k === 'evDef') rows.push(['xGA/60', xg(p.evDef)], ['vs league', sgnPct(p.evDef / L.ev_xg)], ['Shots/60', sgn(p.evDefSh, 1)], ['5v5 min', minutes(p.toi)]);
    if (k === 'pp') rows.push(['xGF/60', xg(p.ppOff)], ['vs league', sgnPct(p.ppOff / L.pp_xg)], ['PP min', minutes(p.toiPp)]);
    if (k === 'pk') rows.push(['xGA/60', xg(p.pkDef)], ['vs league', sgnPct(p.pkDef / L.pp_xg)], ['PK min', minutes(p.toiPk)]);
    if (k === 'fin') rows.push(['Goals / xG', `×${p.finX.toFixed(2)}`]);
    if (k === 'draw') rows.push(['Drawn/60', p.drawn60.toFixed(2)]);
    if (k === 'take') rows.push(['Taken/60', p.taken60.toFixed(2)]);
    rows.push(['Goals', sgn(p.goals[k], 1)]);
    const pc = v.pct[k];
    if (pc != null) rows.push(['Rank', `${ordinal(pc)} pct`, p.pos === 'D' ? 'D' : 'F']);
    return (
        <div className="min-w-[11rem] text-caption tabular-nums">
            <p className="mb-1 text-micro uppercase tracking-label text-fg-3">{PART_LABEL[k]}</p>
            <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5">
                {rows.map(([a, b, c]) => (
                    <React.Fragment key={a}>
                        <dt className="text-fg-3">{a}</dt>
                        <dd className="text-right text-fg-1">
                            {b}
                            {c ? <span className="ml-1 text-fg-3">{c}</span> : null}
                        </dd>
                    </React.Fragment>
                ))}
            </dl>
        </div>
    );
}

const CARD = 'rounded-card border border-line-strong bg-surface-1/95 p-3';

/** The tapped card, in the flow under its item; scrolled into view (clear of the bars) when it opens off screen. */
function FlowCard({ className, children }: { className?: string; children: React.ReactNode }) {
    const ref = React.useRef<HTMLDivElement>(null);
    React.useEffect(() => {
        ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, []);
    return (
        <div ref={ref} className={cn(CARD, 'scroll-my-20', className)}>
            {children}
        </div>
    );
}

/** A hover card (mouse) anchored to its child, kept inside the viewport clear of the app and tab bars. */
function Hover({ open, side, children, card }: { open: boolean; side: 'bottom' | 'right' | 'left'; children: React.ReactElement; card: React.ReactNode }) {
    return (
        <Popover.Root open={open}>
            <Popover.Anchor asChild>{children}</Popover.Anchor>
            <Popover.Portal>
                <Popover.Content
                    side={side}
                    align="center"
                    sideOffset={8}
                    collisionPadding={{ top: 72, bottom: 72, left: 16, right: 16 }}
                    onOpenAutoFocus={e => e.preventDefault()}
                    onCloseAutoFocus={e => e.preventDefault()}
                    className={cn(CARD, 'pointer-events-none z-50 shadow-[0_12px_32px_rgb(0_0_0/0.55)] backdrop-blur-sm')}
                >
                    {card}
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}

export function IsolatedImpact({ view, prior, seasonTag }: { view: IsolateView; prior: boolean; seasonTag: string }) {
    const [strength, setStrength] = React.useState<Strength>('ev');
    // The hovered item (mouse): which card and where it sits (a map and its parts row share a card).
    const [hover, setHover] = React.useState<{ k: CardKey; at: 'map' | 'row' } | null>(null);
    // The tapped (touch, pen) or keyboard-opened item: its card sits in the flow under it.
    const [tapped, setTapped] = React.useState<{ k: CardKey; at: 'map' | 'row' } | null>(null);
    const pointer = React.useRef('');
    const rootRef = React.useRef<HTMLDivElement>(null);
    const uid = React.useId().replace(/:/g, '');
    const p = view.player;
    const { nx, ny } = view.grid;
    const thin = p.toi < THIN_MIN;

    // A tap outside the section, or Escape, closes the tapped card.
    React.useEffect(() => {
        if (!tapped) return;
        const off = (e: PointerEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setTapped(null);
        };
        const esc = (e: KeyboardEvent) => e.key === 'Escape' && setTapped(null);
        document.addEventListener('pointerdown', off);
        document.addEventListener('keydown', esc);
        return () => {
            document.removeEventListener('pointerdown', off);
            document.removeEventListener('keydown', esc);
        };
    }, [tapped]);

    const maps: [MapSpec, MapSpec] =
        strength === 'ev'
            ? [
                  { key: 'evOff', label: 'Offence', unit: 'xGF/60', value: p.evOff, league: view.league.ev_xg, codes: p.maps.evOff },
                  { key: 'evDef', label: 'Defence', unit: 'xGA/60', value: p.evDef, league: view.league.ev_xg, codes: p.maps.evDef },
              ]
            : [
                  { key: 'pp', label: 'Power play', unit: 'xGF/60', value: p.ppOff, league: view.league.pp_xg, codes: p.maps.pp },
                  { key: 'pk', label: 'Penalty kill', unit: 'xGA/60', value: p.pkDef, league: view.league.pp_xg, codes: p.maps.pk },
              ];

    // Mouse hovers; touch, pen and keyboard toggle a card in the flow under the item.
    const handlers = (k: CardKey, at: 'map' | 'row') => ({
        onPointerEnter: (e: React.PointerEvent) => e.pointerType === 'mouse' && setHover({ k, at }),
        onPointerLeave: (e: React.PointerEvent) => e.pointerType === 'mouse' && setHover(h => (h?.k === k && h.at === at ? null : h)),
        onPointerDown: (e: React.PointerEvent) => {
            pointer.current = e.pointerType;
        },
        onClick: () => {
            const mouse = pointer.current === 'mouse';
            pointer.current = '';
            if (mouse) return; // the hover card already shows it
            setHover(null);
            setTapped(t => (t?.k === k && t.at === at ? null : { k, at }));
        },
    });
    const isOpen = (k: CardKey, at: 'map' | 'row') => tapped?.k === k && tapped.at === at;
    const isMouseCard = (k: CardKey, at: 'map' | 'row') => hover?.k === k && hover.at === at && !isOpen(k, at);
    // The map and its parts row light up together.
    const lit = (k: CardKey) => tapped?.k === k || hover?.k === k;

    const reach = Math.max(5, Math.ceil(Math.max(...PART_KEYS.map(k => Math.abs(p.goals[k])))));

    const mapPane = (m: MapSpec, side: 'right' | 'left', order: string) => (
        <div key={m.key} className={cn('flex min-w-0 flex-col items-center gap-2', order)}>
            <Hover open={isMouseCard(m.key, 'map')} side={side} card={<NumbersCard k={m.key} v={view} />}>
                <button
                    type="button"
                    {...handlers(m.key, 'map')}
                    aria-expanded={isOpen(m.key, 'map')}
                    aria-label={m.codes ? `${m.label}: ${sgn(m.value)} ${m.unit}, ${sgnPct(m.value / m.league)} vs league` : `${m.label}: no time`}
                    className={cn(
                        'flex w-full max-w-[25rem] flex-col gap-1.5 rounded-control p-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand',
                        lit(m.key) && 'bg-surface-2/60',
                    )}
                >
                    <span className="flex items-baseline justify-between gap-2 px-0.5">
                        <span className="text-micro uppercase tracking-label text-fg-3">{m.label}</span>
                        {m.codes ? (
                            <span className="flex items-baseline gap-1.5 tabular-nums">
                                <span className="font-display text-title font-bold text-model">{sgn(m.value)}</span>
                                <span className="text-micro text-fg-3">{m.unit}</span>
                                <span className="text-caption text-fg-2">{sgnPct(m.value / m.league)}</span>
                            </span>
                        ) : (
                            <span className="font-display text-title font-bold text-fg-3">—</span>
                        )}
                    </span>
                    <RinkMap spec={m} nx={nx} ny={ny} thin={thin} id={`iso-${uid}-${m.key}`} />
                </button>
            </Hover>
            {isOpen(m.key, 'map') ? (
                <FlowCard className="w-full max-w-[25rem]">
                    <NumbersCard k={m.key} v={view} />
                </FlowCard>
            ) : null}
        </div>
    );

    return (
        <div ref={rootRef} className="panel p-card">
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-micro uppercase tracking-label text-fg-3">
                <Segmented
                    label="Strength"
                    size="sm"
                    value={strength}
                    onChange={v => {
                        setStrength(v);
                        setTapped(null);
                        setHover(null);
                    }}
                    options={[
                        { value: 'ev', label: '5v5' },
                        { value: 'st', label: 'PP · PK' },
                    ]}
                />
                <Ramp />
                <span className="flex items-center gap-x-2">
                    <span>{windowLabel(view.window)}</span>
                    {prior ? (
                        <span className="rounded-chip border border-dashed border-mute px-1.5 text-fg-2">{seasonTag}</span>
                    ) : thin ? (
                        <span className="rounded-chip border border-dashed border-warn/60 px-1.5 text-warn">{minutes(p.toi)} min</span>
                    ) : null}
                </span>
                <Link href="/methodology#isolated-impact" className="ml-auto underline-offset-4 hover:text-fg-1 hover:underline coarse:-my-3 coarse:inline-flex coarse:min-h-11 coarse:items-center">
                    Method
                </Link>
            </div>
            <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,17rem)_minmax(0,1fr)]">
                {mapPane(maps[0], 'right', 'lg:order-1')}
                {mapPane(maps[1], 'left', 'lg:order-3')}
                {/* Parts: the total, then each component as a small signed bar. */}
                <div className="flex min-w-0 flex-col gap-2 sm:col-span-2 lg:order-2 lg:col-span-1">
                    <div className="flex items-end justify-between gap-3 border-b border-line pb-2">
                        <div>
                            <p className="text-micro uppercase tracking-label text-fg-3">Total</p>
                            <p className="font-display text-display font-bold leading-none tabular-nums text-fg-1">{sgn(p.goals.total, 1)}</p>
                        </div>
                        <p className="pb-0.5 text-right text-micro uppercase tracking-label text-fg-3">
                            Goals · std season
                            {view.pct.total != null ? (
                                <span className="block normal-case tracking-normal text-fg-2">
                                    {ordinal(view.pct.total)} pct {p.pos === 'D' ? 'D' : 'F'}
                                </span>
                            ) : null}
                        </p>
                    </div>
                    <ul className="flex flex-col">
                        {PART_KEYS.map(k => {
                            const g = p.goals[k];
                            const w = (Math.min(Math.abs(g), reach) / reach) * 50;
                            return (
                                <li key={k}>
                                    <Hover open={isMouseCard(k, 'row')} side="bottom" card={<NumbersCard k={k} v={view} />}>
                                        <button
                                            type="button"
                                            {...handlers(k, 'row')}
                                            aria-expanded={isOpen(k, 'row')}
                                            className={cn(
                                                'grid w-full grid-cols-[6.5rem_minmax(0,1fr)_3rem] items-center gap-2 rounded-chip px-1 py-1 text-left text-caption outline-none hover:bg-surface-2/60 focus-visible:ring-2 focus-visible:ring-brand coarse:min-h-11',
                                                lit(k) && 'bg-surface-2/60',
                                            )}
                                        >
                                            <span className="truncate text-fg-2">{PART_LABEL[k]}</span>
                                            <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="block h-2.5 w-full" aria-hidden="true">
                                                <rect x={0} y={0} width={100} height={10} fill="var(--track)" />
                                                <rect x={g >= 0 ? 50 : 50 - w} y={1} width={w} height={8} fill={g >= 0 ? 'var(--text-1)' : 'var(--text-3)'} opacity={g >= 0 ? 0.75 : 0.6} />
                                                <line x1={50} x2={50} y1={0} y2={10} className="stroke-fg-3" vectorEffect="non-scaling-stroke" />
                                            </svg>
                                            <span className={cn('text-right tabular-nums', Math.abs(g) < 0.05 ? 'text-fg-3' : 'text-fg-1')}>{sgn(g, 1)}</span>
                                        </button>
                                    </Hover>
                                    {isOpen(k, 'row') ? (
                                        <FlowCard className="my-1">
                                            <NumbersCard k={k} v={view} />
                                        </FlowCard>
                                    ) : null}
                                </li>
                            );
                        })}
                    </ul>
                </div>
            </div>
        </div>
    );
}
