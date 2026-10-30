'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useWidth } from '@/components/team/schedule/use-width';
import { SeasonTag } from '@/components/ui/stat-chip';
import { teamColor } from '@/components/ui/team-color';
import { TeamLogo } from '@/components/views/TeamLogo';
import { split, trend, type Form, type FormGame, type Split, type SplitKey } from '@/lib/players/form';
import { signed } from '@/lib/players/ratings';
import { fmtRating, ponyRating, ponyTier } from '@/lib/pony/rating';
import { cn } from '@/lib/utils';
import { WINDOWS } from './model';

/*
 * The /players row drawer: a skater's season as a tape, one column per game
 * (points, Pony Score with its five-game average, ice time by situation),
 * beside his per-game splits over the season and its last 20 / 10 / 5. The
 * table's window is drawn on the tape: games outside it dim, its edge is cyan.
 */

const forms = new Map<string, Promise<Form>>();

/** One fetch per skater and season for the page's life (a failed one is retried on the next open). */
function loadForm(id: string, season: string): Promise<Form> {
    const key = `${id}|${season}`;
    let p = forms.get(key);
    if (!p) {
        p = fetch(`/players/skaters/${id}?season=${season}`).then(r => {
            if (!r.ok) throw new Error(String(r.status));
            return r.json() as Promise<Form>;
        });
        p.catch(() => forms.delete(key));
        forms.set(key, p);
    }
    return p;
}

