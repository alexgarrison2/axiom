'use client';

import * as React from 'react';
import Link from 'next/link';
import { Crest } from '@/components/ui/crest';
import { ScrollRegion } from '@/components/ui/scroll-region';
import { cn } from '@/lib/utils';
import { mmss, pct3, shortDate, signed } from '@/utils/team-stats/format';
import type { Boxscores, BoxRow } from '@/utils/team-stats/team-types';
import type { GameRow, PeriodFilter } from '@/utils/team-stats/types';
import { HeaderCell, type SortDir } from '@/components/teams-table/HeaderCell';
import { CELL_BG, HEAD_CELL, STICKY_EDGE } from '@/components/teams-table/table-style';
import { PINNED_HEAD_HIDE, StickyHead, TableScroller } from '@/components/teams-table/TableScroller';
import { flags, gameGsax, resultLabel, resultTone, score, stat, totals } from './game-log-model';

/** Into the full game page (/games/[id]): goals, pulse, shots, skaters, lines, matchups. */
function GameLink({ id }: { id: string }) {
    return (
        <Link
            href={`/games/${id}`}
            className="mb-2 inline-flex min-h-8 items-center gap-1.5 text-micro font-bold uppercase tracking-label text-brand hover:underline coarse:min-h-11"
        >
            Game page
            <svg viewBox="0 0 8 8" className="h-2 w-2" aria-hidden="true">
                <path d="M2.5 1 6 4 2.5 7" fill="none" stroke="currentColor" strokeWidth="1.4" />
            </svg>
        </Link>
    );
}

interface GamesLogTableProps {
    games: GameRow[];
    /** Summary tiles; off when they would repeat the hero (unfiltered current season). */
    showSummary?: boolean;
    period: PeriodFilter;
    seasonLabel: string;
    teamColor: string;
    /** Loads per-game player rows on demand (boxscore expansion). */
    loadBoxscores: () => Promise<Boxscores | undefined>;
}

const TONE: Record<string, string> = {
    win: 'text-pos',
    otl: 'text-neg/70',
    loss: 'text-neg',
};

type Group = 'Result' | 'Goalies' | 'PP · PK' | 'Play' | 'Goaltending' | 'Game state';

interface Col {
    key: string;
    label: string;
    title: string;
    width: number;
    group: Group;
    value: (g: GameRow, p: PeriodFilter) => number;
    render: (g: GameRow, p: PeriodFilter, ctx: CellCtx) => React.ReactNode;
    /** The season-to-date cell over the shown games (per game where that reads better). */
    avg?: (t: ReturnType<typeof totals>, games: GameRow[], p: PeriodFilter, ctx: CellCtx) => React.ReactNode;
    fullGame?: boolean;
    tone?: (g: GameRow, p: PeriodFilter) => string | undefined;
    align?: 'left' | 'center';
}

/** What a paired cell needs beyond the game: the team colour and each pair's largest side over the shown games. */
interface CellCtx {
    color: string;
    max: Record<PairKey, number>;
}

type PairKey = 'shots' | 'att' | 'hd' | 'xg';
const PAIRS: Record<PairKey, { f: 'sf' | 'cf' | 'hdf' | 'xgf'; a: 'sa' | 'ca' | 'hda' | 'xga'; label: string; title: string; dp: number }> = {
    shots: { f: 'sf', a: 'sa', label: 'Shots', title: 'Shots on goal for · against (sorts by the difference)', dp: 0 },
    att: { f: 'cf', a: 'ca', label: 'Attempts', title: 'Shot attempts for · against (sorts by the difference)', dp: 0 },
    hd: { f: 'hdf', a: 'hda', label: 'HD', title: 'High-danger chances for · against (sorts by the difference)', dp: 0 },
    xg: { f: 'xgf', a: 'xga', label: 'xG', title: 'Expected goals for · against (sorts by the difference)', dp: 2 },
};

const diffTone = (v: number) => (v > 0 ? 'text-pos' : v < 0 ? 'text-neg' : 'text-fg-2');

/**
 * For and against in one cell: the numbers sit on their own side, and a mirrored bar grows out from the centre
 * on each side (team colour for, dim for against), scaled to the largest value in the column, the leader at full
 * strength. A whole column reads as a shape: which nights the team drove play, and by how much.
 */
