'use client';

import * as React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { RinkMarkings } from '@/components/game/Rink';
import { useWidth } from '@/components/game/Pulse';
import { clockOf, gameScores, goalieRows, goalSwings, isUnblocked, lineScore, nameLabels, periodLabel, powerPlays, race, skaterRows, teamTotals, type PonyConstants } from '@/lib/game/analytics';
import { svPct } from '@/lib/game/build';
import { gamePack } from '@/lib/game/pack';
import { other, type GameModel, type Side } from '@/lib/game/types';
import PONY_JSON from '@/public/data/pony_score.json';

const PONY = PONY_JSON as unknown as PonyConstants;
const THEM = 'var(--text-2)';

const sgn = (v: number, dp = 2) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(dp)}`;
const tone = (v: number) => (v > 0.005 ? 'text-pos' : v < -0.005 ? 'text-neg' : 'text-fg-2');

function Head({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
    return (
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <h3 className="label">{children}</h3>
            {aside ? <span className="text-micro uppercase tracking-label text-fg-3">{aside}</span> : null}
        </div>
    );
}

/** Running xG for both sides over the game clock: the team in its colour, the opponent dim; dots are goals, bands are power plays. */
function Flow({ m, side, color }: { m: GameModel; side: Side; color: string }) {
    const [ref, w] = useWidth<HTMLDivElement>();
    const opp = other(side);
    const lines = React.useMemo(() => race(m, 'xg'), [m]);
    const pps = React.useMemo(() => powerPlays(m), [m]);
    const H = 176;
    const L = 20;
    const R = 66;
    const T = 10;
    const B = 18;
    const end = Math.max(m.end, 3600);
    const fin = { us: lines[side][lines[side].length - 1][1], them: lines[opp][lines[opp].length - 1][1] };
    const max = Math.max(1, fin.us, fin.them) * 1.06;
    const x = (t: number) => L + (t / end) * Math.max(0, w - L - R);
    const y = (v: number) => T + (1 - v / max) * (H - T - B);
    const path = (pts: [number, number][]) => pts.map(([t, v], i) => (i ? `H${x(t).toFixed(1)}V${y(v).toFixed(1)}` : `M${x(t).toFixed(1)},${y(v).toFixed(1)}`)).join('');
    const at = (pts: [number, number][], t: number) => {
        let v = 0;
        for (const [pt, pv] of pts) {
            if (pt > t) break;
            v = pv;
        }
        return v;
    };
    const step = max > 6 ? 2 : 1;
    const ticks = Array.from({ length: Math.floor(max / step) }, (_, i) => (i + 1) * step);
    const bounds = [1200, 2400, 3600].filter(t => t < end);
    const periods = [0, ...bounds].map((a, i) => ({ label: periodLabel(i + 1), mid: (a + (bounds[i] ?? end)) / 2 }));
    const goals = m.events.filter(e => e.type === 'goal');
    // End labels sit at their line's end; nudged apart when the totals are close.
    let yu = y(fin.us);
    let yt = y(fin.them);
    if (Math.abs(yu - yt) < 14) {
        const mid = (yu + yt) / 2;
        const up = fin.us >= fin.them ? -7 : 7;
        yu = mid + up;
        yt = mid - up;
    }
    const tri = { us: m.teams[side].tri, them: m.teams[opp].tri };
    return (
        <div ref={ref} className="min-w-0">
            {w > 0 ? (
                <svg width={w} height={H} className="block" role="img" aria-label={`Running xG: ${tri.us} ${fin.us.toFixed(2)}, ${tri.them} ${fin.them.toFixed(2)}`}>
                    {pps.map(([a, b, s], i) => (
                        <rect key={i} x={x(a)} y={T} width={Math.max(1, x(b) - x(a))} height={H - T - B} fill={s === side ? color : 'rgb(var(--text-1-rgb))'} opacity={s === side ? 0.16 : 0.07}>
                            <title>{`${m.teams[s].tri} power play`}</title>
                        </rect>
                    ))}
                    {ticks.map(v => (
                        <g key={v}>
                            <line x1={L} x2={w - R} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
                            <text x={L - 6} y={y(v)} dy="0.32em" textAnchor="end" className="fill-fg-3 text-[11px]">
                                {v}
                            </text>
                        </g>
                    ))}
                    <line x1={L} x2={w - R} y1={H - B} y2={H - B} stroke="var(--line-strong)" strokeWidth={1} />
                    {bounds.map(t => (
                        <line key={t} x1={x(t)} x2={x(t)} y1={T} y2={H - B} stroke="var(--line-strong)" strokeWidth={1} strokeDasharray="2 3" />
                    ))}
                    {periods.map(p => (
                        <text key={p.label} x={x(p.mid)} y={H - 4} textAnchor="middle" className="fill-fg-3 text-[11px] uppercase tracking-[0.12em]">
                            {p.label}
                        </text>
                    ))}
                    <path d={path(lines[opp])} fill="none" stroke={THEM} strokeWidth={1.5} opacity={0.75} />
                    <path d={path(lines[side])} fill="none" stroke={color} strokeWidth={2.25} />
                    {goals.map(e => {
                        const ours = e.side === side;
                        const cy = y(at(lines[e.side], e.t));
                        return (
                            <g key={e.id}>
                                <line x1={x(e.t)} x2={x(e.t)} y1={cy} y2={H - B} stroke={ours ? color : THEM} strokeWidth={1} opacity={0.35} />
                                <circle cx={x(e.t)} cy={cy} r={ours ? 4.5 : 4} fill={ours ? color : THEM} stroke="var(--bg)" strokeWidth={1.5}>
                                    <title>{`${m.teams[e.side].tri} goal, ${periodLabel(e.period)} ${e.clock}`}</title>
                                </circle>
                            </g>
                        );
                    })}
                    <text x={w - R + 8} y={yu} dy="0.32em" className="text-[12px] font-bold">
                        <tspan className="fill-fg-1">{tri.us}</tspan>
                        <tspan dx={5} className="fill-model">
                            {fin.us.toFixed(2)}
                        </tspan>
                    </text>
                    <text x={w - R + 8} y={yt} dy="0.32em" className="text-[12px]">
                        <tspan className="fill-fg-3">{tri.them}</tspan>
                        <tspan dx={5} className="fill-model" opacity={0.75}>
                            {fin.them.toFixed(2)}
                        </tspan>
                    </text>
                </svg>
            ) : (
                <div style={{ height: H }} />
            )}
        </div>
    );
}

/** Every unblocked attempt on one sheet, sized by xG: the team attacks the left net, the opponent the right; filled marks are goals. */
function ShotRink({ m, side, color }: { m: GameModel; side: Side; color: string }) {
    // The model has the away side shooting left; turn the sheet when the team is at home.
    const k = side === 'home' ? -1 : 1;
    const shots = m.events.filter(e => isUnblocked(e) && e.x != null && e.y != null).sort((a, b) => Number(a.type === 'goal') - Number(b.type === 'goal'));
    const n = { us: shots.filter(e => e.side === side).length, them: shots.filter(e => e.side !== side).length };
    return (
        <div className="min-w-0">
            <svg viewBox="-101 -43.5 202 87" className="block w-full" role="img" aria-label={`Shot map: ${m.teams[side].tri} ${n.us} unblocked attempts, ${m.teams[other(side)].tri} ${n.them}`}>
                <RinkMarkings />
                {shots.map(e => {
                    const ours = e.side === side;
                    const c = ours ? color : THEM;
                    const goal = e.type === 'goal';
                    return (
                        <circle
                            key={e.id}
                            cx={e.x! * k}
                            cy={e.y! * k}
                            r={1.1 + 5.5 * Math.sqrt(e.xg ?? 0.02)}
                            fill={c}
                            fillOpacity={goal ? 0.95 : 0.16}
                            stroke={goal ? 'var(--text-1)' : c}
                            strokeOpacity={goal ? 0.9 : 0.7}
                            strokeWidth={goal ? 0.6 : 0.4}
                        />
                    );
                })}
            </svg>
            <p className="mt-1 flex justify-between text-micro uppercase tracking-label text-fg-3">
                <span>
                    <span className="font-bold text-fg-1">{m.teams[side].tri}</span> {n.us} unbl
                </span>
                <span>
                    {n.them} unbl <span className="text-fg-2">{m.teams[other(side)].tri}</span>
                </span>
            </p>
        </div>
    );
}

function GoalList({ m, side, color, label }: { m: GameModel; side: Side; color: string; label: (id: number | null) => string }) {
    const swings = React.useMemo(() => goalSwings(m), [m]);
    const dir = side === 'home' ? 1 : -1;
    if (!swings.length && !m.shootout.length) return <p className="label">No goals</p>;
    const made = (s: Side) => `${m.shootout.filter(a => a.side === s && a.goal).length}/${m.shootout.filter(a => a.side === s).length}`;
    return (
        <ol className="flex flex-col text-caption tabular-nums">
            {swings.map(({ event: e, before, after }) => {
                const ours = e.side === side;
                const sc = { ...e.score, [e.side]: e.score[e.side] + 1 };
                const tag = e.emptyNet ? 'EN' : e.strength === 'pp' ? 'PP' : e.strength === 'sh' ? 'SH' : null;
                const d = (after - before) * dir * 100;
                return (
                    <li key={e.id} className="grid min-h-7 grid-cols-[4.25rem_2.25rem_minmax(0,1fr)_2.5rem_3rem] items-center gap-2 border-t border-line first:border-t-0">
                        <span className="text-micro uppercase text-fg-3">
                            {periodLabel(e.period)} {e.clock}
                        </span>
                        <span className={cn('font-bold', ours ? 'text-fg-1' : 'text-fg-3')}>
                            {sc[side]}–{sc[other(side)]}
                        </span>
                        <span className="flex min-w-0 items-baseline gap-1.5">
                            <span className="h-1.5 w-1.5 shrink-0 self-center rounded-[1px]" style={{ background: ours ? color : 'var(--mute)' }} aria-hidden="true" />
                            <span className={cn('shrink-0', ours ? 'font-bold text-fg-1' : 'text-fg-2')}>
                                {label(e.player)}
                                {e.totals?.g != null ? <span className="ml-1 font-normal text-fg-3">{e.totals.g}</span> : null}
                            </span>
                            {tag ? <span className="shrink-0 text-micro font-bold text-warn">{tag}</span> : null}
                            <span className="truncate text-fg-3">{e.assists.map(a => label(a)).join(', ')}</span>
                        </span>
                        <span className="text-right text-model">{e.xg != null ? e.xg.toFixed(2) : '—'}</span>
                        <span className={cn('text-right', tone(d))}>{sgn(d, 1)}</span>
                    </li>
                );
            })}
            {m.shootout.length ? (
                <li className="grid min-h-7 grid-cols-[4.25rem_minmax(0,1fr)] items-center gap-2 border-t border-line">
                    <span className="text-micro uppercase text-fg-3">SO</span>
                    <span>
                        <span className="font-bold text-fg-1">
                            {m.teams[side].tri} {made(side)}
                        </span>
                        <span className="text-fg-3">
                            {' · '}
                            {m.teams[other(side)].tri} {made(other(side))}
                        </span>
                    </span>
                </li>
            ) : null}
        </ol>
    );
}

const TH = 'h-6 px-1.5 text-right text-micro font-medium uppercase tracking-[0.1em] text-fg-3';
const TD = 'h-7 px-1.5 text-right';

/** The best nights by Pony Score: the team's top six, then the opponent's top three. */
function TopSkaters({ m, side }: { m: GameModel; side: Side }) {
    const rows = React.useMemo(
        () =>
            ([side, other(side)] as Side[]).map((s, i) => {
                const sog = new Map(skaterRows(m, s, 'all').map(r => [r.player.id, r.sog]));
                return gameScores(m, s, PONY)
                    .skaters.sort((a, b) => b.total - a.total)
                    .slice(0, i ? 3 : 6)
                    .map(r => ({ r, sog: sog.get(r.player.id) ?? 0, ours: !i }));
            }),
        [m, side],
    );
    return (
        <table className="w-full table-fixed text-caption tabular-nums">
            <colgroup>
                <col />
                {[26, 26, 38, 44, 48, 52].map((w, i) => (
                    <col key={i} style={{ width: w }} />
                ))}
            </colgroup>
            <thead>
                <tr>
                    <th scope="col" className={cn(TH, 'pl-0 text-left')}>
                        {m.teams[side].tri}
                    </th>
                    {['G', 'A', 'SOG', 'ixG', 'TOI', 'Pony'].map(h => (
                        <th key={h} scope="col" className={cn(TH, h === 'Pony' && 'pr-0')}>
                            {h}
                        </th>
                    ))}
                </tr>
            </thead>
            {rows.map((group, i) => (
                <tbody key={i}>
                    {i ? (
                        <tr>
                            <th scope="colgroup" colSpan={7} className={cn(TH, 'h-7 border-t border-line-strong pl-0 text-left align-bottom')}>
                                {m.teams[other(side)].tri}
                            </th>
                        </tr>
                    ) : null}
                    {group.map(({ r, sog, ours }) => (
                        <tr key={r.player.id} className="border-t border-line">
                            <th scope="row" className={cn('h-7 truncate pr-1.5 text-left font-normal', ours ? 'text-fg-1' : 'text-fg-2')}>
                                <span className="mr-1.5 inline-block w-4 text-right text-fg-3">{r.player.num ?? ''}</span>
                                <span className="max-sm:hidden">{r.player.first.charAt(0)}. </span>
                                {r.player.last}
                            </th>
                            <td className={cn(TD, r.raw.g ? 'font-bold text-fg-1' : 'text-fg-3')}>{r.raw.g}</td>
                            <td className={cn(TD, r.raw.a1 + r.raw.a2 ? 'font-bold text-fg-1' : 'text-fg-3')}>{r.raw.a1 + r.raw.a2}</td>
                            <td className={cn(TD, 'text-fg-2')}>{sog}</td>
                            <td className={cn(TD, 'text-model')}>{r.raw.ixg.toFixed(2)}</td>
                            <td className={cn(TD, 'text-fg-2')}>{clockOf(r.raw.toi)}</td>
                            <td className={cn(TD, 'pr-0 font-bold', tone(r.total))}>{sgn(r.total)}</td>
                        </tr>
                    ))}
                </tbody>
            ))}
        </table>
    );
}

function GoalieTable({ m, side }: { m: GameModel; side: Side }) {
    const rows = ([side, other(side)] as Side[]).flatMap((s, i) => goalieRows(m, s).map(g => ({ g, ours: !i })));
    if (!rows.length) return <p className="label">No goalies</p>;
    return (
        <table className="w-full table-fixed text-caption tabular-nums">
            <colgroup>
                <col />
                {[52, 44, 44, 52].map((w, i) => (
                    <col key={i} style={{ width: w }} />
                ))}
            </colgroup>
            <thead>
                <tr>
                    <th scope="col" className={cn(TH, 'pl-0 text-left')}>
                        <span className="sr-only">Goalie</span>
                    </th>
                    {['SV', 'Sv%', 'xGA', 'GSAx'].map(h => (
                        <th key={h} scope="col" className={cn(TH, h === 'GSAx' && 'pr-0')}>
                            {h}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {rows.map(({ g, ours }) => {
                    const gsax = m.xgPending ? null : g.xga - g.ga;
                    return (
                        <tr key={g.player.id} className="border-t border-line">
                            <th scope="row" className={cn('h-7 truncate pr-1.5 text-left font-normal', ours ? 'text-fg-1' : 'text-fg-2')}>
                                {g.player.last}
                                <span className="ml-1.5 text-micro uppercase text-fg-3">{m.teams[g.player.side].tri}</span>
                            </th>
                            <td className={cn(TD, 'text-fg-1')}>
                                {g.sa - g.ga}/{g.sa}
                            </td>
                            <td className={cn(TD, 'text-fg-2')}>{g.sa ? svPct((g.sa - g.ga) / g.sa) : '—'}</td>
                            <td className={cn(TD, 'text-model')}>{m.xgPending ? '—' : g.xga.toFixed(2)}</td>
                            <td className={cn(TD, 'pr-0 font-bold', gsax == null ? 'text-fg-3' : tone(gsax))}>{gsax == null ? '—' : sgn(gsax)}</td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
}

/** What the log row does not carry: the team's number, its share of the two, the opponent's number. */
function TeamSplits({ m, side, color }: { m: GameModel; side: Side; color: string }) {
    const t = React.useMemo(() => teamTotals(m.events, 'all', 'all'), [m]);
    // Phones: the card row shows only the score, so the shot counts the wide table carries lead here.
    const items: [string, keyof (typeof t)['away'], boolean?][] = [
        ['Shots', 'sog', true],
        ['Attempts', 'attempts', true],
        ['High danger', 'hd', true],
        ['Faceoffs', 'faceoffs'],
        ['Hits', 'hits'],
        ['Blocks', 'blocks'],
        ['Takeaways', 'takeaways'],
        ['Giveaways', 'giveaways'],
        ['PIM', 'pim'],
    ];
    return (
        <dl className="flex flex-col gap-1 text-caption tabular-nums">
            {items.map(([name, k, phone]) => {
                const a = t[side][k];
                const b = t[other(side)][k];
                const share = a + b > 0 ? (a / (a + b)) * 100 : 50;
                return (
                    <div key={k} className={cn('grid grid-cols-[5.5rem_1.75rem_minmax(0,1fr)_1.75rem] items-center gap-2', phone && 'md:hidden')}>
                        <dt className="text-micro uppercase tracking-[0.1em] text-fg-3">{name}</dt>
                        <dd className="contents">
                            <span className={cn('text-right', a > b ? 'font-bold text-fg-1' : 'text-fg-2')}>{a}</span>
                            <span className="flex h-2 gap-px overflow-hidden rounded-[2px]" aria-hidden="true">
                                <span style={{ width: `${share}%`, background: color, opacity: a >= b ? 0.9 : 0.45 }} />
                                <span className="flex-1 bg-fg-2" style={{ opacity: b > a ? 0.6 : 0.25 }} />
                            </span>
                            <span className={cn(b > a ? 'font-bold text-fg-1' : 'text-fg-2')}>{b}</span>
                        </dd>
                    </div>
                );
            })}
        </dl>
    );
}

/**
 * One game in a glance, inside the team game log: the game page (/games/[id]) boiled down to the running xG,
 * the shot map, the goals with their win-probability swings, the best skaters by Pony Score, both goalies and
 * the team counts the log row does not carry. Always from the team's side: its colour against a dim opponent.
 */
export default function GameDigest({ id, tri, color }: { id: string; tri: string; color: string }) {
    const [m, setM] = React.useState<GameModel | null | undefined>(undefined);
    React.useEffect(() => {
        let alive = true;
        gamePack(Number(id)).then(v => alive && setM(v));
        return () => {
            alive = false;
        };
    }, [id]);
    const label = React.useMemo(() => {
        const names = m ? nameLabels(m.players) : new Map<number, string>();
        return (pid: number | null) => (pid != null ? (names.get(pid) ?? '—') : '—');
    }, [m]);

    const link = (
        <Link href={`/games/${id}`} className="inline-flex min-h-8 shrink-0 items-center gap-1.5 text-micro font-bold uppercase tracking-label text-brand hover:underline coarse:min-h-11">
            Game page
            <svg viewBox="0 0 8 8" className="h-2 w-2" aria-hidden="true">
                <path d="M2.5 1 6 4 2.5 7" fill="none" stroke="currentColor" strokeWidth="1.4" />
            </svg>
        </Link>
    );
    if (!m) {
        return (
            <div className="flex min-h-24 items-start justify-between gap-4">
                <p className={cn('label', m === null && 'text-neg')} role="status">
                    {m === undefined ? 'Loading' : 'Game unavailable'}
                </p>
                {link}
            </div>
        );
    }
    const side: Side = m.teams.home.tri === tri ? 'home' : 'away';
    const opp = other(side);
    const periods = lineScore(m);
    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
                <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-caption tabular-nums">
                    {periods.map(p => (
                        <div key={p.period} className="flex items-baseline gap-1.5">
                            <dt className="text-micro uppercase tracking-label text-fg-3">{periodLabel(p.period)}</dt>
                            <dd className="font-bold text-fg-1">
                                {p.goals[side]}–{p.goals[opp]}
                            </dd>
                            <dd className="text-fg-3">
                                {p.sog[side]}–{p.sog[opp]} <span className="text-micro uppercase">sog</span>
                            </dd>
                        </div>
                    ))}
                </dl>
                {link}
            </div>
            <div className="grid items-start gap-x-8 gap-y-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
                <section className="min-w-0">
                    <Head aside={m.xgPending ? 'pending' : undefined}>xG</Head>
                    <Flow m={m} side={side} color={color} />
                </section>
                <section className="min-w-0">
                    <Head>Shots</Head>
                    <ShotRink m={m} side={side} color={color} />
                </section>
            </div>
            <div className="grid items-start gap-x-8 gap-y-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.15fr)_minmax(0,1fr)]">
                <section className="min-w-0">
                    <Head aside="xG · win %">Goals</Head>
                    <GoalList m={m} side={side} color={color} label={label} />
                </section>
                <section className="min-w-0">
                    <Head>Skaters</Head>
                    <TopSkaters m={m} side={side} />
                </section>
                <section className="flex min-w-0 flex-col gap-3">
                    <div>
                        <Head>Goalies</Head>
                        <GoalieTable m={m} side={side} />
                    </div>
                    <div>
                        <Head>Team</Head>
                        <TeamSplits m={m} side={side} color={color} />
                    </div>
                </section>
            </div>
        </div>
    );
}