const mmss = (sec: number) => {
    const t = Math.round(sec);
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;

/** Final drawer height while the games load, so the table does not jump twice. */
const BODY_H = 'min-h-[236px]';

export interface SkaterFormProps {
    id: string;
    team: string;
    /** Position code: the pool his game ratings are read against. */
    pos: string;
    /** Pony season id, e.g. "20262027". */
    season: string;
    /** Prior-season tag ("25-26"); null for this season. */
    tag: string | null;
    /** The table's last-N window of this season; null for a whole season. */
    win: number | null;
}

export function SkaterForm({ id, team, pos, season, tag, win }: SkaterFormProps) {
    const [state, setState] = React.useState<{ key: string; form: Form | null; failed: boolean }>({ key: '', form: null, failed: false });
    const [attempt, setAttempt] = React.useState(0);
    const key = `${id}|${season}`;
    React.useEffect(() => {
        let alive = true;
        loadForm(id, season)
            .then(form => alive && setState({ key: `${id}|${season}`, form, failed: false }))
            .catch(() => alive && setState({ key: `${id}|${season}`, form: null, failed: true }));
        return () => {
            alive = false;
        };
    }, [id, season, attempt]);
    const form = state.key === key ? state.form : null;
    const failed = state.key === key && state.failed;

    return (
        <div className="[container-type:inline-size]">
            {failed ? (
                <p role="alert" className="flex items-center gap-3 px-3 py-4 text-micro font-medium uppercase tracking-label text-warn md:px-4">
                    Form unavailable
                    <button type="button" onClick={() => setAttempt(a => a + 1)} className="inline-flex min-h-8 items-center text-brand hover:underline coarse:min-h-11">
                        Retry
                    </button>
                </p>
            ) : !form ? (
                <div aria-busy="true" aria-label="Loading form" className={cn(BODY_H, 'animate-pulse bg-[linear-gradient(90deg,transparent,rgb(var(--line-rgb)/0.35),transparent)]')} />
            ) : !form.games.length ? (
                <p className="px-3 py-4 text-micro font-medium uppercase tracking-label text-fg-3 md:px-4">
                    {tag ? <SeasonTag className="mr-2">{tag}</SeasonTag> : null}
                    No games yet
                </p>
            ) : (
                <FormBody games={form.games} team={team} pos={pos} tag={tag} win={win} />
            )}
        </div>
    );
}

function FormBody({ games, team, pos, tag, win }: { games: FormGame[]; team: string; pos: string; tag: string | null; win: number | null }) {
    // Index of the picked game; the readout shows the latest at rest.
    const [hover, setHover] = React.useState<number | null>(null);
    const at = hover ?? games.length - 1;
    return (
        <div className={cn(BODY_H, 'grid gap-x-8 gap-y-4 px-3 pb-3 pt-2.5 md:px-4 cq-2xl:grid-cols-[minmax(0,1fr)_auto]')}>
            <div className="flex min-w-0 flex-col gap-2">
                <Readout g={games[at]} n={at + 1} pos={pos} tag={tag} />
                <Tape games={games} team={team} win={win} hover={hover} onHover={setHover} />
                <Legend />
            </div>
            <Splits games={games} win={win} />
        </div>
    );
}

/** The picked game's line (the latest at rest), in a fixed spot: nothing floats over the tape. */
function Readout({ g, n, pos, tag }: { g: FormGame; n: number; pos: string; tag: string | null }) {
    const v = (x: React.ReactNode, cls = 'text-fg-1') => <b className={cn('font-semibold tracking-normal', cls)}>{x}</b>;
    return (
        <p className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1 text-micro font-medium uppercase tracking-label text-fg-3">
            {tag ? <SeasonTag>{tag}</SeasonTag> : null}
            <span>
                {v(`G${n}`, 'text-fg-2')} · {shortDate(g.date)}
            </span>
            <span className="inline-flex items-center gap-1.5">
                {g.home ? 'vs' : '@'}
                <TeamLogo tri={g.opp} size={20} />
                {g.opp}
            </span>
            <span className={g.result === 'W' ? 'text-fg-1' : 'text-fg-3'}>
                {g.result} {g.gf}–{g.ga}
            </span>
            <span>
                {v(g.g)} G {v(g.a)} A
            </span>
            <span>{v(g.sog)} SOG</span>
            <span>{v(g.ixg.toFixed(2), 'text-model')} IXG</span>
            <span>{v(mmss(g.toi))} TOI</span>
            <span>{v(fmtRating(ponyRating(g.ps, pos)), ponyTier(ponyRating(g.ps, pos)).className)} PONY</span>
        </p>
    );
}

const LABEL_W = 44;
const LANES = { pts: { y: 2, h: 38 }, ps: { y: 52, h: 60 }, toi: { y: 124, h: 28 } } as const;
const AXIS_Y = 160;
const H = 178;
/** Narrowest column per game; on a phone the oldest games that do not fit drop off the left. */
const MIN_STEP = 9;
/** A short season still spreads over at least this many columns, from the left. */
const MIN_SLOTS = 12;

/**
 * One column per game, oldest first from the left edge. Lanes:
 * points as stacked LED pips (goals lit ink, assists grey; a stub for none), Pony
 * Score as signed bars in the team colour with the five-game average in
 * magenta, and ice time as even-strength / PP / PK stacks on a 30:00 scale.
 * Hover or a sideways scrub picks a game; a click (a second tap on touch) opens it.
 */
function Tape({ games, team, win, hover, onHover }: { games: FormGame[]; team: string; win: number | null; hover: number | null; onHover: (i: number | null) => void }) {
    const [ref, width] = useWidth<HTMLDivElement>();
    const router = useRouter();
    const armed = React.useRef<number | null>(null);
    const touch = React.useRef(false);

    const W = Math.max(width, 240);
    const plot = W - LABEL_W;
    const first = Math.max(0, games.length - Math.floor(plot / MIN_STEP));
    const shown = games.slice(first);
    const step = plot / Math.max(shown.length, MIN_SLOTS);
    const x0 = LABEL_W;
    const x1 = x0 + step * shown.length;
    const bw = Math.max(3, Math.min(22, step * 0.62));
    const cx = (i: number) => x0 + step * (i + 0.5);

    const maxPts = Math.max(3, ...shown.map(g => g.g + g.a));
    const pipGap = 2;
    const pipH = Math.min(7, (LANES.pts.h - (maxPts - 1) * pipGap) / maxPts);
    const ptsBase = LANES.pts.y + LANES.pts.h;

    // Pony Score scale: half-goal steps around what he did, zero wherever that puts it.
    const hi = Math.max(0.5, Math.ceil(Math.max(...shown.map(g => g.ps)) * 2) / 2);
    const lo = Math.min(0, Math.floor(Math.min(...shown.map(g => g.ps)) * 2) / 2);
    const mid = LANES.ps.y + (hi / (hi - lo)) * LANES.ps.h;
    const yPs = (v: number) => mid - (v / (hi - lo)) * LANES.ps.h;
    const roll = games.map((_, i) => {
        const s = games.slice(Math.max(0, i - 4), i + 1);
        return s.reduce((a, g) => a + g.ps, 0) / s.length;
    });
    const rollPath = shown.map((_, i) => `${i ? 'L' : 'M'}${cx(i).toFixed(1)},${yPs(roll[first + i]).toFixed(1)}`).join('');

    const toiMax = Math.max(1800, ...shown.map(g => g.toi));
    const toiBase = LANES.toi.y + LANES.toi.h;
    const hToi = (s: number) => (Math.max(0, s) / toiMax) * LANES.toi.h;

    const color = teamColor(team);
    const inWin = (gi: number) => win == null || gi >= games.length - win;
    const opacity = (gi: number) => {
        if (hover === gi) return 1;
        const base = inWin(gi) ? 1 : 0.28;
        return hover == null ? base : base * 0.45;
    };
    // Window edges: where the last 20 / 10 / 5 begin (only windows shorter than the season).
    const edges = WINDOWS.filter(n => n < games.length && n <= shown.length).map(n => ({ n, x: x0 + step * (shown.length - n) }));
    const selected = win != null && win < games.length ? win : null;

    const pick = (e: React.PointerEvent<SVGRectElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        const i = Math.floor(((e.clientX - r.left) / r.width) * shown.length);
        return first + Math.max(0, Math.min(shown.length - 1, i));
    };
    const hx = hover != null && hover >= first ? cx(hover - first) : null;
    const pts = games.slice(-5).map(g => g.g + g.a);
    const label = `${games.length} games. Last five, newest last: points ${pts.join(', ')}; Pony Score five-game average ${signed(roll[roll.length - 1])}`;

    return (
        // Sideways drags scrub the games; vertical swipes still scroll the page.
        <div ref={ref} className="relative touch-pan-y">
            {width ? (
                <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={label} className="block select-none overflow-visible tabular-nums">
                    {(['pts', 'ps', 'toi'] as const).map(k => (
                        <text key={k} x={0} y={LANES[k].y + LANES[k].h / 2 + 4} className="fill-fg-3 text-micro font-medium uppercase tracking-label">
                            {k === 'pts' ? 'PTS' : k === 'ps' ? 'PONY' : 'TOI'}
                        </text>
                    ))}
                    {hx != null ? <rect x={hx - step / 2} y={0} width={step} height={AXIS_Y} className="fill-fg-1" opacity={0.06} /> : null}
                    <line x1={x0} x2={x1} y1={mid} y2={mid} className="stroke-fg-3" strokeOpacity={0.45} />
                    <line x1={x0} x2={x1} y1={AXIS_Y} y2={AXIS_Y} className="stroke-line-strong" />
                    {edges.map(e => (
                        <g key={e.n} className={e.n === selected ? 'text-brand' : 'text-line-strong'}>
                            <line x1={e.x} x2={e.x} y1={0} y2={AXIS_Y + 4} stroke="currentColor" strokeDasharray={e.n === selected ? undefined : '2 3'} strokeOpacity={e.n === selected ? 0.75 : 1} />
                            <text x={e.x + 4} y={AXIS_Y + 15} className={cn('text-micro font-medium uppercase tracking-label', e.n === selected ? 'fill-brand' : 'fill-fg-3')}>
                                L{e.n}
                            </text>
                        </g>
                    ))}
                    {selected != null ? <line x1={x0 + step * (shown.length - selected)} x2={x1} y1={AXIS_Y} y2={AXIS_Y} className="stroke-brand" strokeWidth={2} /> : null}
                    {shown.map((g, i) => {
                        const gi = first + i;
                        const x = cx(i) - bw / 2;
                        const p = g.g + g.a;
                        const ev = g.toi - g.toiPp - g.toiPk;
                        const delay = { animationDelay: `${Math.min(i, 40) * 12}ms` };
                        return (
                            <g key={g.game} style={{ opacity: opacity(gi) }} className="transition-opacity duration-150">
                                <g className="form-grow" style={delay}>
                                    {p ? (
                                        Array.from({ length: p }, (_, k) => (
                                            <rect
                                                key={k}
                                                x={x}
                                                y={ptsBase - (k + 1) * pipH - k * pipGap}
                                                width={bw}
                                                height={pipH}
                                                rx={1.5}
                                                className={k < g.g ? 'fill-fg-1' : 'fill-fg-2'}
                                                fillOpacity={k < g.g ? 1 : 0.5}
                                            />
                                        ))
                                    ) : (
                                        <rect x={x} y={ptsBase - 2} width={bw} height={2} rx={1} className="fill-line-strong" />
                                    )}
                                </g>
                                <rect
                                    x={x}
                                    y={g.ps >= 0 ? yPs(g.ps) : mid}
                                    width={bw}
                                    height={Math.max(1.5, Math.abs(yPs(g.ps) - mid))}
                                    rx={Math.min(2, bw / 3)}
                                    fill={g.ps >= 0 ? color : 'var(--text-3)'}
                                    fillOpacity={g.ps >= 0 ? 0.9 : 0.55}
                                    className={cn('form-grow', g.ps < 0 && 'form-grow-down')}
                                    style={delay}
                                />
                                <g className="form-grow" style={delay}>
                                    <rect x={x} y={toiBase - hToi(ev)} width={bw} height={hToi(ev)} className="fill-fg-2" fillOpacity={0.4} />
                                    <rect x={x} y={toiBase - hToi(ev + g.toiPp)} width={bw} height={hToi(g.toiPp)} fill="var(--pp)" />
                                    <rect x={x} y={toiBase - hToi(g.toi)} width={bw} height={hToi(g.toiPk)} fill="var(--pk)" />
                                </g>
                            </g>
                        );
                    })}
                    {shown.length > 2 ? <path d={rollPath} fill="none" className="form-draw stroke-model" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" pathLength={1} /> : null}
                    {hx != null ? <circle cx={hx} cy={yPs(roll[hover!])} r={3.5} className="fill-model stroke-well" strokeWidth={1.5} /> : null}
                    <rect
                        x={x0}
                        y={0}
                        width={x1 - x0}
                        height={H}
                        fill="transparent"
                        className="cursor-pointer"
                        onPointerMove={e => (e.pointerType === 'mouse' || e.buttons) && onHover(pick(e))}
                        onPointerDown={e => {
                            touch.current = e.pointerType !== 'mouse';
                            armed.current = hover;
                            onHover(pick(e));
                        }}
                        onPointerLeave={e => e.pointerType === 'mouse' && onHover(null)}
                        onPointerCancel={() => onHover(null)}
                        onClick={e => {
                            e.stopPropagation();
                            const g = hover != null ? games[hover] : null;
                            if (g && (!touch.current || armed.current === hover)) router.push(`/games/${g.game}`);
                        }}
                    />
                </svg>
            ) : (
                <div style={{ height: H }} aria-hidden="true" />
            )}
        </div>
    );
}

function Legend() {
    const sw = (cls: string, style?: React.CSSProperties) => <span aria-hidden="true" className={cn('inline-block size-2 rounded-[1px]', cls)} style={style} />;
    return (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-micro font-medium uppercase tracking-label text-fg-3">
            <span className="inline-flex items-center gap-1.5">
                {sw('bg-fg-1')}G {sw('ml-1.5 bg-fg-2/50')}A
            </span>
            <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="inline-block h-0.5 w-3 rounded-full bg-model" />5 GP avg
            </span>
            <span className="inline-flex items-center gap-1.5">
                {sw('', { background: 'var(--pp)' })}PP {sw('ml-1.5', { background: 'var(--pk)' })}PK
            </span>
        </p>
    );
}

const SPLIT_ROWS: { key: keyof Split; label: string; fmt: (v: number) => string; model?: boolean }[] = [
    { key: 'gp', label: 'GP', fmt: v => String(v) },
    { key: 'pts', label: 'PTS', fmt: v => v.toFixed(2) },
    { key: 'sog', label: 'SOG', fmt: v => v.toFixed(2) },
    { key: 'ixg', label: 'IXG', fmt: v => v.toFixed(2), model: true },
    { key: 'xgPct', label: '5v5 XG%', fmt: v => v.toFixed(1), model: true },
    { key: 'toi', label: 'TOI', fmt: mmss },
    { key: 'toiPp', label: 'PP TOI', fmt: mmss },
    { key: 'ps', label: 'PONY', fmt: v => signed(v) },
];

function TrendMark({ dir }: { dir: 'up' | 'down' | null }) {
    return (
        <span className="ml-1 inline-flex w-2 justify-center align-middle">
            {dir ? (
                <>
                    <svg aria-hidden="true" viewBox="0 0 8 7" className={cn('size-2', dir === 'up' ? 'fill-pos' : 'rotate-180 fill-neg')}>
                        <path d="M4 0.5 7.6 6.5H0.4Z" />
                    </svg>
                    <span className="sr-only">{dir === 'up' ? ' up on the season' : ' down on the season'}</span>
                </>
            ) : null}
        </span>
    );
}

/** Per game over the season and each last-N window shorter than it; the table's window is the cyan column. */
function Splits({ games, win }: { games: FormGame[]; win: number | null }) {
    const season = split(games)!;
    const cols = [
        { n: null as number | null, label: 'SZN', s: season },
        ...[...WINDOWS]
            .reverse()
            .filter(n => n < games.length)
            .map(n => ({ n: n as number | null, label: `L${n}`, s: split(games, n)! })),
    ];
    const active = (n: number | null) => (n == null ? win == null || win >= games.length : n === win);
    return (
        <table className="w-full self-start text-caption tabular-nums cq-2xl:w-auto">
            <caption className="sr-only">Per game over the season and its last {cols.slice(1).map(c => c.n).join(', ') || 'games'}</caption>
            <thead>
                <tr>
                    <th scope="col" className="h-7 pr-4 text-left text-micro font-medium uppercase tracking-label text-fg-3">
                        Per game
                    </th>
                    {cols.map(c => (
                        <th
                            key={c.label}
                            scope="col"
                            className={cn('h-7 min-w-[4.25rem] rounded-t-[4px] px-2 text-right text-micro font-medium uppercase tracking-label', active(c.n) ? 'bg-brand/[0.07] text-brand' : 'text-fg-3')}
                        >
                            {c.label}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {SPLIT_ROWS.map(r => (
                    <tr key={r.key} className="border-t border-line">
                        <th scope="row" className="h-6 whitespace-nowrap pr-4 text-left text-micro font-medium uppercase tracking-label text-fg-3">
                            {r.label}
                        </th>
                        {cols.map(c => {
                            const v = c.s[r.key];
                            const dir = c.n != null && r.key !== 'gp' ? trend(c.s, season, r.key as SplitKey) : null;
                            return (
                                <td
                                    key={c.label}
                                    className={cn(
                                        'h-6 whitespace-nowrap px-2 text-right',
                                        active(c.n) && 'bg-brand/[0.07]',
                                        r.model ? 'text-model' : active(c.n) ? 'text-fg-1' : 'text-fg-2',
                                        active(c.n) && 'font-semibold',
                                    )}
                                >
                                    {v == null ? <span className="text-fg-disabled">—</span> : r.fmt(v)}
                                    <TrendMark dir={dir} />
                                </td>
                            );
                        })}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