function Pair({ f, a, dp, max, color, model }: { f: number; a: number; dp: number; max: number; color: string; model?: boolean }) {
    const fmt = (v: number) => (dp ? v.toFixed(dp) : String(Math.round(v)));
    const lead = f === a ? null : f > a ? 'f' : 'a';
    const w = (v: number) => `${Math.min(100, (v / Math.max(max, 1e-9)) * 100)}%`;
    return (
        <span className="grid grid-cols-[2.25rem_minmax(0,1fr)_2.25rem] items-center gap-1.5">
            <span className={cn('text-right', model ? 'text-model' : lead === 'f' ? 'font-bold text-fg-1' : 'text-fg-2')}>{fmt(f)}</span>
            <span className="flex h-2.5 items-stretch gap-px" aria-hidden="true">
                <span className="relative flex-1 overflow-hidden rounded-l-[2px] bg-track">
                    <span className="absolute inset-y-0 right-0" style={{ width: w(f), background: color, opacity: lead === 'f' ? 0.9 : 0.4 }} />
                </span>
                <span className="relative flex-1 overflow-hidden rounded-r-[2px] bg-track">
                    <span className="absolute inset-y-0 left-0 bg-fg-2" style={{ width: w(a), opacity: lead === 'a' ? 0.75 : 0.3 }} />
                </span>
            </span>
            <span className={cn('text-left', model ? 'text-model/80' : lead === 'a' ? 'font-bold text-fg-1' : 'text-fg-2')}>{fmt(a)}</span>
        </span>
    );
}

const pairCol = (k: PairKey): Col => {
    const p = PAIRS[k];
    return {
        key: k,
        label: p.label,
        title: p.title,
        width: k === 'xg' ? 132 : 118,
        group: 'Play',
        value: (g, per) => stat(g, p.f, per) - stat(g, p.a, per),
        render: (g, per, ctx) => <Pair f={stat(g, p.f, per)} a={stat(g, p.a, per)} dp={p.dp} max={ctx.max[k]} color={ctx.color} model={k === 'xg'} />,
        avg: (t, games, per, ctx) => {
            const n = Math.max(1, games.length);
            const f = games.reduce((s, g) => s + stat(g, p.f, per), 0) / n;
            const a = games.reduce((s, g) => s + stat(g, p.a, per), 0) / n;
            return <Pair f={f} a={a} dp={p.dp ? 2 : 1} max={ctx.max[k]} color={ctx.color} model={k === 'xg'} />;
        },
        align: 'center',
    };
};

const svOf = (g: GameRow, p: PeriodFilter) => {
    const sa = stat(g, 'sa', p) - (p === 'All' ? g.enga : 0);
    return sa > 0 ? (stat(g, 'sa', p) - stat(g, 'ga', p)) / sa : null;
};

