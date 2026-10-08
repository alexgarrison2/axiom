'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/utils';
import { DIVISION_LABEL, DIVISION_OF, DIVISIONS } from '@/utils/team-stats/teams';
import type { LeaguePayload } from '@/utils/team-stats/types';

/**
 * The league at a glance, above the table.
 *  MAP: every crest at its expected goals for (across) and against (up = fewer)
 *       per game; quadrants name the four kinds of team. Hover a crest for its
 *       numbers and a magenta tether to where the model rates it; SEASON / MODEL
 *       slides every crest between the two.
 *  RACE: each division's projected points (magenta tick on the likely range)
 *       with playoff odds. It leads while teams have played under 10 games,
 *       when the season's xG is still mostly noise.
 * Hovering a crest highlights the team's table row (and the row, the crest)
 * through `data-tri`, without re-rendering either.
 */

const FULL_GP = 10;
type View = 'map' | 'race';
type Plot = 'season' | 'model';

const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / (a.length || 1);

interface Pt {
    tri: string;
    name: string;
    gp: number;
    rec: string;
    sx: number; // season xGF / game
    sy: number; // season xGA / game
    mx: number | null; // model
    my: number | null;
}

export function LeagueHero({ payload, rootRef }: { payload: LeaguePayload; rootRef: React.RefObject<HTMLElement | null> }) {
    const hasModel = !!payload.ratings;
    const hasRace = !!payload.projections;
    const played = payload.standings.filter(r => r.gp > 0);
    const medianGp = played.length ? [...played].sort((a, b) => a.gp - b.gp)[Math.floor(played.length / 2)].gp : 0;
    const [view, setView] = React.useState<View>(hasRace && medianGp < FULL_GP ? 'race' : 'map');
    const [plot, setPlot] = React.useState<Plot>('season');
    if (!played.length && !hasRace) return null;

    const pts: Pt[] = payload.standings
        .filter(r => r.gp > 0)
        .map(r => {
            const m = payload.ratings?.[r.tri];
            return {
                tri: r.tri,
                name: payload.teams.find(t => t.tri === r.tri)?.name ?? r.tri,
                gp: r.gp,
                rec: `${r.wins}-${r.losses}-${r.otl}`,
                sx: r.xgf_per_game,
                sy: r.xga_per_game,
                mx: m?.xgf_rating ?? null,
                my: m?.xga_rating ?? null,
            };
        });
    const gps = played.map(r => r.gp);
    const span = gps.length ? (Math.min(...gps) === Math.max(...gps) ? `${gps[0]}` : `${Math.min(...gps)}–${Math.max(...gps)}`) : '0';
    const showMap = view === 'map' || !hasRace;

    return (
        <section aria-label="League at a glance" className="panel overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 px-3 pt-3 md:px-4">
                {hasRace && pts.length ? (
                    <Segmented
                        label="League view"
                        size="sm"
                        value={view}
                        onChange={setView}
                        options={[
                            { value: 'map', label: 'Map' },
                            { value: 'race', label: 'Race' },
                        ]}
                    />
                ) : null}
                {medianGp < FULL_GP && played.length ? (
                    <span title="Games played so far: a thin sample" className="inline-flex h-6 items-center rounded-chip border border-dashed border-warn/55 px-2 text-micro font-medium tracking-[0.08em] text-warn">
                        {span} GP
                    </span>
                ) : null}
                <span className="flex-1" />
                {showMap && hasModel ? (
                    <Segmented
                        label="Plot crests at"
                        size="sm"
                        value={plot}
                        onChange={setPlot}
                        options={[
                            { value: 'season', label: 'Season' },
                            { value: 'model', label: 'Model' },
                        ]}
                    />
                ) : null}
            </div>
            {showMap ? <IceMap pts={pts} plot={plot} rootRef={rootRef} /> : <Race payload={payload} rootRef={rootRef} />}
        </section>
    );
}

/** Highlight one team's crest and table row (null clears). */
export function focusTeam(root: HTMLElement | null, tri: string | null) {
    if (!root) return;
    root.toggleAttribute('data-focusing', !!tri);
    root.querySelectorAll<HTMLElement>('[data-tri]').forEach(el => el.toggleAttribute('data-focus', el.dataset.tri === tri));
}

