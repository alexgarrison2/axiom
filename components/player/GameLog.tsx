import * as React from 'react';
import Link from 'next/link';
import { ScrollRegion } from '@/components/ui/scroll-region';
import { cn } from '@/lib/utils';
import { signed } from '@/lib/pony/parts';
import type { GoalieGame, PonyGame, SkaterGame } from '@/lib/pony/data';
import { bigSaves, goalieFoot, mmss, notable, scoreLine, share, shutout, skaterFoot, svPct, takesDraws, type GoalieFoot, type SkaterFoot } from '@/lib/players/gamelog';
import { fmtInt } from '@/components/views/format';

/*
 * The player page's game log: one row a game, newest first, in column groups
 * (scoring, shooting, 5v5, play, time; goalies: shots, high danger, even,
 * shorthanded), a TOTAL and PER GP footer for the games shown, and the Pony
 * Score with its bar last. The latest 25 show; a checkbox (no script) reveals
 * the rest and swaps the footer to match. Phones pin the date and lead with
 * the score and the box-score basics; the rest scrolls sideways.
 */

const LATEST = 25;
// Below xl the log scrolls sideways under a pinned date column.
const PIN = 'max-xl:sticky max-xl:left-0 max-xl:z-10 max-xl:bg-surface-1';
const PIN_EDGE = "max-xl:after:pointer-events-none max-xl:after:absolute max-xl:after:inset-y-0 max-xl:after:right-0 max-xl:after:w-px max-xl:after:bg-line-strong max-xl:after:content-['']";
const PIN_HOVER = 'max-xl:group-hover:bg-[color-mix(in_srgb,var(--surface-2)_60%,var(--surface-1))]';

type Cell = { v: React.ReactNode; cls?: string; title?: string } | null;
interface Col<R, F> {
    key: string;
    head: string;
    /** Full name (header tooltip). */
    name: string;
    group: string;
    /** Phones: the leading columns after the opponent, in this order. */
    lead?: number;
    left?: boolean;
    cell: (r: R) => Cell;
    total?: (f: F) => Cell;
    per?: (f: F) => Cell;
}

/** A count: zero dims, a standout night gets the quiet cyan wash. */
function count(v: number | null | undefined, opts: { strong?: boolean; hi?: boolean } = {}): Cell {
    if (v == null) return null;
    if (!v) return { v: 0, cls: 'text-fg-3' };
    return { v: opts.hi ? <Hi>{fmtInt(v)}</Hi> : fmtInt(v), cls: opts.strong ? 'text-fg-1' : 'text-fg-2' };
}
function Hi({ children }: { children: React.ReactNode }) {
    return <span className="-mx-1 rounded-chip bg-brand/15 px-1 font-semibold text-fg-1">{children}</span>;
}
const dec = (v: number, d = 2): Cell => ({ v: v.toFixed(d), cls: 'text-fg-2' });
const pct = (v: number | null, cls = 'text-fg-2'): Cell => (v == null ? null : { v: v.toFixed(0), cls });
const plusMinus = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0');
const time = (s: number | null, dimZero = false): Cell => (s == null ? null : { v: mmss(s), cls: dimZero && s < 1 ? 'text-fg-3' : 'text-fg-2' });

function oppCell(r: SkaterGame | GoalieGame): Cell {
    return {
        v: (
            <span className="text-fg-2">
                <span className="inline-block min-w-3 text-fg-3">{r.home ? 'vs' : '@'}</span>
                {/* eslint-disable-next-line @next/next/no-img-element -- team logo */}
                <img src={`/logos/${r.opp}.svg`} alt="" width={18} height={18} className="mx-1.5 inline-block h-[18px] w-[18px] align-[-4px]" />
                {r.opp}
            </span>
        ),
    };
}
function resCell(r: SkaterGame | GoalieGame, games: Map<number, PonyGame>): Cell {
    const score = scoreLine(games.get(r.game), r.team);
    return {
        v: (
            <>
                <span className={cn('inline-block w-7', r.result === 'W' ? 'text-fg-1' : 'text-fg-3')}>{r.result}</span>
                <span className="text-fg-2">{score ?? ''}</span>
            </>
        ),
    };
}