const COLS: Col[] = [
    {
        key: 'res', label: 'Res', title: 'Result', width: 52, group: 'Result',
        value: g => (resultTone(g) === 'win' ? 2 : resultTone(g) === 'otl' ? 1 : 0),
        render: g => <ResultChip g={g} />,
        avg: t => <span className="font-bold text-fg-1">{t.w}-{t.l}-{t.otl}</span>,
    },
    {
        key: 'score', label: 'Score', title: 'Goals for – against', width: 60, group: 'Result',
        value: (g, p) => score(g, p)[0] - score(g, p)[1],
        render: (g, p) => <span className="font-bold">{score(g, p).join('–')}</span>,
        avg: (t, games) => (games.length ? <span className="font-bold">{(t.gf / games.length).toFixed(1)}–{(t.ga / games.length).toFixed(1)}</span> : '—'),
    },
    {
        key: 'starter', label: 'Ours · Opp', title: 'Starting goalies: ours, then the opponent\'s', width: 150, group: 'Goalies', value: () => 0, align: 'left',
        render: g => (
            <span className="block truncate">
                <span className="text-fg-1">{lastName(g.starter)}</span> <span className="text-fg-3">· {lastName(g.oppStarter)}</span>
            </span>
        ),
    },
    {
        key: 'pp', label: 'PP', title: 'Power-play goals / opportunities', width: 50, group: 'PP · PK', fullGame: true,
        value: g => (g.ppo ? g.ppg / g.ppo : -1), render: g => <span className={g.ppg ? 'font-bold text-fg-1' : 'text-fg-2'}>{`${g.ppg}/${g.ppo}`}</span>,
        avg: t => (t.ppo ? `${((t.ppg / t.ppo) * 100).toFixed(0)}%` : '—'),
    },
    {
        key: 'pk', label: 'PK', title: 'Power-play goals allowed / times shorthanded', width: 50, group: 'PP · PK', fullGame: true,
        value: g => (g.pko ? 1 - g.ppga / g.pko : 2), render: g => <span className={g.ppga ? 'text-fg-1' : 'text-fg-2'}>{`${g.ppga}/${g.pko}`}</span>,
        avg: t => (t.pko ? `${(100 - (t.ppga / t.pko) * 100).toFixed(0)}%` : '—'),
    },
    pairCol('shots'),
    pairCol('att'),
    pairCol('hd'),
    pairCol('xg'),
    {
        key: 'sv', label: 'Sv%', title: 'Save percentage (empty-net goals excluded)', width: 58, group: 'Goaltending',
        value: (g, p) => svOf(g, p) ?? 0,
        render: (g, p) => { const v = svOf(g, p); return v == null ? '—' : pct3(v); },
        avg: (t, games, p) => {
            const sa = games.reduce((s, g) => s + stat(g, 'sa', p) - (p === 'All' ? g.enga : 0), 0);
            const ga = games.reduce((s, g) => s + stat(g, 'ga', p) - (p === 'All' ? g.enga : 0), 0);
            return sa > 0 ? pct3((sa - ga) / sa) : '—';
        },
    },
    {
        key: 'gsax', label: 'GSAx', title: 'Goals saved above expected', width: 60, group: 'Goaltending',
        value: (g, p) => gameGsax(g, p),
        render: (g, p) => signed(gameGsax(g, p), 2),
        tone: (g, p) => diffTone(gameGsax(g, p)),
        avg: t => <span className={diffTone(t.gsax)}>{signed(t.gsax, 1)}</span>,
    },
    {
        key: 'tl', label: 'Lead', title: 'Time leading', width: 54, group: 'Game state',
        value: (g, p) => stat(g, 'tl', p), render: (g, p) => <TimeCell s={stat(g, 'tl', p)} />,
        avg: (t, games, p) => (games.length ? mmss(games.reduce((s, g) => s + stat(g, 'tl', p), 0) / games.length) : '—'),
    },
    {
        key: 'tt', label: 'Trail', title: 'Time trailing', width: 54, group: 'Game state',
        value: (g, p) => stat(g, 'tt', p), render: (g, p) => <TimeCell s={stat(g, 'tt', p)} />,
        avg: (t, games, p) => (games.length ? mmss(games.reduce((s, g) => s + stat(g, 'tt', p), 0) / games.length) : '—'),
    },
    {
        key: 'ctrl', label: 'Ctrl', title: 'Game-control score', width: 56, group: 'Game state',
        value: (g, p) => stat(g, 'ctrl', p), render: (g, p) => stat(g, 'ctrl', p).toFixed(3),
        avg: (t, games, p) => (games.length ? (games.reduce((s, g) => s + stat(g, 'ctrl', p), 0) / games.length).toFixed(3) : '—'),
    },
    { key: 'en', label: 'EN', title: 'Empty-net goals for / attempts', width: 46, group: 'Game state', fullGame: true, value: g => g.engf, render: g => (g.enatt ? `${g.engf}/${g.enatt}` : <span className="text-fg-disabled">—</span>) },
    { key: 'flags', label: 'Flags', title: 'CW comeback win · BL blown lead · 3P in the third · NTW never trailed · NLW never led', width: 78, group: 'Game state', value: () => 0, render: g => <Flags g={g} />, align: 'left' },
];

/** Zero time reads as a dim dash, so the nights a team never led or never trailed stand out. */
function TimeCell({ s }: { s: number }) {
    return s > 0 ? <>{mmss(s)}</> : <span className="text-fg-disabled">—</span>;
}

