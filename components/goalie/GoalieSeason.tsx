'use client';

import * as React from 'react';
import Link from 'next/link';
import { Rink3D } from '@/components/rink/Rink3D';
import { ShotDetail, ShotMapFrame, ShotSummary, fileShotInfo, useShotPick } from '@/components/rink/ShotDetail';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/utils';
import { S, fetchShots, goalieShotsUrl, shotLeagueUrl, wilson, type ShotFile, type ShotLeague, type ShotRow } from '@/lib/shots';

/**
 * A goalie's season in pictures, between the hero and the game log:
 *  GSAx     running goals saved above expected, game by game
 *  Danger   save % on low / medium / high-danger shots against the league
 *  Save map every shot he faced on a tilted rink (or GSAx by area)
 *  Types    save % per shot type against the league, with the sample's likely range
 *  Situations GSAx by strength, sized by the share of shots faced there
 *  Workload every appearance: shots faced, green / red for beating expected
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

export function GoalieSeason({ nights, season, id, name }: { nights: GoalieNight[]; season: string; id: number; name: string }) {
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
            <SaveMap file={file ?? null} ready={ready} />
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

/* ── Season: running GSAx ─────────────────────────────────────────────── */

function Race({ nights }: { nights: GoalieNight[] }) {
    const [ref, W] = useWidth<HTMLDivElement>();
    const [at, setAt] = React.useState<number | null>(null);
    const id = React.useId().replace(/:/g, '');
    const H = 230;
    const P = { l: 36, r: 12, t: 22, b: 24 };
    const pts = React.useMemo(() => {
        const out: { g: GoalieNight; i: number; c: number }[] = [];
        nights.forEach((g, i) => out.push({ g, i, c: (out[i - 1]?.c ?? 0) + g.ps }));
        return out;
    }, [nights]);
    const n = pts.length;
    if (!n) return null;
    const lo = Math.min(0, ...pts.map(p => p.c)) - 1;
    const hi = Math.max(0, ...pts.map(p => p.c)) + 1;
    const X = (i: number) => P.l + (n > 1 ? i / (n - 1) : 0.5) * (W - P.l - P.r);
    const Y = (v: number) => P.t + ((hi - v) / (hi - lo)) * (H - P.t - P.b);
    const line = pts.map(p => `${X(p.i).toFixed(1)},${Y(p.c).toFixed(1)}`).join(' ');
    const area = `${X(0)},${Y(0)} ${line} ${X(n - 1)},${Y(0)}`;
    const step = hi - lo > 24 ? 10 : 5;
    const ticks: number[] = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
    const months: { i: number; m: string }[] = [];
    pts.forEach(p => {
        const m = MONTHS[Number(p.g.date.slice(5, 7)) - 1];
        if (!months.length || months[months.length - 1].m !== m) months.push({ i: p.i, m });
    });
    const best = pts.reduce((a, b) => (b.g.ps > a.g.ps ? b : a));
    const worst = pts.reduce((a, b) => (b.g.ps < a.g.ps ? b : a));
    const last = pts[n - 1];
    const sel = at != null ? pts[at] : null;
    const move = (clientX: number, el: SVGRectElement) => {
        const r = el.getBoundingClientRect();
        setAt(Math.max(0, Math.min(n - 1, Math.round(((clientX - r.left) / r.width) * (n - 1)))));
    };
    return (
        <Panel
            title="GSAx"
            legend={
                <>
                    <span className="inline-flex items-center gap-1.5"><Swatch className="w-4 border-t-2 border-fg-1" />running GSAx</span>
                    <span className="inline-flex items-center gap-1.5"><Swatch className="h-2.5 w-2.5 rounded-[2px] bg-pos/25" />above expected</span>
                    <span className="inline-flex items-center gap-1.5"><Swatch className="h-2.5 w-2.5 rounded-[2px] bg-neg/25" />below</span>
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
                        <span>season <b className="text-fg-1">{sg(sel.c, 1)}</b></span>
                    </>
                ) : (
                    <>
                        <span>
                            <b className="text-fg-1">{sg(last.c, 1)}</b> goals saved above expected over {n} games
                        </span>
                    </>
                )}
            </p>
            <div ref={ref} className="w-full">
                {W ? (
                    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Running goals saved above expected over ${n} games: ${sg(last.c, 1)}`} className="block">
                        <defs>
                            <clipPath id={`up${id}`}><rect x={0} y={0} width={W} height={Y(0)} /></clipPath>
                            <clipPath id={`dn${id}`}><rect x={0} y={Y(0)} width={W} height={H} /></clipPath>
                        </defs>
                        {ticks.map(v => (
                            <g key={v}>
                                <line x1={P.l} x2={W - P.r} y1={Y(v)} y2={Y(v)} className={v === 0 ? 'stroke-fg-disabled' : 'stroke-line'} />
                                <text x={P.l - 8} y={Y(v) + 4} textAnchor="end" className="fill-fg-3 text-micro">{v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0'}</text>
                            </g>
                        ))}
                        {months.map(m => (
                            <text key={m.m + m.i} x={X(m.i)} y={H - 6} className="fill-fg-3 text-micro">{m.m}</text>
                        ))}
                        <polygon points={area} className="fill-pos/20" clipPath={`url(#up${id})`} />
                        <polygon points={area} className="fill-neg/20" clipPath={`url(#dn${id})`} />
                        <polyline points={line} fill="none" className="stroke-fg-1" strokeWidth={2} strokeLinejoin="round" />
                        {n > 2
                            ? ([[best, 'best'], [worst, 'worst']] as const).map(([p, k]) => (
                                  <g key={k}>
                                      <circle cx={X(p.i)} cy={Y(p.c)} r={4.5} className={k === 'best' ? 'fill-pos' : 'fill-neg'} />
                                      <text x={Math.min(Math.max(X(p.i), 70), W - 70)} y={Y(p.c) + (k === 'best' ? -10 : 18)} textAnchor="middle" className={cn('text-micro font-semibold uppercase tracking-[0.08em]', k === 'best' ? 'fill-pos' : 'fill-neg')}>
                                          {k} {sg(p.g.ps)} {p.g.home ? 'vs' : '@'} {p.g.opp}
                                      </text>
                                  </g>
                              ))
                            : null}
                        {sel ? (
                            <>
                                <line x1={X(sel.i)} x2={X(sel.i)} y1={P.t} y2={H - P.b} className="stroke-fg-1" strokeOpacity={0.4} />
                                <circle cx={X(sel.i)} cy={Y(sel.c)} r={4} className="fill-brand" />
                            </>
                        ) : null}
                        <rect
                            x={P.l}
                            y={0}
                            width={Math.max(0, W - P.l - P.r)}
                            height={H}
                            fill="transparent"
                            onPointerMove={e => move(e.clientX, e.currentTarget)}
                            onPointerDown={e => move(e.clientX, e.currentTarget)}
                            onPointerLeave={e => e.pointerType === 'mouse' && setAt(null)}
                        />
                    </svg>
                ) : (
                    <div style={{ height: H }} />
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
                    <div key={r.name} className="grid grid-cols-[96px_1fr_72px] items-center gap-3" title={`${p3(r.sv)} on ${r.n} shots; league ${p3(r.exp)}`}>
                        <div>
                            <p className="text-caption font-bold uppercase tracking-[0.08em] text-fg-1">{r.name}</p>
                            <p className="text-micro text-fg-3">{r.range} · {r.n}</p>
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

function SaveMap({ file, ready }: { file: ShotFile | null; ready: boolean }) {
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
                        <span className="inline-flex items-center gap-1.5"><Swatch className="h-2 w-3 rounded-full border border-fg-2/40 bg-fg-2/15" />save ({saves})</span>
                        <span className="inline-flex items-center gap-1.5"><Swatch className="h-3 w-0.5 rounded-full bg-neg" />goal against ({goals}), taller = higher xG</span>
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
                                label={`Shots faced: ${saves} saves, ${goals} goals against`}
                                lit={mode === 'shots' ? pick.lit : null}
                                onHover={mode === 'shots' ? pick.onHover : undefined}
                                onTap={mode === 'shots' ? pick.onTap : undefined}
                            />
                        }
                        detail={
                            <ShotDetail
                                info={file && pick.picked ? fileShotInfo(file, pick.picked, 'goalie') : null}
                                accent="var(--neg)"
                                summary={
                                    <ShotSummary
                                        rows={[
                                            ['Shots faced', drawn.length],
                                            ['Saves', saves],
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
                    <div key={r.name} className={cn(cols, 'h-9', r.sep && 'mt-1 border-t border-dashed border-line-strong pt-1')} title={`${r.n} shots · ${p3(r.sv)} vs league ${p3(r.lg)} · likely ${p3(r.ci[0])}–${p3(r.ci[1])}`}>
                        <span className="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1">
                            <span className="text-caption font-medium capitalize text-fg-1">{r.name.replace('-', ' ')}</span>
                            <span className="row-span-2 text-micro text-fg-3 tabular-nums">{r.n}</span>
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

function Workload({ nights }: { nights: GoalieNight[] }) {
    const [ref, W] = useWidth<HTMLDivElement>();
    const [at, setAt] = React.useState<number | null>(null);
    if (!nights.length) return null;
    const H = 140;
    const P = { l: 28, r: 6, t: 20, b: 22 };
    const t0 = Date.parse(`${nights[0].date}T12:00:00Z`);
    const days = Math.max(1, (Date.parse(`${nights[nights.length - 1].date}T12:00:00Z`) - t0) / 864e5 + 1);
    const X = (d: string) => P.l + ((Date.parse(`${d}T12:00:00Z`) - t0) / 864e5 / days) * (W - P.l - P.r);
    const bw = Math.max(3, Math.min(10, ((W - P.l - P.r) / days) * 0.8));
    const maxSa = Math.max(20, ...nights.map(g => g.sa));
    const Y = (v: number) => H - P.b - (v / maxSa) * (H - P.t - P.b);
    const gap = (i: number) => (i ? (Date.parse(nights[i].date) - Date.parse(nights[i - 1].date)) / 864e5 : 99);
    const starts = nights.filter(g => g.toi >= 1800);
    const sv = (g: GoalieNight) => (g.sa - g.ga) / Math.max(g.sa, 1);
    const qs = starts.filter(g => sv(g) >= 0.903 || (g.sa <= 20 && sv(g) >= 0.885)).length;
    const rbs = starts.filter(g => sv(g) < 0.85).length;
    const b2b = nights.filter((_, i) => gap(i) === 1).length;
    const months: { d: string; m: string }[] = [];
    nights.forEach(g => {
        const m = MONTHS[Number(g.date.slice(5, 7)) - 1];
        if (!months.length || months[months.length - 1].m !== m) months.push({ d: g.date, m });
    });
    const sel = at != null ? nights[at] : null;
    return (
        <Panel
            title="Workload"
            legend={
                <>
                    <span className="inline-flex items-center gap-1.5"><Swatch className="h-3 w-2 rounded-[1px] bg-pos/70" />beat expected</span>
                    <span className="inline-flex items-center gap-1.5"><Swatch className="h-3 w-2 rounded-[1px] bg-neg/70" />below</span>
                    <span className="inline-flex items-center gap-1.5"><Swatch className="h-2 w-2 rounded-full bg-warn" />back-to-back ({b2b})</span>
                    <span className="ml-auto text-fg-1">
                        Quality starts <b>{qs}/{starts.length}</b>
                        {starts.length ? ` (${Math.round((qs / starts.length) * 100)}%)` : ''} · Really bad starts <b className="text-neg">{rbs}</b>
                    </span>
                </>
            }
        >
            <p className="min-h-5 text-caption text-fg-2" aria-live="polite">
                {sel ? (
                    <>
                        <b className="text-fg-1">{day(sel.date)} {sel.home ? 'vs' : '@'} {sel.opp}</b> · {sel.sa - sel.ga}/{sel.sa} saves · <span className={sel.ps >= 0 ? 'text-pos' : 'text-neg'}>{sg(sel.ps)}</span>
                    </>
                ) : (
                    <>{nights.length} appearances · {Math.round(sum(nights, g => g.sa) / nights.length)} shots a game</>
                )}
            </p>
            <div ref={ref} className="w-full">
                {W ? (
                    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${nights.length} appearances, shots faced each game`} className="block" onPointerLeave={e => e.pointerType === 'mouse' && setAt(null)}>
                        {[20, 40].filter(v => v <= maxSa).map(v => (
                            <g key={v}>
                                <line x1={P.l} x2={W - P.r} y1={Y(v)} y2={Y(v)} className="stroke-line" />
                                <text x={P.l - 6} y={Y(v) + 4} textAnchor="end" className="fill-fg-3 text-micro">{v}</text>
                            </g>
                        ))}
                        {months.map(m => (
                            <text key={m.d} x={X(m.d)} y={H - 6} className="fill-fg-3 text-micro">{m.m}</text>
                        ))}
                        {nights.map((g, i) => (
                            <g key={g.game} onPointerEnter={() => setAt(i)} onPointerDown={() => setAt(i)}>
                                <rect x={X(g.date) - bw / 2 - 1} y={P.t} width={bw + 2} height={H - P.t - P.b} fill="transparent" />
                                <rect x={X(g.date) - bw / 2} y={Y(g.sa)} width={bw} height={Y(0) - Y(g.sa)} rx={1} className={cn(g.ps >= 0 ? 'fill-pos/70' : 'fill-neg/70', at === i && 'fill-brand')} />
                                {gap(i) === 1 ? <circle cx={X(g.date)} cy={P.t - 9} r={3} className="fill-warn" /> : null}
                            </g>
                        ))}
                    </svg>
                ) : (
                    <div style={{ height: H }} />
                )}
            </div>
        </Panel>
    );
}