function skaterCols(games: Map<number, PonyGame>, draws: boolean): Col<SkaterGame, SkaterFoot>[] {
    const cols: Col<SkaterGame, SkaterFoot>[] = [
        { key: 'opp', head: 'Opp', name: 'Opponent', group: '', left: true, cell: oppCell, total: f => ({ v: `${f.gp} GP`, cls: 'text-fg-2' }) },
        { key: 'res', head: 'Res', name: 'Result', group: '', lead: 7, left: true, cell: r => resCell(r, games), total: f => ({ v: f.record, cls: 'text-fg-2' }) },
        { key: 'g', head: 'G', name: 'Goals', group: 'Scoring', lead: 2, cell: r => count(r.g, { strong: true, hi: notable('g', r.g) }), total: f => count(f.sum.g, { strong: true }), per: f => dec(f.per.g) },
        {
            key: 'a',
            head: 'A',
            name: 'Assists (primary / secondary)',
            group: 'Scoring',
            lead: 3,
            cell: r => ({ ...count(r.a1 + r.a2, { strong: true })!, title: `A1 ${r.a1} · A2 ${r.a2}` }),
            total: f => ({ ...count(f.sum.a, { strong: true })!, title: `A1 ${f.sum.a1} · A2 ${f.sum.a2}` }),
            per: f => dec(f.per.a),
        },
        { key: 'p', head: 'P', name: 'Points', group: 'Scoring', lead: 4, cell: r => count(r.g + r.a1 + r.a2, { strong: true, hi: notable('p', r.g + r.a1 + r.a2) }), total: f => count(f.sum.p, { strong: true }), per: f => dec(f.per.p) },
        { key: 'ppp', head: 'PPP', name: 'Power-play points', group: 'Scoring', cell: r => count(r.box?.ppp, { hi: notable('ppp', r.box?.ppp) }), total: f => count(f.sum.ppp), per: f => dec(f.per.ppp) },
        { key: 'shp', head: 'SHP', name: 'Shorthanded points', group: 'Scoring', cell: r => count(r.box?.shp, { hi: notable('shp', r.box?.shp) }), total: f => count(f.sum.shp), per: f => dec(f.per.shp) },
        { key: 'sog', head: 'SOG', name: 'Shots on goal', group: 'Shooting', lead: 5, cell: r => count(r.sog, { hi: notable('sog', r.sog) }), total: f => count(f.sum.sog), per: f => dec(f.per.sog, 1) },
        { key: 'att', head: 'Att', name: 'Shot attempts', group: 'Shooting', cell: r => count(r.box?.att), total: f => count(f.sum.att), per: f => dec(f.per.att, 1) },
        {
            key: 'ixg',
            head: 'ixG',
            name: 'Individual expected goals',
            group: 'Shooting',
            cell: r => ({ v: notable('ixg', r.ixg) ? <Hi>{r.ixg.toFixed(2)}</Hi> : r.ixg.toFixed(2), cls: 'text-model' }),
            total: f => ({ v: f.sum.ixg.toFixed(2), cls: 'text-model' }),
            per: f => ({ v: f.per.ixg.toFixed(2), cls: 'text-model' }),
        },
        { key: 'sh', head: 'Sh%', name: 'Shooting percentage', group: 'Shooting', cell: r => pct(r.sog ? (100 * r.g) / r.sog : null, r.g ? 'text-fg-2' : 'text-fg-3'), per: f => pct(f.shPct) },
        { key: 'cf', head: 'CF%', name: '5v5 on-ice shot-attempt share', group: '5v5', cell: r => pct(r.box ? share(r.box.cf5, r.box.ca5) : null), per: f => pct(f.cf5) },
        { key: 'xgf', head: 'xGF%', name: '5v5 on-ice pony xG share', group: '5v5', cell: r => pct(r.box ? share(r.box.xgf5, r.box.xga5) : null, 'text-model'), per: f => pct(f.xgf5, 'text-model') },
        { key: 'hit', head: 'Hit', name: 'Hits', group: 'Play', cell: r => count(r.hit, { hi: notable('hit', r.hit) }), total: f => count(f.sum.hit), per: f => dec(f.per.hit, 1) },
        { key: 'blk', head: 'Blk', name: 'Blocked shots', group: 'Play', cell: r => count(r.blk, { hi: notable('blk', r.blk) }), total: f => count(f.sum.blk), per: f => dec(f.per.blk, 1) },
        { key: 'tk', head: 'Tk', name: 'Takeaways', group: 'Play', cell: r => count(r.box?.tk, { hi: notable('tk', r.box?.tk) }), total: f => count(f.sum.tk), per: f => dec(f.per.tk, 1) },
        { key: 'gv', head: 'Gv', name: 'Giveaways', group: 'Play', cell: r => count(r.box?.gv), total: f => count(f.sum.gv), per: f => dec(f.per.gv, 1) },
    ];
    if (draws) {
        cols.push({
            key: 'fo',
            head: 'FO',
            name: 'Faceoffs won–lost',
            group: 'Play',
            cell: r => (r.box ? (r.box.foW + r.box.foL ? { v: `${r.box.foW}–${r.box.foL}`, cls: 'text-fg-2' } : { v: '0–0', cls: 'text-fg-3' }) : null),
            total: f => ({ v: `${fmtInt(f.sum.foW)}–${fmtInt(f.sum.foL)}`, cls: 'text-fg-2' }),
            per: f => (f.foPct == null ? null : { v: `${f.foPct.toFixed(1)}%`, cls: 'text-fg-2' }),
        });
    }
    cols.push(
        { key: 'pim', head: 'PIM', name: 'Penalty minutes', group: 'Play', cell: r => count(r.pim), total: f => count(f.sum.pim), per: f => dec(f.per.pim, 1) },
        { key: 'pm', head: '+/−', name: 'Plus-minus', group: 'Play', cell: r => ({ v: plusMinus(r.pm), cls: r.pm ? 'text-fg-2' : 'text-fg-3' }), total: f => ({ v: plusMinus(f.sum.pm), cls: 'text-fg-2' }) },
        { key: 'toi', head: 'TOI', name: 'Time on ice', group: 'Time', lead: 6, cell: r => time(r.toi), per: f => time(f.per.toi) },
        { key: 'pp', head: 'PP', name: 'Power-play time', group: 'Time', cell: r => time(r.toiPp, true), per: f => time(f.per.toiPp, true) },
        { key: 'pk', head: 'PK', name: 'Penalty-kill time', group: 'Time', cell: r => time(r.toiPk, true), per: f => time(f.per.toiPk, true) },
        { key: 'shf', head: 'Shf', name: 'Shifts', group: 'Time', cell: r => count(r.box?.shifts), per: f => (f.per.shifts == null ? null : dec(f.per.shifts, 1)) },
    );
    return cols;
}