const UNSORTABLE = new Set(['starter', 'flags']);
const GAME_COL = 136;


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
export default function GamesLogTable({ games, showSummary = true, period, seasonLabel, teamColor, loadBoxscores }: GamesLogTableProps) {
    const [sort, setSort] = React.useState<{ key: string; dir: SortDir } | null>(null);
    const [open, setOpen] = React.useState<Set<string>>(new Set());
    const [box, setBox] = React.useState<Boxscores | null>(null);
    const [boxState, setBoxState] = React.useState<'idle' | 'loading' | 'error'>('idle');

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

    const headRef = React.useRef<HTMLDivElement>(null);
    const tableCls = 'table-fixed border-separate border-spacing-0 font-mono text-caption tabular-nums';
    const tableStyle = { width: GAME_COL + cols.reduce((w, c) => w + c.width, 0), minWidth: '100%' };
    const colgroup = (
        <colgroup>
            <col style={{ width: GAME_COL }} />
            {cols.map(c => (
                <col key={c.key} style={{ width: c.width }} />
            ))}
        </colgroup>
    );
    // Each pair column scales its bars to the largest side over the shown games.
    const ctx: CellCtx = React.useMemo(() => {
        const max = {} as Record<PairKey, number>;
        for (const k of Object.keys(PAIRS) as PairKey[]) max[k] = Math.max(0, ...games.flatMap(g => [stat(g, PAIRS[k].f, period), stat(g, PAIRS[k].a, period)]));
        return { color: teamColor, max };
    }, [games, period, teamColor]);
    // Group spans in column order; a hairline opens each group after the first.
    const groups = cols.reduce<{ g: Group; n: number }[]>((acc, c) => {
        const last = acc[acc.length - 1];
        if (last && last.g === c.group) last.n++;
        else acc.push({ g: c.group, n: 1 });
        return acc;
    }, []);
    const opens = new Set(cols.filter((c, i) => i > 0 && cols[i - 1].group !== c.group).map(c => c.key));
    const SEAM = 'border-l border-l-line-strong/60';
    const headCells = (
        <>
            <tr>
                <th scope="col" aria-hidden="true" className={cn(HEAD_CELL, STICKY_EDGE, 'z-[4] h-6 border-b-0')} />
                {groups.map((x, i) => (
                    <th key={x.g} scope="colgroup" colSpan={x.n} className={cn(HEAD_CELL, 'h-6 border-b-0 px-2 text-left align-bottom text-micro font-semibold uppercase tracking-label text-fg-2', i > 0 && SEAM)}>
                        <span className="block truncate">{x.g}</span>
                    </th>
                ))}
            </tr>
            <tr>
                <HeaderCell
                    label="Game"
                    title="Date and opponent"
                    align="left"
                    direction={sort?.key === 'date' ? sort.dir : null}
                    onSort={() => onSort('date')}
                    className={cn(HEAD_CELL, STICKY_EDGE, 'top-6 z-[4] pl-2')}
                />
                {cols.map(c => (
                    <HeaderCell
                        key={c.key}
                        label={
                            PAIRS[c.key as PairKey] ? (
                                <span className="inline-flex items-baseline gap-1.5">
                                    {c.label}
                                    <span className="text-fg-disabled">F·A</span>
                                </span>
                            ) : (
                                c.label
                            )
                        }
                        title={c.title}
                        align={c.align === 'left' ? 'left' : 'center'}
                        direction={UNSORTABLE.has(c.key) ? undefined : sort?.key === c.key ? sort.dir : null}
                        onSort={UNSORTABLE.has(c.key) ? undefined : () => onSort(c.key)}
                        className={cn(HEAD_CELL, 'top-6', opens.has(c.key) && SEAM)}
                    />
                ))}
            </tr>
        </>
    );
    // The shown games as one line: record, goals per game, special-teams rates, per-game pairs, save % and GSAx.
    const avgRow = (
        <tr className="group">
            <th scope="row" className={cn(STICKY_EDGE, 'z-[2] h-9 border-b border-line-strong bg-surface-2 px-2 text-left font-normal')}>
                <span className="flex items-baseline gap-2">
                    <span className="text-micro font-semibold uppercase tracking-label text-fg-1">Avg</span>
                    <span className="text-micro uppercase tracking-label text-fg-3">
                        {games.length} GP<span className="sr-only">, per game where it applies</span>
                    </span>
                </span>
            </th>
            {cols.map(c => (
                <td key={c.key} className={cn('h-9 border-b border-line-strong bg-surface-2 px-1.5 text-center text-fg-1', c.align === 'left' && 'text-left text-fg-3', opens.has(c.key) && SEAM)}>
                    {c.avg ? c.avg(t, games, period, ctx) : null}
                </td>
            ))}
        </tr>
    );

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
            {showSummary ? (
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
            ) : null}

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
                                        <Crest tri={g.opp} size={28} className="drop-shadow-none" />
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
                                            <GameLink id={g.id} />
                                            <MiniStats g={g} period={period} />
                                            <Boxscore rows={box?.games[g.id]} players={box?.players} state={boxState} />
                                        </div>
                                    ) : null}
                                </li>
                            );
                        })}
                    </ol>

                    {/* md+: dense table. Below lg (and on short screens) the page scrolls the rows under a pinned header copy. */}
                    <div className="hidden overflow-hidden rounded-card border border-line bg-surface-1 max-lg:overflow-clip md:block [@media(max-height:500px)]:overflow-clip">
                        <StickyHead ref={headRef} className="bg-bg">
                            <table className={tableCls} style={tableStyle}>
                                {colgroup}
                                <thead>{headCells}</thead>
                            </table>
                        </StickyHead>
                        <TableScroller label={`${seasonLabel} game log table`} pageScroll onScrollX={left => headRef.current && (headRef.current.scrollLeft = left)}>
                            <table className={tableCls} style={tableStyle}>
                                <caption className="sr-only">{seasonLabel} game log. The first-column buttons show each boxscore.</caption>
                                {colgroup}
                                <thead className={PINNED_HEAD_HIDE}>{headCells}</thead>
                                <tbody>
                                    {games.length > 1 ? avgRow : null}
                                    {sorted.map(g => {
                                        const isOpen = open.has(g.id);
                                        return (
                                            <React.Fragment key={g.id}>
                                                <tr className="group">
                                                    <th scope="row" className={cn(STICKY_EDGE, CELL_BG, 'z-[2] h-9 border-b p-0 text-left font-normal')}>
                                                        <button
                                                            type="button"
                                                            aria-expanded={isOpen}
                                                            aria-controls={`box-${g.id}`}
                                                            onClick={() => toggle(g.id)}
                                                            className="flex h-9 w-full items-center gap-2 px-2 text-left focus-visible:outline-offset-[-2px]"
                                                        >
                                                            <svg aria-hidden="true" viewBox="0 0 12 12" className={cn('h-2.5 w-2.5 shrink-0 text-fg-3 transition-transform', isOpen && 'rotate-90 text-brand')}>
                                                                <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
                                                            </svg>
                                                            <span className="w-11 shrink-0 text-micro uppercase text-fg-3">{shortDate(g.date)}</span>
                                                            <Crest tri={g.opp} size={24} className="drop-shadow-none" />
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
                                                                'h-9 border-b border-line px-1.5 text-center text-fg-1',
                                                                c.tone?.(g, period),
                                                                c.align === 'left' && 'truncate text-left text-fg-2',
                                                                opens.has(c.key) && SEAM,
                                                            )}
                                                        >
                                                            {c.render(g, period, ctx)}
                                                        </td>
                                                    ))}
                                                </tr>
                                                {isOpen ? (
                                                    <tr>
                                                        <td id={`box-${g.id}`} colSpan={cols.length + 1} className="border-b border-line bg-bg/60 p-0">
                                                            <div className="sticky left-0 max-w-[min(100vw-4rem,1000px)] px-3 py-2.5" style={{ borderLeft: `2px solid ${teamColor}` }}>
                                                                <GameLink id={g.id} />
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
                        </TableScroller>
                    </div>
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
                {/* Phones: fits the card (names truncate) so the names never scroll away. */}
                <table className="w-full min-w-[400px] font-mono text-caption tabular-nums max-sm:min-w-0 max-sm:[&_td]:px-1.5 max-sm:[&_th]:px-1.5">
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
                                        <span className="max-sm:block max-sm:max-w-[8rem] max-sm:truncate max-[359px]:max-w-[5.5rem]">
                                            {num ? <span className="mr-1.5 text-fg-3">{num}</span> : null}
                                            {name}
                                        </span>
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
