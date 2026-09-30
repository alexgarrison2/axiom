'use client';

import * as React from 'react';
import { Crest } from '@/components/ui/crest';
import { ScrollRegion } from '@/components/ui/scroll-region';
import { cn } from '@/lib/utils';
import { mmss, pct3, shortDate, signed } from '@/utils/team-stats/format';
import type { Boxscores, BoxRow } from '@/utils/team-stats/team-types';
import type { GameRow, PeriodFilter } from '@/utils/team-stats/types';
import { HeaderCell, type SortDir } from '@/components/teams-table/HeaderCell';
import { CELL_BG, HEAD_CELL, STICKY_EDGE } from '@/components/teams-table/table-style';
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
    win: 'text-pos',
    otl: 'text-warn',
    loss: 'text-neg',
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
    { key: 'res', label: 'Res', title: 'Result', width: 56, value: g => (resultTone(g) === 'win' ? 2 : resultTone(g) === 'otl' ? 1 : 0), render: g => <ResultChip g={g} /> },
    { key: 'score', label: 'Score', title: 'Goals for – against', width: 60, value: (g, p) => score(g, p)[0] - score(g, p)[1], render: (g, p) => <span className="font-bold">{score(g, p).join('–')}</span> },
    { key: 'starter', label: 'G', title: 'Starting goalie', width: 96, value: () => 0, render: g => lastName(g.starter) },
    { key: 'oppStarter', label: 'Opp G', title: "Opponent's starting goalie", width: 96, value: () => 0, render: g => lastName(g.oppStarter) },
    { key: 'pp', label: 'PP', title: 'Power-play goals / opportunities', width: 52, fullGame: true, value: g => (g.ppo ? g.ppg / g.ppo : -1), render: g => `${g.ppg}/${g.ppo}` },
    { key: 'pk', label: 'PK', title: 'Power-play goals allowed / times shorthanded', width: 52, fullGame: true, value: g => (g.pko ? 1 - g.ppga / g.pko : 2), render: g => `${g.ppga}/${g.pko}` },
    { key: 'sf', label: 'SF', title: 'Shots for', width: 46, value: (g, p) => stat(g, 'sf', p), render: (g, p) => stat(g, 'sf', p) },
    { key: 'sa', label: 'SA', title: 'Shots against', width: 46, value: (g, p) => stat(g, 'sa', p), render: (g, p) => stat(g, 'sa', p) },
    { key: 'sd', label: 'SΔ', title: 'Shot differential', width: 50, value: (g, p) => stat(g, 'sf', p) - stat(g, 'sa', p), render: (g, p) => signed(stat(g, 'sf', p) - stat(g, 'sa', p)), tone: (g, p) => diffTone(stat(g, 'sf', p) - stat(g, 'sa', p)) },
    { key: 'cf', label: 'CF', title: 'Shot attempts for', width: 46, value: (g, p) => stat(g, 'cf', p), render: (g, p) => stat(g, 'cf', p) },
    { key: 'ca', label: 'CA', title: 'Shot attempts against', width: 46, value: (g, p) => stat(g, 'ca', p), render: (g, p) => stat(g, 'ca', p) },
    { key: 'hdf', label: 'HDF', title: 'High-danger chances for', width: 50, value: (g, p) => stat(g, 'hdf', p), render: (g, p) => stat(g, 'hdf', p) },
    { key: 'hda', label: 'HDA', title: 'High-danger chances against', width: 50, value: (g, p) => stat(g, 'hda', p), render: (g, p) => stat(g, 'hda', p) },
    { key: 'xgf', label: 'xGF', title: 'Expected goals for', width: 52, value: (g, p) => stat(g, 'xgf', p), render: (g, p) => stat(g, 'xgf', p).toFixed(2) },
    { key: 'xga', label: 'xGA', title: 'Expected goals against', width: 52, value: (g, p) => stat(g, 'xga', p), render: (g, p) => stat(g, 'xga', p).toFixed(2) },
    { key: 'xgd', label: 'xGΔ', title: 'Expected-goal differential', width: 56, value: (g, p) => stat(g, 'xgf', p) - stat(g, 'xga', p), render: (g, p) => signed(stat(g, 'xgf', p) - stat(g, 'xga', p), 2), tone: (g, p) => diffTone(stat(g, 'xgf', p) - stat(g, 'xga', p)) },
    {
        key: 'sv', label: 'Sv%', title: 'Save percentage', width: 56,
        value: (g, p) => { const sa = stat(g, 'sa', p) - (p === 'All' ? g.enga : 0); return sa > 0 ? (stat(g, 'sa', p) - stat(g, 'ga', p)) / sa : 0; },
        render: (g, p) => { const sa = stat(g, 'sa', p) - (p === 'All' ? g.enga : 0); return sa > 0 ? pct3((stat(g, 'sa', p) - stat(g, 'ga', p)) / sa) : '—'; },
    },
    {
        key: 'gsax', label: 'GSAx', title: 'Goals saved above expected', width: 58,
        value: (g, p) => gameGsax(g, p),
        render: (g, p) => signed(gameGsax(g, p), 2),
        tone: (g, p) => diffTone(gameGsax(g, p)),
    },
    { key: 'tl', label: 'T↑', title: 'Time leading', width: 54, value: (g, p) => stat(g, 'tl', p), render: (g, p) => mmss(stat(g, 'tl', p)) },
    { key: 'tt', label: 'T↓', title: 'Time trailing', width: 54, value: (g, p) => stat(g, 'tt', p), render: (g, p) => mmss(stat(g, 'tt', p)) },
    { key: 'ctrl', label: 'Ctrl', title: 'Game-control score', width: 56, value: (g, p) => stat(g, 'ctrl', p), render: (g, p) => stat(g, 'ctrl', p).toFixed(3) },
    { key: 'en', label: 'EN', title: 'Empty-net goals for / attempts', width: 48, fullGame: true, value: g => g.engf, render: g => (g.enatt ? `${g.engf}/${g.enatt}` : '—') },
    { key: 'flags', label: 'Flags', title: 'CW comeback win · BL blown lead · 3P in the third · NTW never trailed · NLW never led', width: 96, value: () => 0, render: g => <Flags g={g} /> },
];