function goalieCols(games: Map<number, PonyGame>): Col<GoalieGame, GoalieFoot>[] {
    const sv = (sa: number, ga: number, cls = 'text-fg-2'): Cell => {
        const v = svPct(sa, ga);
        return v == null ? null : { v, cls };
    };
    return [
        { key: 'opp', head: 'Opp', name: 'Opponent', group: '', left: true, cell: oppCell, total: f => ({ v: `${f.gp} GP`, cls: 'text-fg-2' }) },
        { key: 'res', head: 'Res', name: 'Team result', group: '', lead: 6, left: true, cell: r => resCell(r, games) },
        {
            key: 'dec',
            head: 'Dec',
            name: 'Decision',
            group: '',
            lead: 5,
            left: true,
            cell: r => (r.box ? { v: r.box.decision ?? '—', cls: r.box.decision === 'W' ? 'text-fg-1' : 'text-fg-3' } : null),
            total: f => ({ v: f.record, cls: 'text-fg-2' }),
        },
        { key: 'sa', head: 'SA', name: 'Shots against', group: 'Shots', lead: 2, cell: r => count(r.sa), total: f => count(f.sa), per: f => dec(f.sa / Math.max(1, f.gp), 1) },
        { key: 'sv', head: 'SV', name: 'Saves', group: 'Shots', cell: r => count(r.sa - r.ga), total: f => count(f.sa - f.ga), per: f => dec((f.sa - f.ga) / Math.max(1, f.gp), 1) },
        { key: 'ga', head: 'GA', name: 'Goals against', group: 'Shots', lead: 4, cell: r => (shutout(r) ? { v: <Hi>0</Hi> } : count(r.ga, { strong: true })), total: f => count(f.ga, { strong: true }), per: f => (f.gaa == null ? null : { v: f.gaa.toFixed(2), cls: 'text-fg-2', title: 'Goals against per 60' }) },
        { key: 'svp', head: 'SV%', name: 'Save percentage', group: 'Shots', lead: 3, cell: r => (bigSaves(r) ? { v: <Hi>{svPct(r.sa, r.ga)}</Hi> } : sv(r.sa, r.ga, 'text-fg-1')), per: f => sv(f.sa, f.ga, 'text-fg-1') },
        { key: 'xga', head: 'xGA', name: 'Expected goals against (pony xG)', group: 'Shots', cell: r => ({ v: r.xga.toFixed(2), cls: 'text-model' }), total: f => ({ v: f.xga.toFixed(2), cls: 'text-model' }), per: f => ({ v: (f.xga / Math.max(1, f.gp)).toFixed(2), cls: 'text-model' }) },
        { key: 'hdsa', head: 'HDSA', name: 'High-danger shots against', group: 'High danger', cell: r => count(r.box?.hdSa), total: f => count(f.hdSa), per: f => dec(f.hdSa / Math.max(1, f.gp), 1) },
        { key: 'hdga', head: 'HDGA', name: 'High-danger goals against', group: 'High danger', cell: r => count(r.box?.hdGa), total: f => count(f.hdGa) },
        { key: 'hdsv', head: 'HDSV%', name: 'High-danger save percentage', group: 'High danger', cell: r => (r.box ? sv(r.box.hdSa, r.box.hdGa) : null), per: f => sv(f.hdSa, f.hdGa) },
        { key: 'evsa', head: 'EVSA', name: 'Even-strength shots against', group: 'Even', cell: r => count(r.box?.evSa), total: f => count(f.evSa) },
        { key: 'evsv', head: 'EVSV%', name: 'Even-strength save percentage', group: 'Even', cell: r => (r.box ? sv(r.box.evSa, r.box.evGa) : null), per: f => sv(f.evSa, f.evGa) },
        { key: 'pksa', head: 'PKSA', name: 'Shots against on the penalty kill', group: 'Shorthanded', cell: r => count(r.box?.pkSa), total: f => count(f.pkSa) },
        { key: 'pksv', head: 'PKSV%', name: 'Save percentage on the penalty kill', group: 'Shorthanded', cell: r => (r.box ? sv(r.box.pkSa, r.box.pkGa) : null), per: f => sv(f.pkSa, f.pkGa) },
        { key: 'toi', head: 'TOI', name: 'Time on ice', group: 'Time', cell: r => time(r.toi), per: f => time(f.toi / Math.max(1, f.gp)) },
    ];
}