function IceMap({ pts, plot, rootRef }: { pts: Pt[]; plot: Plot; rootRef: React.RefObject<HTMLElement | null> }) {
    const router = useRouter();
    const wrap = React.useRef<HTMLDivElement>(null);
    const [w, setW] = React.useState(0);
    const [tip, setTip] = React.useState<{ p: Pt; x: number; y: number } | null>(null);
    React.useLayoutEffect(() => {
        const el = wrap.current;
        if (!el) return;
        const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const phone = w > 0 && w < 640;
    const H = phone ? Math.round(w * 0.95) : Math.min(520, Math.round(w * 0.42));
    const P = { l: phone ? 34 : 52, r: 16, t: 34, b: 34 };
    const C = phone ? 24 : 34;
    const xs = pts.flatMap(p => [p.sx, p.mx ?? p.sx]);
    const ys = pts.flatMap(p => [p.sy, p.my ?? p.sy]);
    const pad = 0.18;
    const [x0, x1] = [Math.min(...xs) - pad, Math.max(...xs) + pad];
    const [y0, y1] = [Math.min(...ys) - pad, Math.max(...ys) + pad];
    // Data stays clear of the corner labels; the grid spans the full plot.
    const inset = C / 2 + 16;
    const X = (v: number) => P.l + inset + ((v - x0) / (x1 - x0)) * (w - P.l - P.r - 2 * inset);
    const Y = (v: number) => P.t + inset + ((v - y0) / (y1 - y0)) * (H - P.t - P.b - 2 * inset); // fewer against = higher
    const X_ = (px: number) => x0 + ((px - P.l - inset) / (w - P.l - P.r - 2 * inset)) * (x1 - x0);
    const Y_ = (px: number) => y0 + ((px - P.t - inset) / (H - P.t - P.b - 2 * inset)) * (y1 - y0);
    const ax = mean(pts.map(p => p.sx));
    const ay = mean(pts.map(p => p.sy));
    const ticks = (a: number, b: number) => {
        const out: number[] = [];
        for (let v = Math.ceil(a * 2) / 2; v <= b; v += 0.5) out.push(v);
        return out;
    };
    // Tick range covers the whole plot, including the label inset.
    const [tx0, tx1] = [X_(P.l), X_(w - P.r)];
    const [ty0, ty1] = [Y_(P.t), Y_(H - P.b)];
    const at = (p: Pt) => (plot === 'model' && p.mx !== null && p.my !== null ? [X(p.mx), Y(p.my)] : [X(p.sx), Y(p.sy)]);
    const other = (p: Pt) => (plot === 'model' ? [X(p.sx), Y(p.sy)] : p.mx !== null && p.my !== null ? [X(p.mx), Y(p.my)] : null);

    const enter = (p: Pt) => {
        focusTeam(rootRef.current, p.tri);
        const [cx, cy] = at(p);
        setTip({ p, x: cx, y: cy });
    };
    const leave = () => {
        focusTeam(rootRef.current, null);
        setTip(null);
    };

    return (
        <div ref={wrap} className="relative px-2 pb-1 md:px-3">
            {w > 0 ? (
                <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img" aria-label="Expected goals for and against per game, every team" className="ice-map block overflow-visible">
                    {ticks(tx0, tx1).map(v => (
                        <g key={`x${v}`}>
                            <line x1={X(v)} x2={X(v)} y1={P.t} y2={H - P.b} className="stroke-line" />
                            <text x={X(v)} y={H - P.b + 18} textAnchor="middle" className="fill-fg-3 text-micro">
                                {v.toFixed(1)}
                            </text>
                        </g>
                    ))}
                    {ticks(ty0, ty1).map(v => (
                        <g key={`y${v}`}>
                            <line y1={Y(v)} y2={Y(v)} x1={P.l} x2={w - P.r} className="stroke-line" />
                            <text x={P.l - 8} y={Y(v) + 4} textAnchor="end" className="fill-fg-3 text-micro">
                                {v.toFixed(1)}
                            </text>
                        </g>
                    ))}
                    <line x1={X(ax)} x2={X(ax)} y1={P.t} y2={H - P.b} strokeDasharray="3 4" className="stroke-line-strong" />
                    <line y1={Y(ay)} y2={Y(ay)} x1={P.l} x2={w - P.r} strokeDasharray="3 4" className="stroke-line-strong" />
                    <text x={w - P.r} y={H - 4} textAnchor="end" className="fill-fg-3 text-micro tracking-[0.06em]">
                        xG FOR / GAME →
                    </text>
                    <text x={P.l} y={P.t - 14} className="fill-fg-3 text-micro tracking-[0.06em]">
                        ↑ FEWER xG AGAINST
                    </text>
                    {(
                        [
                            ['Dominant', w - P.r - 8, P.t + 18, 'end'],
                            ['Stingy', P.l + 8, P.t + 18, 'start'],
                            ['Wide open', w - P.r - 8, H - P.b - 10, 'end'],
                            ['Sinking', P.l + 8, H - P.b - 10, 'start'],
                        ] as const
                    ).map(([t, x, y, a]) => (
                        <text key={t} x={x} y={y} textAnchor={a} className="fill-fg-3 text-micro font-semibold uppercase tracking-label">
                            {t}
                        </text>
                    ))}
                    {/* Tethers: shown for the focused team only. */}
                    {pts.map(p => {
                        const o = other(p);
                        if (!o) return null;
                        const [cx, cy] = at(p);
                        return (
                            <g key={`t${p.tri}`} data-tri={p.tri} className="ice-tether">
                                <line x1={cx} y1={cy} x2={o[0]} y2={o[1]} className="stroke-model" strokeWidth={1.5} />
                                <circle cx={o[0]} cy={o[1]} r={3.5} className={plot === 'season' ? 'fill-bg stroke-model' : 'fill-fg-2'} strokeWidth={1.75} />
                            </g>
                        );
                    })}
                    {pts.map(p => {
                        const [cx, cy] = at(p);
                        const op = plot === 'season' ? 0.5 + 0.5 * Math.min(1, p.gp / FULL_GP) : 1;
                        return (
                            <g
                                key={p.tri}
                                data-tri={p.tri}
                                role="link"
                                tabIndex={0}
                                aria-label={`${p.name}: ${p.sx.toFixed(2)} xG for, ${p.sy.toFixed(2)} against per game`}
                                className="ice-crest cursor-pointer outline-none"
                                style={{ transform: `translate(${cx}px, ${cy}px)`, opacity: op }}
                                onMouseEnter={() => enter(p)}
                                onMouseLeave={leave}
                                onFocus={() => enter(p)}
                                onBlur={leave}
                                onClick={() => router.push(`/teams/${p.tri}`)}
                                onKeyDown={e => e.key === 'Enter' && router.push(`/teams/${p.tri}`)}
                            >
                                <image href={`/logos/${p.tri}.svg`} x={-C / 2} y={-C / 2} width={C} height={C} />
                            </g>
                        );
                    })}
                </svg>
            ) : (
                <div style={{ height: 420 }} />
            )}
            {tip ? (
                <div
                    aria-hidden="true"
                    className="pointer-events-none absolute z-10 min-w-[200px] rounded-bar border border-line-strong bg-surface-1/95 px-3 py-2.5 text-caption backdrop-blur"
                    style={{ left: tip.x + 260 > w ? tip.x - 236 : tip.x + 30, top: Math.max(0, tip.y - 24) }}
                >
                    <div className="mb-1.5 flex items-center gap-2 text-title font-bold text-fg-1">
                        {/* eslint-disable-next-line @next/next/no-img-element -- static SVG crest */}
                        <img src={`/logos/${tip.p.tri}.svg`} alt="" width={26} height={26} />
                        {tip.p.name}
                        <span className="ml-auto text-micro font-medium tracking-label text-fg-3">{tip.p.gp} GP</span>
                    </div>
                    <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-0.5 tabular-nums">
                        <span />
                        <span className="text-micro tracking-[0.1em] text-fg-3">SEASON</span>
                        <span className="text-micro tracking-[0.1em] text-model">MODEL</span>
                        <span className="text-fg-3">xGF / game</span>
                        <span className="text-right text-fg-1">{tip.p.sx.toFixed(2)}</span>
                        <span className="text-right text-model">{tip.p.mx?.toFixed(2) ?? '—'}</span>
                        <span className="text-fg-3">xGA / game</span>
                        <span className="text-right text-fg-1">{tip.p.sy.toFixed(2)}</span>
                        <span className="text-right text-model">{tip.p.my?.toFixed(2) ?? '—'}</span>
                        <span className="text-fg-3">Record</span>
                        <span className="text-right text-fg-1">{tip.p.rec}</span>
                        <span />
                    </div>
                </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 pb-2.5 text-micro text-fg-3">
                <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full border-[1.5px] border-model" />
                    <span className="-ml-1.5 h-px w-4 bg-model" />
                    model rating, on hover
                </span>
                <span className="inline-flex items-center gap-1.5">
                    <span className="w-4 border-t border-dashed border-line-strong" />
                    league average
                </span>
                <span>faded crest = fewer games</span>
            </div>
        </div>
    );
}

function Race({ payload, rootRef }: { payload: LeaguePayload; rootRef: React.RefObject<HTMLElement | null> }) {
    const router = useRouter();
    const proj = payload.projections ?? {};
    const vals = Object.values(proj);
    const lo = Math.min(...vals.map(p => p.p10).filter(Number.isFinite)) - 2;
    const hi = Math.max(...vals.map(p => p.p90).filter(Number.isFinite)) + 2;
    const pc = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
    return (
        <div className="grid gap-x-6 gap-y-4 px-3 pb-3 pt-3 sm:grid-cols-2 md:px-4 xl:grid-cols-4">
            {DIVISIONS.map(d => {
                const rows = Object.entries(proj)
                    .filter(([tri]) => DIVISION_OF[tri] === d)
                    .sort((a, b) => b[1].points - a[1].points);
                return (
                    <div key={d}>
                        <h3 className="mb-1.5 text-micro font-bold uppercase tracking-label text-fg-2">{DIVISION_LABEL[d]}</h3>
                        {rows.map(([tri, p], i) => (
                            <React.Fragment key={tri}>
                                {i === 3 ? (
                                    <div className="relative my-1 ml-9 border-t border-dashed border-line-strong">
                                        <span className="absolute -top-2 right-0 bg-surface-1 pl-1.5 text-micro uppercase tracking-label text-fg-3">Top 3</span>
                                    </div>
                                ) : null}
                                <button
                                    type="button"
                                    data-tri={tri}
                                    onClick={() => router.push(`/teams/${tri}`)}
                                    onMouseEnter={() => focusTeam(rootRef.current, tri)}
                                    onMouseLeave={() => focusTeam(rootRef.current, null)}
                                    title={`${payload.teams.find(t => t.tri === tri)?.name}: projected ${Math.round(p.points)} points (likely ${p.p10}–${p.p90}), ${Math.round(p.playoff)}% to make the playoffs`}
                                    className="race-row grid h-[30px] w-full grid-cols-[26px_34px_1fr_44px] items-center gap-2 rounded-chip px-1 text-left hover:bg-[color-mix(in_srgb,var(--line)_60%,transparent)]"
                                >
                                    {/* eslint-disable-next-line @next/next/no-img-element -- static SVG crest */}
                                    <img src={`/logos/${tri}.svg`} alt="" width={26} height={26} />
                                    <span className="text-caption font-bold text-fg-1">{tri}</span>
                                    <span aria-hidden="true" className="relative block h-3.5">
                                        <span className="absolute inset-x-0 top-1.5 h-0.5 bg-line" />
                                        <span className="absolute top-[5px] h-1 rounded-[2px] bg-model/35" style={{ left: pc(p.p10), width: `calc(${pc(p.p90)} - ${pc(p.p10)})` }} />
                                        <span className="absolute top-0.5 -ml-px h-2.5 w-0.5 rounded-[1px] bg-model" style={{ left: pc(p.points) }} />
                                    </span>
                                    <span className={cn('text-right text-caption tabular-nums', p.playoff >= 50 ? 'font-semibold text-model' : 'text-fg-3')}>
                                        {p.playoff < 1 ? '<1' : Math.round(p.playoff)}%
                                    </span>
                                </button>
                            </React.Fragment>
                        ))}
                    </div>
                );
            })}
            <div className="col-span-full flex flex-wrap items-center gap-x-4 gap-y-1 text-micro text-fg-3">
                <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-0.5 rounded-[1px] bg-model" />
                    projected points
                </span>
                <span className="inline-flex items-center gap-1.5">
                    <span className="h-1 w-4 rounded-[2px] bg-model/35" />
                    likely range
                </span>
                <span>
                    <span className="font-semibold text-model">%</span> playoff odds
                </span>
            </div>
        </div>
    );
}