const UNSORTABLE = new Set(['starter', 'oppStarter', 'flags']);
const GAME_COL = 150;

function lastName(n: string) {
    return n ? n.split(' ').slice(-1)[0] : '—';
}

function ResultChip({ g }: { g: GameRow }) {
    return <span className={cn('inline-block min-w-8 text-center font-bold uppercase', TONE[resultTone(g)])}>{resultLabel(g)}</span>;
}

/** Story codes that match the league table's columns (CW, BL, NTW, NLW). */
function Flags({ g }: { g: GameRow }) {
    const f = flags(g);
    const items: [string, string][] = [];
    if (f.cw) items.push([f.cw3p ? 'CW3P' : 'CW', 'text-pos']);
    if (f.bl) items.push([f.bl3p ? 'BL3P' : 'BL', 'text-neg']);
    if (f.ntw) items.push(['NTW', 'text-fg-2']);
    if (f.nlw) items.push(['NLW', 'text-fg-2']);
    if (!items.length) return <span className="text-fg-disabled">—</span>;
    return (
        <span className="inline-flex gap-1.5 text-micro font-bold">
            {items.map(([t, c]) => (
                <span key={t} className={c}>
                    {t}
                </span>
            ))}
        </span>
    );
}

/**
 * The team game log: a summary strip, compact card rows on phones, and from
 * md up a dense table with one sticky column, a header that follows the page,
 * sortable header buttons and a disclosure per row that loads the boxscore.
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
    const summary: [string, React.ReactNode, React.ReactNode?][] = [
        ['Record', `${t.w}-${t.l}-${t.otl}`],
        ['PTS', t.pts, t.gp ? pct3(t.pts / (t.gp * 2)) : null],
        ['GF–GA/GP', t.gp ? `${(t.gf / t.gp).toFixed(2)}–${(t.ga / t.gp).toFixed(2)}` : '—'],
        ['xGF%', xgPct == null ? '—' : xgPct.toFixed(1)],
        ['PP/PK', period === 'All' && t.gp ? `${t.ppo ? ((t.ppg / t.ppo) * 100).toFixed(0) : '—'}/${t.pko ? (100 - (t.ppga / t.pko) * 100).toFixed(0) : '—'}` : '—'],
        ['GSAx', t.gp ? signed(t.gsax, 1) : '—'],
    ];

    return (
        <div className="flex flex-col gap-2">
            <dl className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {summary.map(([k, v, sub]) => (
                    <div key={k} className="tile min-w-0 px-2.5 py-1.5">
                        <dt className="label">{k}</dt>
                        <dd className="flex items-baseline gap-1.5 truncate font-display text-[18px] font-bold leading-6 tabular-nums text-fg-1">
                            {v}
                            {sub ? <span className="font-mono text-micro font-medium text-fg-3">{sub}</span> : null}
                        </dd>
                    </div>
                ))}
            </dl>

            {games.length === 0 ? (
                <p className="panel p-card text-center">
                    <span className="label">No games</span>
                    <span className="sr-only"> in {seasonLabel} match these filters</span>
                </p>
            ) : (
                <>
                    {/* phones: compact rows */}
                    <ol className="panel flex flex-col overflow-hidden md:hidden" aria-label={`${seasonLabel} games`}>
                        {sorted.map(g => {
                            const [gf, ga] = score(g, period);
                            const xf = stat(g, 'xgf', period);
                            const xa = stat(g, 'xga', period);
                            const share = xf + xa > 0 ? (xf / (xf + xa)) * 100 : 50;
                            const isOpen = open.has(g.id);
                            return (
                                <li key={g.id} className="border-b border-line last:border-b-0 even:bg-[color-mix(in_srgb,var(--line)_40%,transparent)]">
                                    <button
                                        type="button"
                                        aria-expanded={isOpen}
                                        aria-controls={`box-m-${g.id}`}
                                        onClick={() => toggle(g.id)}
                                        className="grid min-h-11 w-full grid-cols-[46px_22px_minmax(0,1fr)_44px_44px] items-center gap-2 px-3 text-left text-caption"
                                    >
                                        <span className="text-micro uppercase text-fg-3">{shortDate(g.date)}</span>
                                        <Crest tri={g.opp} size={22} className="drop-shadow-none" />
                                        <span className="min-w-0">
                                            <span className="block font-bold text-fg-1">
                                                <span className="font-normal text-fg-3">{g.home ? 'vs' : '@'}</span> {g.opp}
                                            </span>
                                            <span className="mt-0.5 flex h-1 w-full max-w-[120px] overflow-hidden rounded-full bg-line" aria-hidden="true">
                                                <span className="h-full" style={{ width: `${share}%`, background: teamColor }} />
                                            </span>
                                            <span className="sr-only">
                                                xG {xf.toFixed(1)} to {xa.toFixed(1)}
                                            </span>
                                        </span>
                                        <ResultChip g={g} />
                                        <span className="text-right font-bold tabular-nums text-fg-1">
                                            {gf}–{ga}
                                        </span>
                                    </button>
                                    {isOpen ? (
                                        <div id={`box-m-${g.id}`} className="border-t border-line bg-bg/60 p-3">
                                            <MiniStats g={g} period={period} />
                                            <Boxscore rows={box?.games[g.id]} players={box?.players} state={boxState} />
                                        </div>
                                    ) : null}
                                </li>
                            );
                        })}
                    </ol>

                    {/* md+: dense table */}
                    <ScrollRegion label={`${seasonLabel} game log table`} className="hidden rounded-card border border-line bg-surface-1 md:block">
                        <table
                            ref={tableRef}
                            className="table-fixed border-separate border-spacing-0 font-mono text-caption tabular-nums"
                            style={{ width: GAME_COL + cols.reduce((w, c) => w + c.width, 0), minWidth: '100%' }}
                        >
                            <caption className="sr-only">{seasonLabel} game log. The first-column buttons show each boxscore.</caption>
                            <colgroup>
                                <col style={{ width: GAME_COL }} />
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
                                        className={cn(HEAD_CELL, STICKY_EDGE, 'z-[4] pl-2')}
                                    />
                                    {cols.map(c => (
                                        <HeaderCell
                                            key={c.key}
                                            label={c.label}
                                            title={c.title}
                                            align={UNSORTABLE.has(c.key) ? 'left' : 'center'}
                                            direction={UNSORTABLE.has(c.key) ? undefined : sort?.key === c.key ? sort.dir : null}
                                            onSort={UNSORTABLE.has(c.key) ? undefined : () => onSort(c.key)}
                                            className={cn(HEAD_CELL, 'relative z-[3]')}
                                        />
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {sorted.map(g => {
                                    const isOpen = open.has(g.id);
                                    return (
                                        <React.Fragment key={g.id}>
                                            <tr className="group">
                                                <th scope="row" className={cn(STICKY_EDGE, CELL_BG, 'z-[2] h-8 border-b p-0 text-left font-normal')}>
                                                    <button
                                                        type="button"
                                                        aria-expanded={isOpen}
                                                        aria-controls={`box-${g.id}`}
                                                        onClick={() => toggle(g.id)}
                                                        className="flex h-8 w-full items-center gap-2 px-2 text-left focus-visible:outline-offset-[-2px]"
                                                    >
                                                        <svg aria-hidden="true" viewBox="0 0 12 12" className={cn('h-2.5 w-2.5 shrink-0 text-fg-3 transition-transform', isOpen && 'rotate-90 text-brand')}>
                                                            <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
                                                        </svg>
                                                        <span className="w-11 shrink-0 text-micro uppercase text-fg-3">{shortDate(g.date)}</span>
                                                        <Crest tri={g.opp} size={18} className="drop-shadow-none" />
                                                        <span className="whitespace-nowrap font-bold text-fg-1">
                                                            <span className="font-normal text-fg-3">{g.home ? 'vs' : '@'}</span> {g.opp}
                                                        </span>
                                                        <span className="sr-only">, show boxscore</span>
                                                    </button>
                                                </th>
                                                {cols.map(c => (
                                                    <td
                                                        key={c.key}
                                                        className={cn(
                                                            CELL_BG,
                                                            'h-8 border-b border-line px-1.5 text-center text-fg-1',
                                                            c.tone?.(g, period),
                                                            UNSORTABLE.has(c.key) && 'truncate text-left text-fg-2',
                                                        )}
                                                    >
                                                        {c.render(g, period)}
                                                    </td>
                                                ))}
                                            </tr>
                                            {isOpen ? (
                                                <tr>
                                                    <td id={`box-${g.id}`} colSpan={cols.length + 1} className="border-b border-line bg-bg/60 p-0">
                                                        <div className="sticky left-0 max-w-[min(100vw-4rem,1000px)] px-3 py-2.5" style={{ borderLeft: `2px solid ${teamColor}` }}>
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

function MiniStats({ g, period }: { g: GameRow; period: PeriodFilter }) {
    const items: [string, React.ReactNode][] = [
        ['Shots', `${stat(g, 'sf', period)}–${stat(g, 'sa', period)}`],
        ['xG', `${stat(g, 'xgf', period).toFixed(2)}–${stat(g, 'xga', period).toFixed(2)}`],
        ['HD', `${stat(g, 'hdf', period)}–${stat(g, 'hda', period)}`],
        ['PP/PK', period === 'All' ? `${g.ppg}/${g.ppo} · ${g.ppga}/${g.pko}` : '—'],
        ['G', `${lastName(g.starter)} · ${lastName(g.oppStarter)}`],
    ];
    return (
        <dl className="mb-2.5 grid grid-cols-2 gap-x-4 gap-y-1 text-caption">
            {items.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                    <dt className="label">{k}</dt>
                    <dd className="truncate tabular-nums text-fg-1">{v}</dd>
                </div>
            ))}
        </dl>
    );
}

function Boxscore({ rows, players, state }: { rows: BoxRow[] | undefined; players?: Boxscores['players']; state: 'idle' | 'loading' | 'error' }) {
    if (state === 'loading' && !rows) return <p className="label">Loading</p>;
    if (state === 'error') return <p className="label text-neg">Boxscore unavailable</p>;
    if (!rows || rows.length === 0) return <p className="label">No boxscore</p>;
    const who = (id: string) => players?.[id] ?? [id, 0, ''];
    const skaters = rows.filter(r => r[7] === 0).sort((a, b) => b[3] - a[3] || b[1] - a[1]);
    const goalies = rows.filter(r => r[7] === 1);
    return (
        <div className="flex flex-col gap-2">
            {goalies.length ? (
                <p className="flex flex-wrap gap-x-4 text-caption">
                    {goalies.map(r => (
                        <span key={r[0]}>
                            <span className="font-display text-[14px] font-semibold uppercase text-fg-1">{who(r[0])[0]}</span>{' '}
                            <span className="tabular-nums text-fg-2">
                                {r[9]}/{r[8]} SV
                            </span>{' '}
                            <span className="text-micro text-fg-3">{r[5]}</span>
                        </span>
                    ))}
                </p>
            ) : null}
            <ScrollRegion label="Skater boxscore">
                <table className="w-full min-w-[400px] font-mono text-caption tabular-nums">
                    <caption className="sr-only">Skater boxscore</caption>
                    <thead>
                        <tr>
                            {['Player', 'G', 'A', 'P', '+/−', 'SOG', 'TOI'].map(h => (
                                <th key={h} scope="col" className={cn('h-7 px-2 text-micro font-medium uppercase tracking-[0.1em] text-fg-3', h === 'Player' ? 'text-left' : 'text-right')}>
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
                                    <th scope="row" className="h-7 px-2 text-left font-normal text-fg-1">
                                        {num ? <span className="mr-1.5 text-fg-3">{num}</span> : null}
                                        {name}
                                    </th>
                                    <td className="px-2 text-right">{r[1]}</td>
                                    <td className="px-2 text-right">{r[2]}</td>
                                    <td className="px-2 text-right font-bold">{r[3]}</td>
                                    <td className={cn('px-2 text-right', diffTone(r[4]))}>{signed(r[4])}</td>
                                    <td className="px-2 text-right">{r[6]}</td>
                                    <td className="px-2 text-right text-fg-2">{r[5]}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </ScrollRegion>
        </div>
    );
}