interface Inst<R, F> {
    col: Col<R, F>;
    /** '' everywhere, or only below / from md. */
    vis: '' | 'md:hidden' | 'max-md:hidden';
    /** First of its group (desktop): a hairline on its left. */
    edge: boolean;
}

function layout<R, F>(cols: Col<R, F>[]): Inst<R, F>[] {
    const leads = cols.filter(c => c.lead != null).sort((a, b) => a.lead! - b.lead!);
    const desk = cols.map((col, i) => ({ col, vis: (col.lead != null ? 'max-md:hidden' : '') as Inst<R, F>['vis'], edge: !!col.group && col.group !== cols[i - 1]?.group }));
    // Phones: opponent, then the leads, then the rest in desktop order.
    return [desk[0], ...leads.map(col => ({ col, vis: 'md:hidden' as const, edge: false })), ...desk.slice(1)];
}

function td(c: Cell, inst: { vis: string; edge: boolean; col: { left?: boolean } }, extra?: string) {
    return cn('whitespace-nowrap px-1.5', inst.col.left ? 'text-left' : 'text-right', inst.vis, inst.edge && 'md:border-l md:border-line/70', c?.cls ?? 'text-fg-3', extra);
}

export function GameLog({ rows, goalie, games, color }: { rows: SkaterGame[] | GoalieGame[]; goalie: boolean; games: Map<number, PonyGame>; color: string }) {
    const newest = [...rows].reverse() as (SkaterGame | GoalieGame)[];
    const reach = Math.max(1, ...rows.map(x => Math.abs(x.ps)));
    const scoreHead = goalie ? 'GSAx' : 'Pony';
    if (goalie) {
        const g = rows as GoalieGame[];
        return <Table insts={layout(goalieCols(games))} newest={newest as GoalieGame[]} foot={n => goalieFoot(g.slice(-n))} total={rows.length} reach={reach} color={color} scoreHead={scoreHead} />;
    }
    const s = rows as SkaterGame[];
    return <Table insts={layout(skaterCols(games, takesDraws(s)))} newest={newest as SkaterGame[]} foot={n => skaterFoot(s.slice(-n))} total={rows.length} reach={reach} color={color} scoreHead={scoreHead} />;
}

