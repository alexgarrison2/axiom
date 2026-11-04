'use client';

import * as React from 'react';
import Link from 'next/link';
import { Rink3D } from '@/components/rink/Rink3D';
import { ShotDetail, ShotMapFrame, ShotSummary, fileShotInfo, useShotPick, type ShotPerson } from '@/components/rink/ShotDetail';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/utils';
import { S, fetchShots, goalieShotsUrl, shotLeagueUrl, wilson, type ShotFile, type ShotLeague, type ShotRow } from '@/lib/shots';
import { fmtInt } from '@/components/views/format';

/**
 * A goalie's season in pictures, between the hero and the game log:
 *  GSAx     goals saved above expected as a waterfall, game by game to the season
 *  Danger   save % on low / medium / high-danger shots against the league
 *  Save map every shot he faced on a tilted rink (or GSAx by area)
 *  Types    save % per shot type against the league, with the sample's likely range
 *  Situations GSAx by strength, sized by the share of shots faced there
 *  Workload every appearance in order: shots faced (saves, goals against), quality starts, back-to-backs
 * Shot-level sections read the season's shot file (pipeline/goalie_shots.py).
 */

export interface GoalieNight {
    game: number;
    date: string;
    opp: string;
    home: boolean;
    /** GSAx that night. */
    ps: number;
    sa: number;
    ga: number;
    xga: number;
    toi: number;
    decision: 'W' | 'L' | 'O' | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const sg = (v: number, d = 2) => {
    const r = Number(v.toFixed(d));
    return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toFixed(d)}`;
};
const p3 = (v: number) => (Number.isFinite(v) ? v.toFixed(3).replace(/^0/, '') : '—');
const sum = <T,>(a: T[], f: (x: T) => number) => a.reduce((s, x) => s + f(x), 0);
const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

function useWidth<T extends HTMLElement>() {
    const ref = React.useRef<T>(null);
    const [w, setW] = React.useState(0);
    React.useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    return [ref, w] as const;
}

function Panel({ title, actions, children, legend, className }: { title: string; actions?: React.ReactNode; children: React.ReactNode; legend?: React.ReactNode; className?: string }) {
    return (
        <section className={cn('panel flex min-w-0 flex-col gap-3 p-card', className)}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-micro font-semibold uppercase tracking-label text-fg-2">{title}</h3>
                {actions}
            </div>
            {children}
            {legend ? <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-micro text-fg-3">{legend}</div> : null}
        </section>
    );
}

const Swatch = ({ className, style }: { className?: string; style?: React.CSSProperties }) => <span aria-hidden="true" className={cn('inline-block shrink-0', className)} style={style} />;

export function GoalieSeason({ nights, season, id, name, self }: { nights: GoalieNight[]; season: string; id: number; name: string; self: ShotPerson }) {
    const [file, setFile] = React.useState<ShotFile | null | undefined>(undefined);
    const [league, setLeague] = React.useState<ShotLeague | null>(null);
    React.useEffect(() => {
        let live = true;
        setFile(undefined);
        Promise.all([fetchShots<ShotFile>(goalieShotsUrl(season, id)), fetchShots<ShotLeague>(shotLeagueUrl(season))]).then(([f, l]) => {
            if (!live) return;
            setFile(f);
            setLeague(l);
        });
        return () => {
            live = false;
        };
    }, [season, id]);
    const shots = file?.shots ?? [];
    const ready = file !== undefined;

    return (
        <div className="flex flex-col gap-4">
            <div className="grid gap-4 xl:grid-cols-[7fr_5fr]">
                <Race nights={nights} />
                <Panel
                    title="Danger"
                    legend={
                        <>
                            <span className="inline-flex items-center gap-1.5"><Swatch className="h-3 w-0.5 rounded-[1px] bg-model" />league</span>
                            <span className="inline-flex items-center gap-1.5"><Swatch className="h-3 w-2.5 rounded-[2px] border-2 border-fg-1" />{name}</span>
                        </>
                    }
                >
                    {ready && league ? <Ladder shots={shots} league={league} /> : <Pending ready={ready} />}
                </Panel>
            </div>
            <SaveMap file={file ?? null} ready={ready} self={self} />
            <div className="grid gap-4 xl:grid-cols-[5fr_7fr] xl:items-start">
                <Panel
                    title="Shot types"
                    legend={
                        <>
                            <span className="inline-flex items-center gap-1.5"><Swatch className="h-3 w-0.5 rounded-[1px] bg-model" />league</span>
                            <span className="inline-flex items-center gap-1.5"><Swatch className="h-2 w-2 rounded-full bg-fg-1" />{name}</span>
                            <span className="inline-flex items-center gap-1.5"><Swatch className="h-1 w-4 rounded-[2px] bg-fg-2/35" />likely range</span>
                        </>
                    }
                >
                    {ready && league ? (
                        <>
                            <ShotTypes shots={shots} league={league} />
                            <h3 className="mt-3 text-micro font-semibold uppercase tracking-label text-fg-2">Situations</h3>
                            <Situations shots={shots} />
                        </>
                    ) : (
                        <Pending ready={ready} />
                    )}
                </Panel>
                <Workload nights={nights} />
            </div>
        </div>
    );
}

function Pending({ ready }: { ready: boolean }) {
    return <p className="py-6 text-caption text-fg-3">{ready ? 'No shot data for this season yet.' : 'Loading'}</p>;
}

/* ── Columns: one per appearance (GSAx and Workload) ────────────────── */

/** Wide enough to print a figure over, and the opponent under, every column. */
const ROOMY = 34;

/** "@STL" on the road, "PIT" at home. */
const oppTag = (g: GoalieNight) => `${g.home ? '' : '@'}${g.opp}`;

/** Hover, tap or the arrow keys pick a column; the mouse leaving or Escape lets go. */
function useScrub(n: number) {
    const [at, setAt] = React.useState<number | null>(null);
    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
            e.preventDefault();
            const d = e.key === 'ArrowRight' ? 1 : -1;
            setAt(a => (a == null ? (d > 0 ? 0 : n - 1) : Math.max(0, Math.min(n - 1, a + d))));
        } else if (e.key === 'Home' || e.key === 'End') {
            e.preventDefault();
            setAt(e.key === 'Home' ? 0 : n - 1);
        } else if (e.key === 'Escape') setAt(null);
    };
    const chart = {
        tabIndex: 0,
        onKeyDown,
        onPointerLeave: (e: React.PointerEvent) => e.pointerType === 'mouse' && setAt(null),
        className: 'block rounded-control outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand',
    };
    return { at, setAt, chart };
}

/** Under the columns: the opponent under each one when there is room, and the month under its first game. Months that would run past `stop` drop out; of two that would touch, the one with more games stays. */
function ColumnAxis({ nights, cx, y, roomy, stop }: { nights: GoalieNight[]; cx: (i: number) => number; y: number; roomy: boolean; stop: number }) {
    const runs: { i: number; games: number }[] = [];
    nights.forEach((g, i) => {
        if (i && g.date.slice(5, 7) === nights[i - 1].date.slice(5, 7)) runs[runs.length - 1].games++;
        else runs.push({ i, games: 1 });
    });
    const kept: typeof runs = [];
    for (const r of runs) {
        if (cx(r.i) + (roomy ? 13 : 26) > stop) continue;
        const prev = kept[kept.length - 1];
        if (prev && cx(r.i) - cx(prev.i) < 34) {
            if (r.games > prev.games) kept[kept.length - 1] = r;
        } else kept.push(r);
    }
    const months = kept.map(r => r.i);
    return (
        <g aria-hidden="true" className="text-micro">
            {roomy
                ? nights.map((g, i) => (
                      <text key={g.game} x={cx(i)} y={y} textAnchor="middle" className="fill-fg-3">
                          {oppTag(g)}
                      </text>
                  ))
                : null}
            {months.map(i => (
                <text key={`m${i}`} x={cx(i)} y={roomy ? y + 14 : y} textAnchor={roomy ? 'middle' : 'start'} className={roomy ? 'fill-fg-2' : 'fill-fg-3'}>
                    {MONTHS[Number(nights[i].date.slice(5, 7)) - 1]}
                </text>
            ))}
        </g>
    );
}

/** The one authored moment: the GSAx staircase builds game by game (off under reduced motion). */
const CHART_CSS = `
@keyframes gw-rise { from { transform: scaleY(0); } }
@keyframes gw-fade { from { opacity: 0; } }
.gw-rise { transform-box: fill-box; animation: gw-rise 460ms cubic-bezier(0.16, 1, 0.3, 1) both; }
.gw-fade { animation: gw-fade 320ms ease-out both; }
@media (prefers-reduced-motion: reduce) { .gw-rise, .gw-fade { animation: none; } }
`;

/* ── Season: GSAx waterfall ──────────────────────────────────────────── */

function Race({ nights }: { nights: GoalieNight[] }) {
    const [ref, W] = useWidth<HTMLDivElement>();
    const n = nights.length;
    const { at, setAt, chart } = useScrub(n);
    // Each night from the running total before it to the one after.
    const steps = React.useMemo(() => {
        const out: { g: GoalieNight; i: number; from: number; c: number }[] = [];
        nights.forEach((g, i) => {
            const from = out[i - 1]?.c ?? 0;
            out.push({ g, i, from, c: from + g.ps });
        });
        return out;
    }, [nights]);
    if (!n) return null;
    const total = steps[n - 1].c;

    // One column per appearance, half a column of air, then the season total in a slot wide enough for its label.
    const P = { l: 36, r: 8, t: 8 };
    const plotW = Math.max(0, W - P.l - P.r);
    const seasonW = Math.max(60, plotW / (n + 1.5));
    const band = Math.max(0, plotW - seasonW) / (n + 0.5);
    const roomy = band >= ROOMY;
    const H = roomy ? 268 : 240;
    const base = H - (roomy ? 40 : 24);
    const cx = (i: number) => P.l + band * (i + 0.5);
    const seasonL = P.l + band * (n + 0.5);
    const tx = seasonL + seasonW / 2;
    const bw = Math.max(2, Math.min(28, band * 0.64));
    const tw = Math.max(bw, Math.min(28, seasonW * 0.4));
    // Values span lo..hi with room above and below for the figures.
    const lo = Math.min(0, ...steps.map(s => s.c));
    const hi = Math.max(0, ...steps.map(s => s.c));
    const span = Math.max(1, hi - lo);
    const padT = 20;
    const padB = 18;
    const Y = (v: number) => P.t + padT + ((hi - v) / span) * (base - P.t - padT - padB);
    const step = span > 24 ? 10 : span > 12 ? 5 : span > 4 ? 2 : 1;
    const ticks: number[] = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(v);
    const best = steps.reduce((a, b) => (b.g.ps > a.g.ps ? b : a));
    const worst = steps.reduce((a, b) => (b.g.ps < a.g.ps ? b : a));
    const sel = at != null ? steps[at] : null;
    const delay = (i: number) => `${Math.round(i * Math.min(45, 700 / n))}ms`;
    const bar = (from: number, to: number) => {
        const h = Math.max(1.5, Math.abs(Y(to) - Y(from)));
        return { y: to >= from ? Y(from) - h : Y(from), h };
    };
    const tb = bar(0, total);

    return (
        <Panel
            title="GSAx"
            legend={
                <>
                    <span className="inline-flex items-center gap-1.5"><Swatch className="h-2.5 w-2.5 rounded-[2px] bg-pos/70" />above expected</span>
                    <span className="inline-flex items-center gap-1.5"><Swatch className="h-2.5 w-2.5 rounded-[2px] bg-neg/70" />below</span>
                    <span className="inline-flex items-center gap-1.5"><Swatch className="h-2.5 w-2.5 rounded-[2px] bg-fg-1" />season</span>
                </>
            }
        >
            <p className="flex min-h-5 flex-wrap items-baseline gap-x-3 text-caption text-fg-2" aria-live="polite">
                {sel ? (
                    <>
                        <Link href={`/games/${sel.g.game}`} className="font-semibold text-fg-1 hover:text-brand">
                            {day(sel.g.date)} {sel.g.home ? 'vs' : '@'} {sel.g.opp}
                        </Link>
                        <span>{sel.g.sa - sel.g.ga}/{sel.g.sa} saves</span>
                        <span className="text-model">{sel.g.xga.toFixed(2)} xGA</span>
                        <span>night <b className={sel.g.ps >= 0 ? 'text-pos' : 'text-neg'}>{sg(sel.g.ps)}</b></span>
                        <span>season {sg(sel.from, 1)} → <b className="text-fg-1">{sg(sel.c, 1)}</b></span>
                    </>
                ) : (
                    <span>
                        <b className="text-fg-1">{sg(total, 1)}</b> goals saved above expected over {n} games
                    </span>
                )}
            </p>
            <div ref={ref} className="w-full">
                {W ? (
                    <svg
                        width={W}
                        height={H}
                        viewBox={`0 0 ${W} ${H}`}
                        role="group"
                        aria-label={`Goals saved above expected, game by game, to ${sg(total, 1)} over ${n} games. Arrow keys step through the games.`}
                        {...chart}
                    >
                        <style>{CHART_CSS}</style>
                        {ticks.map(v => (
                            <g key={v}>
                                <line x1={P.l} x2={W - P.r} y1={Y(v)} y2={Y(v)} className={v === 0 ? 'stroke-fg-disabled' : 'stroke-line'} />
                                <text x={P.l - 8} y={Y(v) + 4} textAnchor="end" className="fill-fg-3 text-micro">{v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0'}</text>
                            </g>
                        ))}
                        {sel ? <rect x={cx(sel.i) - band / 2} y={P.t} width={band} height={base - P.t} className="fill-surface-3" /> : null}

                        {/* The staircase: each night from the running total before it to the one after, a hairline carrying the level to the next. */}
                        {steps.map(s => {
                            const up = s.g.ps >= 0;
                            const b = bar(s.from, s.c);
                            const nx = s.i < n - 1 ? cx(s.i + 1) - bw / 2 : tx - tw / 2;
                            const dim = sel != null && sel.i !== s.i;
                            return (
                                <g key={s.g.game}>
                                    <line x1={cx(s.i) + bw / 2} x2={nx} y1={Y(s.c)} y2={Y(s.c)} className="gw-fade stroke-fg-3" strokeOpacity={0.55} style={{ animationDelay: delay(s.i + 1) }} />
                                    <g className="transition-opacity duration-200" style={{ opacity: dim ? 0.35 : 1 }}>
                                        <rect
                                            x={cx(s.i) - bw / 2}
                                            y={b.y}
                                            width={bw}
                                            height={b.h}
                                            rx={Math.min(2, bw / 4)}
                                            className={cn('gw-rise', up ? 'fill-pos/70' : 'fill-neg/70')}
                                            style={{ transformOrigin: up ? 'center bottom' : 'center top', animationDelay: delay(s.i) }}
                                        />
                                        {roomy ? (
                                            <text x={cx(s.i)} y={up ? b.y - 5 : b.y + b.h + 12} textAnchor="middle" className={cn('gw-fade text-micro', up ? 'fill-pos' : 'fill-neg')} style={{ animationDelay: delay(s.i) }}>
                                                {sg(s.g.ps)}
                                            </text>
                                        ) : null}
                                    </g>
                                </g>
                            );
                        })}

                        {/* The season: one bar from zero to where the staircase ends. */}
                        <g className="transition-opacity duration-200" style={{ opacity: sel ? 0.35 : 1 }}>
                            <rect x={tx - tw / 2} y={tb.y} width={tw} height={tb.h} rx={2} className="gw-rise fill-fg-1" style={{ transformOrigin: total >= 0 ? 'center bottom' : 'center top', animationDelay: delay(n) }} />
                            <text x={tx} y={total >= 0 ? tb.y - 6 : tb.y + tb.h + 13} textAnchor="middle" className="gw-fade fill-fg-1 text-caption font-bold" style={{ animationDelay: delay(n) }}>
                                {sg(total, 1)}
                            </text>
                        </g>
                        <text x={tx} y={base + 14} textAnchor="middle" className="fill-fg-2 text-micro font-semibold uppercase tracking-[0.12em]" aria-hidden="true">
                            Season
                        </text>

                        {/* Narrow charts name only the best and worst nights. */}
                        {!roomy && n > 2
                            ? ([[best, 'best'], [worst, 'worst']] as const).map(([s, k]) => {
                                  const b = bar(s.from, s.c);
                                  return (
                                      <text
                                          key={k}
                                          x={Math.min(Math.max(cx(s.i), P.l + 64), seasonL - 64)}
                                          y={k === 'best' ? b.y - 7 : b.y + b.h + 14}
                                          textAnchor="middle"
                                          paintOrder="stroke"
                                          stroke="var(--surface-1)"
                                          strokeWidth={4}
                                          strokeLinejoin="round"
                                          className={cn('gw-fade text-micro font-semibold uppercase tracking-[0.08em]', k === 'best' ? 'fill-pos' : 'fill-neg')}
                                          style={{ animationDelay: delay(n) }}
                                      >
                                          {k} {sg(s.g.ps)} {oppTag(s.g)}
                                      </text>
                                  );
                              })
                            : null}

                        <ColumnAxis nights={nights} cx={cx} y={base + 14} roomy={roomy} stop={seasonL} />

                        {/* Hit areas: a column per game; the season column lets go. */}
                        {steps.map(s => (
                            <rect key={s.g.game} x={cx(s.i) - band / 2} y={0} width={band} height={H} fill="transparent" onPointerEnter={() => setAt(s.i)} onPointerDown={() => setAt(s.i)} />
                        ))}
                        <rect x={seasonL} y={0} width={W - seasonL} height={H} fill="transparent" onPointerEnter={() => setAt(null)} onPointerDown={() => setAt(null)} />
                    </svg>
                ) : (
                    <div style={{ height: 268 }} />
                )}
            </div>
        </Panel>
    );
}

/* ── Danger ladder ───────────────────────────────────────────────────── */

const DANGER = ['Low', 'Medium', 'High'];
const SPAN = [0.03, 0.08, 0.2];

function Ladder({ shots, league }: { shots: ShotRow[]; league: ShotLeague }) {
    const sog = shots.filter(s => s[S.onGoal]);
    const rows = league.bins.map((b, i) => {
        const mine = sog.filter(s => s[S.xg] >= b.lo && (i === league.bins.length - 1 || s[S.xg] < b.hi));
        const n = mine.length;
        const g = sum(mine, s => s[S.goal]);
        const sv = n ? 1 - g / n : NaN;
        const exp = b.svPct ?? NaN;
        return { name: DANGER[i], range: i === 0 ? `xG < ${b.hi}` : i === 2 ? `xG ≥ ${b.lo}` : `${b.lo}–${b.hi}`, n, sv, exp, saved: (1 - exp) * n - g };
    });
    return (
        <div className="flex flex-col gap-4 py-1">
            {rows.map((r, i) => {
                const pos = (v: number) => Math.max(2, Math.min(98, 50 + ((v - r.exp) / SPAN[i]) * 50));
                const up = r.sv >= r.exp;
                const p = pos(r.sv);
                return (
                    <div key={r.name} className="grid grid-cols-[96px_1fr_72px] items-center gap-3" title={`${p3(r.sv)} on ${fmtInt(r.n)} shots; league ${p3(r.exp)}`}>
                        <div>
                            <p className="text-caption font-bold uppercase tracking-[0.08em] text-fg-1">{r.name}</p>
                            <p className="text-micro text-fg-3">{r.range} · {fmtInt(r.n)}</p>
                        </div>
                        <div className="relative h-7 rounded-chip bg-surface-2">
                            {r.n ? (
                                <>
                                    <span className={cn('absolute top-2 h-3 rounded-[3px]', up ? 'bg-pos/55' : 'bg-neg/55')} style={up ? { left: '50%', width: `${p - 50}%` } : { left: `${p}%`, width: `${50 - p}%` }} />
                                    <span className="absolute left-1/2 top-0.5 -ml-px h-6 w-0.5 rounded-[1px] bg-model" />
                                    <span className="absolute top-1 -ml-1.5 h-5 w-3 rounded-[3px] border-2 border-fg-1 bg-bg" style={{ left: `${p}%` }} />
                                </>
                            ) : null}
                        </div>
                        <div className="text-right tabular-nums">
                            <p className="text-title font-bold text-fg-1">{p3(r.sv)}</p>
                            <p className={cn('text-micro', r.saved >= 0 ? 'text-pos' : 'text-neg')}>{r.n ? `${sg(r.saved, 1)} goals` : '—'}</p>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

/* ── Save map ────────────────────────────────────────────────────────── */

const NO_SHOTS: ShotRow[] = [];

function SaveMap({ file, ready, self }: { file: ShotFile | null; ready: boolean; self: ShotPerson }) {
    const shots = file?.shots ?? NO_SHOTS;
    const [mode, setMode] = React.useState<'shots' | 'zones'>('shots');
    const [sit, setSit] = React.useState<'all' | '0' | '1'>('all');
    const set = React.useMemo(() => shots.filter(s => s[S.x] >= 25 && (sit === 'all' || String(s[S.strength]) === sit)), [shots, sit]);
    // The map leaves misses out (a goalie's record is the shots on goal), so the pick works on what is drawn.
    const drawn = React.useMemo(() => set.filter(s => s[S.onGoal]), [set]);
    const pick = useShotPick(drawn);
    const saves = set.filter(s => s[S.onGoal] && !s[S.goal]).length;
    const goals = set.filter(s => s[S.goal]).length;
    const xga = drawn.reduce((a, s) => a + s[S.xg], 0);
    return (
        <Panel
            title="Save map"
            actions={
                <div className="flex flex-wrap gap-2">
                    <Segmented label="Map" size="sm" value={mode} onChange={setMode} options={[{ value: 'shots', label: 'Shots' }, { value: 'zones', label: 'Zones' }]} />
                    <Segmented label="Situation" size="sm" value={sit} onChange={setSit} options={[{ value: 'all', label: 'All' }, { value: '0', label: 'Even' }, { value: '1', label: 'Short' }]} />
                </div>
            }
            legend={
                mode === 'shots' ? (
                    <>
                        <span className="inline-flex items-center gap-1.5"><Swatch className="h-2 w-3 rounded-full border border-fg-2/40 bg-fg-2/15" />save ({fmtInt(saves)})</span>
                        <span className="inline-flex items-center gap-1.5"><Swatch className="h-3 w-0.5 rounded-full bg-neg" />goal against ({fmtInt(goals)}), taller = higher xG</span>
                    </>
                ) : (
                    <>
                        <span className="inline-flex items-center gap-1.5"><Swatch className="h-2.5 w-2.5 bg-pos/60" />saved more than expected</span>
                        <span className="inline-flex items-center gap-1.5"><Swatch className="h-2.5 w-2.5 bg-neg/60" />allowed more</span>
                        <span>areas with 6+ shots</span>
                    </>
                )
            }
        >
            {ready ? (
                shots.length ? (
                    <ShotMapFrame
                        map={
                            <Rink3D
                                shots={drawn}
                                mode={mode}
                                tone="neg"
                                showMisses={false}
                                maxWidth={1100}
                                label={`Shots faced: ${fmtInt(saves)} saves, ${fmtInt(goals)} goals against`}
                                lit={mode === 'shots' ? pick.lit : null}
                                onHover={mode === 'shots' ? pick.onHover : undefined}
                                onTap={mode === 'shots' ? pick.onTap : undefined}
                            />
                        }
                        detail={
                            <ShotDetail
                                info={file && pick.picked ? fileShotInfo(file, pick.picked, 'goalie', self) : null}
                                accent="var(--neg)"
                                summary={
                                    <ShotSummary
                                        rows={[
                                            ['Shots faced', fmtInt(drawn.length)],
                                            ['Saves', fmtInt(saves)],
                                            ['Goals against', goals],
                                            ['Save %', drawn.length ? (saves / drawn.length).toFixed(3).replace(/^0/, '') : '—'],
                                            ['xG against', <span key="xga" className="text-model">{xga.toFixed(1)}</span>],
                                        ]}
                                    />
                                }
                            />
                        }
                    />
                ) : (
                    <Pending ready />
                )
            ) : (
                <div className="aspect-[16/9] w-full" />
            )}
        </Panel>
    );
}

/* ── Shot types ──────────────────────────────────────────────────────── */

function ShotTypes({ shots, league }: { shots: ShotRow[]; league: ShotLeague }) {
    const sog = shots.filter(s => s[S.onGoal]);
    const rows = league.typeNames
        .map((name, i) => ({ name, m: sog.filter(s => s[S.type] === i) }))
        .filter(r => r.name !== 'other' && r.m.length >= 10 && league.types[r.name])
        .map(r => ({ name: r.name, n: r.m.length, sv: 1 - sum(r.m, s => s[S.goal]) / r.m.length, lg: league.types[r.name].svPct, sep: false }));
    const reb = sog.filter(s => s[S.rebound]);
    if (reb.length >= 10 && league.types.rebound) rows.push({ name: 'rebound', n: reb.length, sv: 1 - sum(reb, s => s[S.goal]) / reb.length, lg: league.types.rebound.svPct, sep: true });
    if (!rows.length) return <p className="text-caption text-fg-3">Not enough shots yet.</p>;
    const withCi = rows.map(r => ({ ...r, ci: wilson(r.sv, r.n), vs: (r.sv - r.lg) * r.n })).sort((a, b) => Number(a.sep) - Number(b.sep) || b.n - a.n);
    const lo = Math.max(0.7, Math.floor(Math.min(...withCi.map(r => Math.min(r.ci[0], r.lg))) * 50) / 50);
    const hi = Math.min(1, Math.ceil(Math.max(...withCi.map(r => Math.max(r.ci[1], r.lg))) * 50) / 50);
    const X = (v: number) => `${(((v - lo) / (hi - lo)) * 100).toFixed(2)}%`;
    const step = hi - lo > 0.14 ? 0.05 : 0.02;
    const ticks: number[] = [];
    for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) ticks.push(Number(v.toFixed(3)));
    const maxN = Math.max(...withCi.map(r => r.n));
    const cols = 'grid grid-cols-[minmax(84px,120px)_1fr_48px] items-center gap-3';
    return (
        <div className="flex flex-col">
            <div className={cn(cols, 'h-5')}>
                <span />
                <span className="relative h-4">
                    {ticks.map(v => (
                        <span key={v} className="absolute -translate-x-1/2 text-micro text-fg-3" style={{ left: X(v) }}>{p3(v)}</span>
                    ))}
                </span>
                <span className="text-right text-micro text-fg-3">vs lg</span>
            </div>
            {withCi.map(r => {
                const up = r.sv >= r.lg;
                const a = X(Math.min(r.sv, r.lg));
                const b = X(Math.max(r.sv, r.lg));
                return (
                    <div key={r.name} className={cn(cols, 'h-9', r.sep && 'mt-1 border-t border-dashed border-line-strong pt-1')} title={`${fmtInt(r.n)} shots · ${p3(r.sv)} vs league ${p3(r.lg)} · likely ${p3(r.ci[0])}–${p3(r.ci[1])}`}>
                        <span className="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1">
                            <span className="text-caption font-medium capitalize text-fg-1">{r.name.replace('-', ' ')}</span>
                            <span className="row-span-2 text-micro text-fg-3 tabular-nums">{fmtInt(r.n)}</span>
                            <span className="block h-1 overflow-hidden rounded-[2px] bg-line"><span className="block h-full bg-line-strong" style={{ width: `${(r.n / maxN) * 100}%` }} /></span>
                        </span>
                        <span className="relative h-9">
                            {ticks.map(v => (
                                <span key={v} className="absolute inset-y-1.5 w-px bg-line" style={{ left: X(v) }} />
                            ))}
                            <span className="absolute top-[15px] h-1 rounded-[2px] bg-fg-2/30" style={{ left: X(r.ci[0]), width: `calc(${X(r.ci[1])} - ${X(r.ci[0])})` }} />
                            <span className={cn('absolute top-4 h-0.5', up ? 'bg-pos' : 'bg-neg')} style={{ left: a, width: `calc(${b} - ${a})` }} />
                            <span className="absolute top-2 -ml-px h-[18px] w-0.5 rounded-[1px] bg-model" style={{ left: X(r.lg) }} />
                            <span className="absolute top-3 -ml-[5px] h-2.5 w-2.5 rounded-full bg-fg-1 shadow-[0_0_0_2px_var(--surface-1)]" style={{ left: X(r.sv) }} />
                            <span className="absolute -top-0.5 -translate-x-1/2 text-micro text-fg-2 tabular-nums" style={{ left: X(r.sv) }}>{p3(r.sv)}</span>
                        </span>
                        <span className={cn('text-right text-caption font-semibold tabular-nums', r.vs >= 0 ? 'text-pos' : 'text-neg')}>{sg(r.vs, 1)}</span>
                    </div>
                );
            })}
        </div>
    );
}

/* ── Situations ──────────────────────────────────────────────────────── */

function Situations({ shots }: { shots: ShotRow[] }) {
    const sit = ([[0, 'Even strength'], [1, 'Shorthanded'], [2, 'Power play']] as const).map(([k, name]) => {
        const m = shots.filter(s => s[S.strength] === k);
        return { name, n: m.length, d: sum(m, s => s[S.xg]) - sum(m, s => s[S.goal]) };
    });
    const tot = sum(sit, s => s.n) || 1;
    return (
        <div className="flex flex-col gap-3">
            <div className="flex h-3.5 gap-[3px]" aria-hidden="true">
                {sit.map(s => (
                    <span
                        key={s.name}
                        className="block rounded-[3px]"
                        style={{ flex: `${Math.max(s.n / tot, 0.03)} 1 0`, background: `rgb(var(${s.d >= 0 ? '--pos-rgb' : '--neg-rgb'}) / ${Math.min(0.8, 0.2 + (Math.abs(s.d) / 4) * 0.6).toFixed(2)})` }}
                    />
                ))}
            </div>
            <div className="grid grid-cols-3 gap-3">
                {sit.map(s => (
                    <div key={s.name} className="min-w-0 border-l border-line-strong pl-2">
                        <p className="text-micro uppercase tracking-label text-fg-3">{s.name}</p>
                        <p className={cn('font-display text-h2 font-bold leading-tight tabular-nums', s.d >= 0 ? 'text-pos' : 'text-neg')}>{sg(s.d, 1)}</p>
                        <p className="text-micro text-fg-3">
                            {Math.round((s.n / tot) * 100)}% of shots{s.n ? ` · ${sg((s.d / s.n) * 100, 2)} per 100` : ''}
                        </p>
                    </div>
                ))}
            </div>
        </div>
    );
}

/* ── Workload ────────────────────────────────────────────────────────── */

/** Starts are 30+ minutes. A quality start (Vollman) saves .903, or .885 on 20 shots or fewer; a really bad start is under .850. */
const svOf = (g: GoalieNight) => (g.sa - g.ga) / Math.max(g.sa, 1);
const isStart = (g: GoalieNight) => g.toi >= 1800;
const isQs = (g: GoalieNight) => isStart(g) && (svOf(g) >= 0.903 || (g.sa <= 20 && svOf(g) >= 0.885));
const isRbs = (g: GoalieNight) => isStart(g) && svOf(g) < 0.85;

function Workload({ nights }: { nights: GoalieNight[] }) {
    const [ref, W] = useWidth<HTMLDivElement>();
    const n = nights.length;
    const { at, setAt, chart } = useScrub(n);
    if (!n) return null;

    // One column per appearance, in order: shots faced, saves below and goals against on top.
    const P = { l: 28, r: 6, t: 20 };
    const band = Math.max(0, W - P.l - P.r) / n;
    const roomy = band >= ROOMY;
    const H = roomy ? 206 : 180;
    const base = H - (roomy ? 54 : 40);
    const top = Math.max(20, Math.ceil(Math.max(...nights.map(g => g.sa)) / 10) * 10);
    const Y = (v: number) => base - (v / top) * (base - P.t);
    const cx = (i: number) => P.l + band * (i + 0.5);
    const bw = Math.max(2, Math.min(24, band * 0.58));
    const grid = top > 40 ? 20 : 10;
    const ticks: number[] = [];
    for (let v = grid; v <= top; v += grid) ticks.push(v);
    const b2b = (i: number) => i > 0 && (Date.parse(nights[i].date) - Date.parse(nights[i - 1].date)) / 864e5 === 1;
    const backToBacks = nights.filter((_, i) => b2b(i)).length;
    const starts = nights.filter(isStart).length;
    const qs = nights.filter(isQs).length;
    const rbs = nights.filter(isRbs).length;
    const sel = at != null ? nights[at] : null;
    const markY = base + 13;

    return (
        <Panel
            title="Workload"
            legend={
                <>
                    <span className="inline-flex items-center gap-1.5"><Swatch className="h-3 w-2 rounded-[1px] bg-info/45" />saves</span>
                    <span className="inline-flex items-center gap-1.5"><Swatch className="h-3 w-2 rounded-[1px] bg-neg/85" />goals against</span>
                    {backToBacks ? <span className="inline-flex items-center gap-1.5"><Swatch className="h-0.5 w-4 rounded-full bg-warn" />back-to-back ({backToBacks})</span> : null}
                    <span className="ml-auto inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-fg-1">
                        <span className="inline-flex items-center gap-1.5">
                            <Swatch className="h-2 w-2 rounded-full bg-pos" />
                            Quality starts <b>{qs}/{starts}</b>
                            {starts ? ` (${Math.round((qs / starts) * 100)}%)` : ''}
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                            <Swatch className="h-2 w-2 rounded-full bg-neg" />
                            Really bad starts <b className="text-neg">{rbs}</b>
                        </span>
                    </span>
                </>
            }
        >
            <p className="flex min-h-5 flex-wrap items-baseline gap-x-3 text-caption text-fg-2" aria-live="polite">
                {sel ? (
                    <>
                        <Link href={`/games/${sel.game}`} className="font-semibold text-fg-1 hover:text-brand">
                            {day(sel.date)} {sel.home ? 'vs' : '@'} {sel.opp}
                        </Link>
                        <span>{sel.sa - sel.ga}/{sel.sa} saves</span>
                        <span>{p3(sel.sa ? svOf(sel) : NaN)}</span>
                        <span className="text-model">{sel.xga.toFixed(2)} xGA</span>
                        {isQs(sel) ? <span className="text-pos">quality start</span> : isRbs(sel) ? <span className="text-neg">really bad start</span> : !isStart(sel) ? <span>relief</span> : null}
                        {b2b(at!) ? <span className="text-warn">back-to-back</span> : null}
                    </>
                ) : (
                    <span>
                        {n} appearances · {Math.round(sum(nights, g => g.sa) / n)} shots a game
                    </span>
                )}
            </p>
            <div ref={ref} className="w-full">
                {W ? (
                    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`${n} appearances, shots faced and goals against each game. Arrow keys step through the games.`} {...chart}>
                        {ticks.map(v => (
                            <g key={v}>
                                <line x1={P.l} x2={W - P.r} y1={Y(v)} y2={Y(v)} className="stroke-line" />
                                <text x={P.l - 6} y={Y(v) + 4} textAnchor="end" className="fill-fg-3 text-micro">{v}</text>
                            </g>
                        ))}
                        <line x1={P.l} x2={W - P.r} y1={base} y2={base} className="stroke-line-strong" />
                        {sel ? <rect x={cx(at!) - band / 2} y={P.t - 16} width={band} height={markY + 8 - (P.t - 16)} className="fill-surface-3" /> : null}

                        {nights.map((g, i) => {
                            const x = cx(i) - bw / 2;
                            const saved = g.sa - g.ga;
                            const gap = g.ga && saved && bw >= 4 ? 1 : 0;
                            return (
                                <g key={g.game} className="transition-opacity duration-200" style={{ opacity: sel && at !== i ? 0.35 : 1 }}>
                                    {saved ? <rect x={x} y={Y(saved) + gap} width={bw} height={Math.max(0, Y(0) - Y(saved) - gap)} className="fill-info/45" /> : null}
                                    {g.ga ? <rect x={x} y={Y(g.sa)} width={bw} height={Y(saved) - Y(g.sa)} rx={Math.min(1.5, bw / 4)} className="fill-neg/85" /> : null}
                                    {roomy ? (
                                        <text x={cx(i)} y={Y(g.sa) - 5} textAnchor="middle" className="fill-fg-3 text-micro">
                                            {g.sa}
                                        </text>
                                    ) : null}
                                    {isQs(g) || isRbs(g) ? (
                                        <circle cx={cx(i)} cy={markY} r={3.5} className={isQs(g) ? 'fill-pos' : 'fill-neg'} />
                                    ) : isStart(g) ? (
                                        <circle cx={cx(i)} cy={markY} r={3} fill="none" className="stroke-mute" strokeWidth={1.5} />
                                    ) : null}
                                </g>
                            );
                        })}
                        {/* Back-to-backs: an amber link joining the two nights. */}
                        {nights.map((g, i) => (b2b(i) ? <line key={`b${g.game}`} x1={cx(i - 1)} x2={cx(i)} y1={base + 4} y2={base + 4} className="stroke-warn" strokeWidth={2} strokeLinecap="round" /> : null))}

                        <ColumnAxis nights={nights} cx={cx} y={base + 32} roomy={roomy} stop={W - P.r} />

                        {nights.map((g, i) => (
                            <rect key={`h${g.game}`} x={cx(i) - band / 2} y={0} width={band} height={H} fill="transparent" onPointerEnter={() => setAt(i)} onPointerDown={() => setAt(i)} />
                        ))}
                    </svg>
                ) : (
                    <div style={{ height: 206 }} />
                )}
            </div>
        </Panel>
    );
}
