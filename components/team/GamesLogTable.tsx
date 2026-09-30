'use client';

import * as React from 'react';
import { ScrollRegion } from '@/components/ui/scroll-region';
import { cn } from '@/lib/utils';
import { mmss, pct3, shortDate, signed } from '@/utils/team-stats/format';
import type { Boxscores, BoxRow } from '@/utils/team-stats/team-types';
import type { GameRow, PeriodFilter } from '@/utils/team-stats/types';
import { HeaderCell, type SortDir } from '@/components/teams-table/HeaderCell';
import { useStickyHeader } from '@/components/teams-table/useStickyHeader';
import { flags, gameGsax, resultLabel, resultTone, score, stat, totals } from './game-log-model';

interface GamesLogTableProps {
    games: GameRow[];
    period: PeriodFilter;
    seasonLabel: string;
    teamColor: string;
    /** Loads per-game player rows on demand (boxscore expansion). */
    loadBoxscores: () => Promise<Boxscores | undefined>;
}

const TONE: Record<string, string> = {
    win: 'bg-pos/15 text-pos',
    otl: 'bg-warn/15 text-warn',
    loss: 'bg-neg/15 text-neg',
};

interface Col {
    key: string;
    label: string;
    title: string;
    width: number;
    value: (g: GameRow, p: PeriodFilter) => number;
    render: (g: GameRow, p: PeriodFilter) => React.ReactNode;
    fullGame?: boolean;
    tone?: (g: GameRow, p: PeriodFilter) => string | undefined;
}

const diffTone = (v: number) => (v > 0 ? 'text-pos' : v < 0 ? 'text-neg' : 'text-fg-2');

const COLS: Col[] = [
    { key: 'res', label: 'Res', title: 'Result', width: 64, value: g => (resultTone(g) === 'win' ? 2 : resultTone(g) === 'otl' ? 1 : 0), render: g => <ResultChip g={g} /> },
    { key: 'score', label: 'Score', title: 'Goals for – against', width: 64, value: (g, p) => score(g, p)[0] - score(g, p)[1], render: (g, p) => score(g, p).join('–') },
    { key: 'starter', label: 'Goalie', title: 'Starting goalie', width: 108, value: () => 0, render: g => lastName(g.starter) },
    { key: 'oppStarter', label: 'Opp G', title: "Opponent's starting goalie", width: 108, value: () => 0, render: g => lastName(g.oppStarter) },
    { key: 'pp', label: 'PP', title: 'Power-play goals / opportunities', width: 64, fullGame: true, value: g => (g.ppo ? g.ppg / g.ppo : -1), render: g => `${g.ppg}/${g.ppo}` },
    { key: 'pk', label: 'PK', title: 'Power-play goals allowed / times shorthanded', width: 64, fullGame: true, value: g => (g.pko ? 1 - g.ppga / g.pko : 2), render: g => `${g.ppga}/${g.pko}` },
    { key: 'sf', label: 'SF', title: 'Shots for', width: 52, value: (g, p) => stat(g, 'sf', p), render: (g, p) => stat(g, 'sf', p) },
    { key: 'sa', label: 'SA', title: 'Shots against', width: 52, value: (g, p) => stat(g, 'sa', p), render: (g, p) => stat(g, 'sa', p) },
    { key: 'sd', label: 'SΔ', title: 'Shot differential', width: 56, value: (g, p) => stat(g, 'sf', p) - stat(g, 'sa', p), render: (g, p) => signed(stat(g, 'sf', p) - stat(g, 'sa', p)), tone: (g, p) => diffTone(stat(g, 'sf', p) - stat(g, 'sa', p)) },
    { key: 'cf', label: 'CF', title: 'Shot attempts for', width: 52, value: (g, p) => stat(g, 'cf', p), render: (g, p) => stat(g, 'cf', p) },
    { key: 'ca', label: 'CA', title: 'Shot attempts against', width: 52, value: (g, p) => stat(g, 'ca', p), render: (g, p) => stat(g, 'ca', p) },
    { key: 'hdf', label: 'HDF', title: 'High-danger chances for', width: 52, value: (g, p) => stat(g, 'hdf', p), render: (g, p) => stat(g, 'hdf', p) },
    { key: 'hda', label: 'HDA', title: 'High-danger chances against', width: 52, value: (g, p) => stat(g, 'hda', p), render: (g, p) => stat(g, 'hda', p) },
    { key: 'xgf', label: 'xGF', title: 'Expected goals for', width: 56, value: (g, p) => stat(g, 'xgf', p), render: (g, p) => stat(g, 'xgf', p).toFixed(2) },
    { key: 'xga', label: 'xGA', title: 'Expected goals against', width: 56, value: (g, p) => stat(g, 'xga', p), render: (g, p) => stat(g, 'xga', p).toFixed(2) },
    { key: 'xgd', label: 'xGΔ', title: 'Expected-goal differential', width: 60, value: (g, p) => stat(g, 'xgf', p) - stat(g, 'xga', p), render: (g, p) => signed(stat(g, 'xgf', p) - stat(g, 'xga', p), 2), tone: (g, p) => diffTone(stat(g, 'xgf', p) - stat(g, 'xga', p)) },
    {
        key: 'sv', label: 'Sv%', title: 'Save percentage', width: 60,
        value: (g, p) => { const sa = stat(g, 'sa', p) - (p === 'All' ? g.enga : 0); return sa > 0 ? (stat(g, 'sa', p) - stat(g, 'ga', p)) / sa : 0; },
        render: (g, p) => { const sa = stat(g, 'sa', p) - (p === 'All' ? g.enga : 0); return sa > 0 ? pct3((stat(g, 'sa', p) - stat(g, 'ga', p)) / sa) : '—'; },
    },
    {
        key: 'gsax', label: 'GSAx', title: 'Goals saved above expected', width: 60,
        value: (g, p) => gameGsax(g, p),
        render: (g, p) => signed(gameGsax(g, p), 2),
        tone: (g, p) => diffTone(gameGsax(g, p)),
    },
    { key: 'tl', label: 'T↑', title: 'Time leading', width: 60, value: (g, p) => stat(g, 'tl', p), render: (g, p) => mmss(stat(g, 'tl', p)) },
    { key: 'tt', label: 'T↓', title: 'Time trailing', width: 60, value: (g, p) => stat(g, 'tt', p), render: (g, p) => mmss(stat(g, 'tt', p)) },
    { key: 'ctrl', label: 'Ctrl', title: 'Game-control score', width: 60, value: (g, p) => stat(g, 'ctrl', p), render: (g, p) => stat(g, 'ctrl', p).toFixed(3) },
    { key: 'en', label: 'EN', title: 'Empty-net goals for / attempts', width: 56, fullGame: true, value: g => g.engf, render: g => (g.enatt ? `${g.engf}/${g.enatt}` : '—') },
    { key: 'flags', label: 'Story', title: 'Blown leads, comebacks and lead-state results', width: 120, value: () => 0, render: g => <Flags g={g} /> },
];