function Table<R extends SkaterGame | GoalieGame, F extends { ps: number } | { sum: { ps: number }; per: { ps: number } }>({
    insts,
    newest,
    foot,
    total,
    reach,
    color,
    scoreHead,
}: {
    insts: Inst<R, F>[];
    newest: R[];
    foot: (n: number) => F;
    total: number;
    reach: number;
    color: string;
    scoreHead: string;
}) {
    // Group header spans (desktop order; the phone-only lead copies are hidden there).
    const spans: { group: string; n: number }[] = [];
    for (const i of insts) {
        if (i.vis === 'md:hidden') continue;
        const last = spans[spans.length - 1];
        if (last && last.group === i.col.group) last.n += 1;
        else spans.push({ group: i.col.group, n: 1 });
    }
    const psTotal = (f: F) => ('sum' in f ? f.sum.ps : f.ps);
    const psPer = (f: F, gp: number) => ('per' in f ? f.per.ps : f.ps / Math.max(1, gp));
    const more = total > LATEST;
    const scoreCls = (v: number) => cn('whitespace-nowrap px-3 text-right font-bold', v < 0 ? 'text-fg-2' : 'text-fg-1');
    const head = 'whitespace-nowrap px-1.5 py-2 font-semibold';

    const footRows = (n: number, cls: string) => {
        const f = foot(n);
        const gp = Math.min(n, total);
        const fr = (label: string, pick: 'total' | 'per', ps = pick === 'total' ? psTotal(f) : psPer(f, gp)) => (
            <tr key={`${label}-${n}`} className={cn('group text-fg-2', cls, pick === 'total' && 'border-t border-line-strong')}>
                <th scope="row" className={cn('whitespace-nowrap px-3 py-1.5 text-left text-micro font-semibold uppercase tracking-label text-fg-3', PIN, PIN_EDGE)}>
                    {label}
                </th>
                {insts.map((i, k) => {
                    const c = i.col[pick]?.(f) ?? null;
                    return (
                        <React.Fragment key={`${i.col.key}-${i.vis}`}>
                            <td className={td(c, i, c ? '' : 'text-fg-3')} title={c?.title}>
                                {c ? c.v : ''}
                            </td>
                            {k === 0 ? <td className={cn(scoreCls(ps), 'md:hidden')}>{signed(ps)}</td> : null}
                        </React.Fragment>
                    );
                })}
                <td className={cn(scoreCls(ps), 'border-l border-line/70 max-md:hidden')}>{signed(ps)}</td>
                <td className="px-3" />
            </tr>
        );
        return [fr('Total', 'total'), fr('Per GP', 'per')];
    };

    return (
        <div className="group/log flex flex-col gap-2">
            <input id="log-all" type="checkbox" className="peer sr-only" />
            <ScrollRegion label="Game log" stickyStart className="panel max-xl:bg-none max-xl:bg-surface-1">
                <table className="w-full min-w-max border-collapse text-caption tabular-nums">
                    <thead>
                        <tr className="text-micro uppercase tracking-label text-fg-3 max-md:hidden">
                            <th className={cn('px-3 pt-2', PIN, PIN_EDGE)} />
                            {spans.map((s, k) => (
                                <th key={k} colSpan={s.n} scope="colgroup" className={cn('px-2 pt-2 text-left font-semibold', s.group && 'border-l border-line/70')}>
                                    {s.group}
                                </th>
                            ))}
                            <th colSpan={2} className="border-l border-line/70 px-3 pt-2" />
                        </tr>
                        <tr className="border-b border-line text-micro uppercase tracking-chip text-fg-3">
                            <th scope="col" className={cn(head, 'px-3 text-left', PIN, PIN_EDGE)}>
                                Date
                            </th>
                            {insts.map((i, k) => (
                                <React.Fragment key={`${i.col.key}-${i.vis}`}>
                                    <th scope="col" title={i.col.name} className={cn(head, i.col.left ? 'text-left' : 'text-right', i.vis, i.edge && 'md:border-l md:border-line/70')}>
                                        {i.col.head}
                                    </th>
                                    {k === 0 ? (
                                        <th scope="col" className={cn(head, 'px-3 text-right text-fg-1 md:hidden')}>
                                            {scoreHead}
                                        </th>
                                    ) : null}
                                </React.Fragment>
                            ))}
                            <th scope="col" className={cn(head, 'border-l border-line/70 px-3 text-right text-fg-1 max-md:hidden')}>
                                {scoreHead}
                            </th>
                            <th className="w-24 px-3 py-2" aria-hidden="true" />
                        </tr>
                    </thead>
                    <tbody>
                        {newest.map((r, k) => (
                            <tr key={r.game} className={cn('group border-b border-line/60 hover:bg-surface-2/60', k >= LATEST && 'hidden group-has-[:checked]/log:table-row')}>
                                <td className={cn('whitespace-nowrap px-3 py-1.5', PIN, PIN_EDGE, PIN_HOVER)}>
                                    <Link href={`/games/${r.game}`} className="text-fg-2 underline-offset-4 group-hover:text-fg-1 group-hover:underline coarse:py-1.5">
                                        {r.date.slice(5).replace('-', '/')}
                                    </Link>
                                </td>
                                {insts.map((i, k) => {
                                    const c = i.col.cell(r);
                                    return (
                                        <React.Fragment key={`${i.col.key}-${i.vis}`}>
                                            <td className={td(c, i)} title={c?.title}>
                                                {c ? c.v : '—'}
                                            </td>
                                            {/* Phones: the score follows the opponent. */}
                                            {k === 0 ? <td className={cn(scoreCls(r.ps), 'md:hidden')}>{signed(r.ps)}</td> : null}
                                        </React.Fragment>
                                    );
                                })}
                                <td className={cn(scoreCls(r.ps), 'border-l border-line/70 max-md:hidden')}>{signed(r.ps)}</td>
                                <td className="px-3">
                                    <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="block h-2.5 w-full min-w-16" aria-hidden="true">
                                        <rect x={0} y={0} width={100} height={10} fill="var(--track)" />
                                        <rect x={Math.min(50, 50 + (r.ps / reach) * 48)} y={1} width={Math.abs((r.ps / reach) * 48)} height={8} fill={r.ps >= 0 ? color : 'var(--text-3)'} opacity={0.9} />
                                        <line x1={50} x2={50} y1={0} y2={10} className="stroke-fg-3" vectorEffect="non-scaling-stroke" />
                                    </svg>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                    <tfoot>
                        {more ? [...footRows(LATEST, 'group-has-[:checked]/log:hidden'), ...footRows(total, 'hidden group-has-[:checked]/log:table-row')] : footRows(total, '')}
                    </tfoot>
                </table>
            </ScrollRegion>
            {more ? (
                <label
                    htmlFor="log-all"
                    className="cursor-pointer self-center rounded-full border border-line px-4 py-2 text-micro uppercase tracking-label text-fg-2 hover:border-line-strong hover:text-fg-1 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-brand coarse:py-3.5"
                >
                    <span className="group-has-[:checked]/log:hidden">Show all {total} games</span>
                    <span className="hidden group-has-[:checked]/log:inline">Show the latest {LATEST}</span>
                </label>
            ) : null}
        </div>
    );
}