function lastName(n: string) {
    return n ? n.split(' ').slice(-1)[0] : '—';
}

function ResultChip({ g }: { g: GameRow }) {
    return <span className={cn('inline-flex min-w-9 justify-center rounded-chip px-1.5 py-0.5 text-caption font-bold', TONE[resultTone(g)])}>{resultLabel(g)}</span>;
}

function Flags({ g }: { g: GameRow }) {
    const f = flags(g);
    const items = [
        f.cw && (f.cw3p ? 'Comeback (3P)' : 'Comeback'),
        f.bl && (f.bl3p ? 'Blown lead (3P)' : 'Blown lead'),
        f.ntw && 'Never trailed',
        f.nlw && 'Never led',
    ].filter(Boolean) as string[];
    if (!items.length) return <span className="text-fg-3">—</span>;
    return <span className="text-caption text-fg-2">{items.join(' · ')}</span>;
}

/**
 * The team game log: card rows on phones (date, opponent, result, score, xG
 * bar), a full table from md up with one sticky column, a header that
 * follows the page, sortable header buttons and a disclosure button per
 * row that loads that game's boxscore.
 */
export default function GamesLogTable({ games, period, seasonLabel, teamColor, loadBoxscores }: GamesLogTableProps) {
    const [sort, setSort] = React.useState<{ key: string; dir: SortDir } | null>(null);
    const [open, setOpen] = React.useState<Set<string>>(new Set());
    const [box, setBox] = React.useState<Boxscores | null>(null);
    const [boxState, setBoxState] = React.useState<'idle' | 'loading' | 'error'>('idle');
    const tableRef = React.useRef<HTMLTableElement>(null);

    const sorted = React.useMemo(() => {
        if (!sort) return games;
        const col = COLS.find(c => c.key === sort.key);
        const val = (g: GameRow) => (sort.key === 'date' ? g.date : col ? col.value(g, period) : 0);
        return [...games].sort((a, b) => {
            const va = val(a);
            const vb = val(b);
            const c = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number);
            return sort.dir === 'asc' ? c : -c;
        });
    }, [games, sort, period]);

    const t = React.useMemo(() => totals(games, period), [games, period]);
    useStickyHeader(tableRef, [sorted.length, period]);

    const toggle = (id: string) => {
        setOpen(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
        if (!box && boxState !== 'loading') {
            setBoxState('loading');
            loadBoxscores()
                .then(b => {
                    setBox(b ?? { players: {}, games: {} });
                    setBoxState('idle');
                })
                .catch(() => setBoxState('error'));
        }
    };
    const onSort = (key: string) => setSort(s => (s?.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }));
    const cols = COLS.filter(c => !(period !== 'All' && c.fullGame));

    const xgPct = t.xgf + t.xga > 0 ? (t.xgf / (t.xgf + t.xga)) * 100 : null;

    return (
        <div className="flex flex-col gap-3">
            {/* summary of the filtered games */}
            <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-control border border-line bg-line text-center sm:grid-cols-6">
                {[
                    ['Record', `${t.w}-${t.l}-${t.otl}`],
                    ['Points', `${t.pts} · ${t.gp ? pct3(t.pts / (t.gp * 2)) : '—'}`],
                    ['Goals', t.gp ? `${(t.gf / t.gp).toFixed(2)}–${(t.ga / t.gp).toFixed(2)}` : '—'],
                    ['xGF%', xgPct == null ? '—' : `${xgPct.toFixed(1)}%`],
                    ['PP / PK', period === 'All' && t.gp ? `${t.ppo ? ((t.ppg / t.ppo) * 100).toFixed(1) : '—'}% / ${t.pko ? (100 - (t.ppga / t.pko) * 100).toFixed(1) : '—'}%` : '—'],
                    ['GSAx', t.gp ? signed(t.gsax, 1) : '—'],
                ].map(([k, v]) => (
                    <div key={k} className="bg-surface-1 px-2 py-2">
                        <dt className="text-micro text-fg-3">{k}</dt>
                        <dd className="text-body-sm font-semibold tabular-nums text-fg-1">{v}</dd>
                    </div>
                ))}
            </dl>

            {games.length === 0 ? (
                <p className="rounded-control border border-dashed border-line-strong p-6 text-center text-body-sm text-fg-2">No {seasonLabel} games match these filters.</p>
            ) : (
                <>
                    {/* phones: card rows */}
                    <ol className="flex flex-col gap-1.5 md:hidden" aria-label={`${seasonLabel} games`}>
                        {sorted.map(g => {
                            const [gf, ga] = score(g, period);
                            const xf = stat(g, 'xgf', period);
                            const xa = stat(g, 'xga', period);
                            const share = xf + xa > 0 ? (xf / (xf + xa)) * 100 : 50;
                            const isOpen = open.has(g.id);
                            return (
                                <li key={g.id} className="overflow-hidden rounded-control border border-line bg-surface-1">
                                    <button
                                        type="button"
                                        aria-expanded={isOpen}
                                        aria-controls={`box-m-${g.id}`}
                                        onClick={() => toggle(g.id)}
                                        className="grid min-h-14 w-full grid-cols-[52px_28px_minmax(0,1fr)_auto_auto] items-center gap-2 px-3 py-2 text-left hover:bg-surface-2"
                                    >
                                        <span className="text-caption tabular-nums text-fg-2">{shortDate(g.date)}</span>
                                        {/* eslint-disable-next-line @next/next/no-img-element -- static SVG logo; next/image adds ~6KB of client JS for no optimisation */}
                                        <img src={`/logos/${g.opp}.svg`} alt="" width={28} height={28} className="h-7 w-7 object-contain" loading="lazy" decoding="async" />
                                        <span className="min-w-0">
                                            <span className="block text-body-sm font-semibold text-fg-1">
                                                {g.home ? 'vs' : '@'} {g.opp}
                                            </span>
                                            <span className="mt-1 flex h-1.5 w-full max-w-[140px] overflow-hidden rounded-full bg-fg-3/25" aria-hidden="true">
                                                <span className="h-full" style={{ width: `${share}%`, background: teamColor }} />
                                            </span>
                                            <span className="sr-only">
                                                Expected goals {xf.toFixed(1)} to {xa.toFixed(1)}
                                            </span>
                                        </span>
                                        <ResultChip g={g} />
                                        <span className="w-10 text-right text-body-sm font-semibold tabular-nums text-fg-1">
                                            {gf}–{ga}
                                        </span>
                                    </button>
                                    {isOpen ? (
                                        <div id={`box-m-${g.id}`} className="border-t border-line bg-surface-2/50 p-3">
                                            <MiniStats g={g} period={period} />
                                            <Boxscore rows={box?.games[g.id]} players={box?.players} state={boxState} />
                                        </div>
                                    ) : null}
                                </li>
                            );
                        })}
                    </ol>

                    {/* md+: full table */}
                    <ScrollRegion label={`${seasonLabel} game log table`} className="hidden rounded-card border border-line bg-surface-1 md:block">
                        <table
                            ref={tableRef}
                            className="table-fixed border-separate border-spacing-0 text-body-sm"
                            style={{ width: 172 + cols.reduce((w, c) => w + c.width, 0), minWidth: '100%' }}
                        >
                            <caption className="sr-only">{seasonLabel} game log. Use the buttons in the first column to show a game’s boxscore.</caption>
                            <colgroup>
                                <col style={{ width: 172 }} />
                                {cols.map(c => (
                                    <col key={c.key} style={{ width: c.width }} />
                                ))}
                            </colgroup>
                            <thead className="[--thead-y:0px]">
                                <tr>
                                    <HeaderCell
                                        label="Game"
                                        title="Date and opponent"
                                        align="left"
                                        direction={sort?.key === 'date' ? sort.dir : null}
                                        onSort={() => onSort('date')}
                                        className={cn(HEAD, 'sticky left-0 z-[4] border-r shadow-[4px_0_8px_-6px_rgba(0,0,0,0.8)]')}
                                    />
                                    {cols.map(c => (
                                        <HeaderCell
                                            key={c.key}
                                            label={c.label}
                                            title={c.title}
                                            direction={c.key === 'starter' || c.key === 'oppStarter' || c.key === 'flags' ? undefined : sort?.key === c.key ? sort.dir : null}
                                            onSort={c.key === 'starter' || c.key === 'oppStarter' || c.key === 'flags' ? undefined : () => onSort(c.key)}
                                            className={cn(HEAD, 'relative z-[3]')}
                                        />
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {sorted.map((g, i) => {
                                    const isOpen = open.has(g.id);
                                    const zebra = i % 2 ? 'bg-surface-2/40' : '';
                                    return (
                                        <React.Fragment key={g.id}>
                                            <tr className="group">
                                                <th scope="row" className="sticky left-0 z-[2] border-b border-r border-line bg-surface-1 p-0 text-left font-normal shadow-[4px_0_8px_-6px_rgba(0,0,0,0.8)] group-hover:bg-surface-2">
                                                    <button
                                                        type="button"
                                                        aria-expanded={isOpen}
                                                        aria-controls={`box-${g.id}`}
                                                        onClick={() => toggle(g.id)}
                                                        className="flex min-h-10 w-full items-center gap-2 px-2 text-left"
                                                    >
                                                        <svg aria-hidden="true" viewBox="0 0 12 12" className={cn('h-3 w-3 shrink-0 text-fg-3 transition-transform', isOpen && 'rotate-90')}>
                                                            <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
                                                        </svg>
                                                        <span className="w-12 shrink-0 text-caption tabular-nums text-fg-2">{shortDate(g.date)}</span>
                                                        {/* eslint-disable-next-line @next/next/no-img-element -- static SVG logo; next/image adds ~6KB of client JS for no optimisation */}
                                                        <img src={`/logos/${g.opp}.svg`} alt="" width={22} height={22} className="h-5 w-5 shrink-0 object-contain" loading="lazy" decoding="async" />
                                                        <span className="whitespace-nowrap font-semibold text-fg-1">
                                                            {g.home ? 'vs' : '@'} {g.opp}
                                                        </span>
                                                        <span className="sr-only">, show boxscore</span>
                                                    </button>
                                                </th>
                                                {cols.map(c => (
                                                    <td key={c.key} className={cn('border-b border-line px-1.5 py-1 text-center tabular-nums text-fg-1 group-hover:bg-surface-2', zebra, c.tone?.(g, period), c.key === 'starter' || c.key === 'oppStarter' ? 'truncate text-left text-fg-2' : '')}>
                                                        {c.render(g, period)}
                                                    </td>
                                                ))}
                                            </tr>
                                            {isOpen ? (
                                                <tr>
                                                    <td id={`box-${g.id}`} colSpan={cols.length + 1} className="border-b border-line bg-surface-2/50 p-0">
                                                        <div className="sticky left-0 max-w-[min(100vw-4rem,1100px)] p-4" style={{ borderLeft: `3px solid ${teamColor}` }}>
                                                            <Boxscore rows={box?.games[g.id]} players={box?.players} state={boxState} />
                                                        </div>
                                                    </td>
                                                </tr>
                                            ) : null}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </ScrollRegion>
                </>
            )}
        </div>
    );
}

const HEAD = 'bg-surface-2 border-b border-line [transform:translateY(var(--thead-y))]';

function MiniStats({ g, period }: { g: GameRow; period: PeriodFilter }) {
    const items: [string, React.ReactNode][] = [
        ['Shots', `${stat(g, 'sf', period)}–${stat(g, 'sa', period)}`],
        ['xG', `${stat(g, 'xgf', period).toFixed(2)}–${stat(g, 'xga', period).toFixed(2)}`],
        ['High danger', `${stat(g, 'hdf', period)}–${stat(g, 'hda', period)}`],
        ['PP / PK', period === 'All' ? `${g.ppg}/${g.ppo} · ${g.ppga}/${g.pko}` : '—'],
        ['Goalies', `${lastName(g.starter)} vs ${lastName(g.oppStarter)}`],
    ];
    return (
        <dl className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-caption">
            {items.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                    <dt className="text-fg-3">{k}</dt>
                    <dd className="tabular-nums text-fg-1">{v}</dd>
                </div>
            ))}
        </dl>
    );
}

function Boxscore({ rows, players, state }: { rows: BoxRow[] | undefined; players?: Boxscores['players']; state: 'idle' | 'loading' | 'error' }) {
    if (state === 'loading' && !rows) return <p className="text-caption text-fg-2">Loading boxscore…</p>;
    if (state === 'error') return <p className="text-caption text-neg">Could not load the boxscore.</p>;
    if (!rows || rows.length === 0) return <p className="text-caption text-fg-3">No player boxscore for this game.</p>;
    const who = (id: string) => players?.[id] ?? [id, 0, ''];
    const skaters = rows.filter(r => r[7] === 0).sort((a, b) => b[3] - a[3] || b[1] - a[1]);
    const goalies = rows.filter(r => r[7] === 1);
    return (
        <div className="flex flex-col gap-3">
            {goalies.length ? (
                <p className="text-caption text-fg-2">
                    {goalies.map(r => `${who(r[0])[0]} ${r[9]}/${r[8]} saves (${r[5]})`).join(' · ')}
                </p>
            ) : null}
            <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-caption">
                    <caption className="sr-only">Skater boxscore</caption>
                    <thead className="text-fg-3">
                        <tr>
                            {['Player', 'G', 'A', 'P', '+/−', 'SOG', 'TOI'].map(h => (
                                <th key={h} scope="col" className={cn('px-2 py-1 font-semibold', h === 'Player' ? 'text-left' : 'text-right')}>
                                    {h}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {skaters.map(r => {
                            const [name, num] = who(r[0]);
                            return (
                                <tr key={r[0]} className="border-t border-line">
                                    <th scope="row" className="px-2 py-1 text-left font-normal text-fg-1">
                                        {num ? <span className="mr-1 text-fg-3">#{num}</span> : null}
                                        {name}
                                    </th>
                                    <td className="px-2 py-1 text-right tabular-nums">{r[1]}</td>
                                    <td className="px-2 py-1 text-right tabular-nums">{r[2]}</td>
                                    <td className="px-2 py-1 text-right font-semibold tabular-nums">{r[3]}</td>
                                    <td className={cn('px-2 py-1 text-right tabular-nums', diffTone(r[4]))}>{signed(r[4])}</td>
                                    <td className="px-2 py-1 text-right tabular-nums">{r[6]}</td>
                                    <td className="px-2 py-1 text-right tabular-nums text-fg-2">{r[5]}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
