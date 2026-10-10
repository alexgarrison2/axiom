'use client';

import * as React from 'react';
import { Crest } from '@/components/ui/crest';
import { Segmented } from '@/components/ui/segmented';
import { fmtInt, pctTone } from '@/components/views/format';
import { cn } from '@/lib/utils';
import { DRAW_WINDOW, draws, FO_SPOTS, inPeriod, periodLabel, type Draw, type PeriodFilter } from '@/lib/game/analytics';
import { other, type Side } from '@/lib/game/types';
import { ControlRow } from './ControlRow';
import { GameSection, useGame } from './GameContext';
import { useHoverTip } from './HoverTip';
import { JerseyNumber } from './Jersey';
import { RinkMarkings } from './Rink';

/**
 * The draw board: the rink's nine faceoff dots carry the game's faceoffs. Each
 * draw is a bead on a ring around its dot, clockwise from twelve o'clock in game
 * order, in the winner's colour; a spark leaves a bead whose win became a shot
 * attempt within DRAW_WINDOW seconds. The takers sit at the ends their team
 * attacks; picking one lights only his draws and his record against each
 * opponent, and hovering an opponent then lights just the draws between them.
 */

type Strength = 'all' | '5v5' | 'ev' | 'awayPP' | 'homePP';
/** Whose power play a draw was taken on (the winner's view: his PP, or the other side's when he is shorthanded). */
const ppSide = (d: Draw): Side | null => (d.e.strength === 'pp' ? d.e.side : d.e.strength === 'sh' ? other(d.e.side) : null);
const strengthMatch = (d: Draw, f: Strength) =>
    f === 'all' || (f === '5v5' ? d.e.fiveOnFive : f === 'ev' ? ppSide(d) == null : ppSide(d) === (f === 'awayPP' ? 'away' : 'home'));

/**
 * The board is drawn with each team's own end on its own side: the away team (rail on the left) defends the left
 * net. The game frame has the away team attacking left, so the board turns it half round (x → −x, y → −y: the
 * same ice seen from the other side).
 */
const boardX = (x: number) => -x;
/**
 * Which third of the board a draw was in: 0 the away team's own end (left), 1 neutral ice, 2 the home team's own
 * end (right). From the dot, else from the feed's zone (an O-zone win is in the winner's attacking end).
 */
const thirdOf = (d: Draw): 0 | 1 | 2 | null => {
    if (d.dot != null) {
        const x = boardX(FO_SPOTS[d.dot][0]);
        return x < -25 ? 0 : x > 25 ? 2 : 1;
    }
    if (!d.e.zone) return null;
    if (d.e.zone === 'N') return 1;
    return (d.e.zone === 'O' ? d.win : other(d.win)) === 'away' ? 2 : 0;
};
const THIRDS = [
    { x0: -100, x1: -25, dir: -1 as const },
    { x0: -25, x1: 25, dir: 0 as const },
    { x0: 25, x1: 100, dir: 1 as const },
];
const RINK_PATH = 'M-72,-42.5 H72 A28,28 0 0 1 100,-14.5 V14.5 A28,28 0 0 1 72,42.5 H-72 A28,28 0 0 1 -100,14.5 V-14.5 A28,28 0 0 1 -72,-42.5 Z';

/** Rink frame in feet, a little past the boards. */
const VB = { x: -101, y: -44, w: 202, h: 88 };
const BEAD = 2.1;
const STEP = 2 * BEAD + 0.9;
/** Painted circles (ends, centre) are 15 ft; the neutral dots get a smaller ring of their own. */
const isNeutral = (k: number) => k === 2 || k === 3 || k === 5 || k === 6;
const ringOf = (k: number) => (isNeutral(k) ? 9 : 15);
/** Beads one ring of radius r holds (18 on a 15 ft circle, 11 on the neutral rings); more spill to a ring outside. */
const capOf = (r: number) => Math.floor((2 * Math.PI * r) / STEP);

type Zone = 'O' | 'N' | 'D';
interface Taker {
    id: number;
    side: Side;
    w: number;
    l: number;
    /** Won-lost by zone from his own side's view. */
    zone: Record<Zone, [number, number]>;
    /** Wins that became a shot attempt. */
    led: number;
}

/** Bead centres for n draws on a ring of radius r: from twelve o'clock clockwise, a second ring outside when the first is full. */
function beadSpots(n: number, r: number): { x: number; y: number; a: number }[] {
    const out: { x: number; y: number; a: number }[] = [];
    let ring = r;
    let used = 0;
    for (let i = 0; i < n; i++) {
        if (used >= capOf(ring)) {
            ring += STEP;
            used = 0;
        }
        const a = -Math.PI / 2 + (used * STEP) / ring;
        // Rounded so the server and browser trig agree to the digit (hydration).
        const r2 = (v: number) => Math.round(v * 100) / 100;
        out.push({ x: r2(ring * Math.cos(a)), y: r2(ring * Math.sin(a)), a: r2(a) });
        used += 1;
    }
    return out;
}

const flip = (z: Zone): Zone => (z === 'O' ? 'D' : z === 'D' ? 'O' : 'N');

function takersOf(list: Draw[], byId: Map<number, { side: Side }>): Taker[] {
    const map = new Map<number, Taker>();
    const get = (id: number) => {
        let t = map.get(id);
        if (!t) {
            const side = byId.get(id)?.side ?? 'away';
            map.set(id, (t = { id, side, w: 0, l: 0, zone: { O: [0, 0], N: [0, 0], D: [0, 0] }, led: 0 }));
        }
        return t;
    };
    for (const d of list) {
        const z = d.e.zone;
        if (d.winner != null) {
            const t = get(d.winner);
            t.w += 1;
            if (z) t.zone[z][0] += 1;
            if (d.led) t.led += 1;
        }
        if (d.loser != null) {
            const t = get(d.loser);
            t.l += 1;
            if (z) t.zone[flip(z)][1] += 1;
        }
    }
    return [...map.values()].sort((a, b) => b.w + b.l - (a.w + a.l) || b.w - a.w);
}

/** A short tick leaving the bead: the win became a shot attempt (longer for a goal). */
function Spark({ x, y, a, goal, br = BEAD }: { x: number; y: number; a: number; goal: boolean; br?: number }) {
    const r0 = br + 0.5;
    const r1 = br + (goal ? 4.2 : 3);
    return (
        <line
            x1={(x + r0 * Math.cos(a)).toFixed(2)}
            y1={(y + r0 * Math.sin(a)).toFixed(2)}
            x2={(x + r1 * Math.cos(a)).toFixed(2)}
            y2={(y + r1 * Math.sin(a)).toFixed(2)}
            className="stroke-fg-1"
            strokeWidth={goal ? 0.9 : 0.6}
            strokeLinecap="round"
        />
    );
}

/** Which way a team attacks, under the end it attacks. */
function Arrow({ dir }: { dir: -1 | 1 }) {
    return (
        <svg viewBox="0 0 16 10" className="h-2.5 w-4" aria-hidden="true">
            <path d={dir < 0 ? 'M15 5H2M6 1L2 5l4 4' : 'M1 5h13M10 1l4 4-4 4'} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function SparkIcon() {
    return (
        <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
            <circle cx={4} cy={8} r={3} fill="currentColor" opacity={0.55} />
            <path d="M7 5l3.5-3.5" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
        </svg>
    );
}

const pct = (w: number, l: number) => (w + l ? `${Math.round((w / (w + l)) * 100)}%` : '—');

/** Win % in context: faceoffs live near 50, so the tone runs from red at 40% through grey at 50 to green at 60%. */
function Pct({ w, l, className }: { w: number; l: number; className?: string }) {
    return (
        <span className={className} style={w + l ? { color: pctTone(50 + ((w / (w + l)) * 100 - 50) * 5) } : undefined}>
            {pct(w, l)}
        </span>
    );
}

export function Faceoffs() {
    const { m, colors, byId, label } = useGame();
    // A merged season (team page): too many draws for a bead each, so each dot becomes a gauge.
    const season = !!m.starts?.length;
    const all = React.useMemo(() => draws(m), [m]);
    const [strength, setStrength] = React.useState<Strength>('all');
    const [period, setPeriod] = React.useState<string>('all');
    const per: PeriodFilter = period === 'all' ? 'all' : Number(period);
    const periods = React.useMemo(() => [...new Set(all.map(d => (d.e.period >= 4 ? 4 : d.e.period)))].sort(), [all]);
    const list = React.useMemo(() => all.filter(d => strengthMatch(d, strength) && inPeriod(d.e, per)), [all, strength, per]);
    const takers = React.useMemo(() => takersOf(list, byId), [list, byId]);
    const [pinned, setPinned] = React.useState<number | null>(null);
    // A taker is picked by click (tap) only; with none picked the board shows both teams.
    const active = pinned;
    const activeSide = active != null ? (byId.get(active)?.side ?? null) : null;
    React.useEffect(() => {
        if (pinned == null) return;
        const esc = (e: KeyboardEvent) => e.key === 'Escape' && setPinned(null);
        window.addEventListener('keydown', esc);
        return () => window.removeEventListener('keydown', esc);
    }, [pinned]);
    const { bind, tip } = useHoverTip();

    const byDot = React.useMemo(() => FO_SPOTS.map((_, k) => list.filter(d => d.dot === k)), [list]);
    const involved = (d: Draw) => active == null || d.winner === active || d.loser === active;
    // With a taker picked, hovering an opponent's row lights only the draws between the two of them.
    const [pair, setPair] = React.useState<number | null>(null);
    const vsPair = (d: Draw) => pair != null && (d.winner === pair || d.loser === pair) && (d.winner === active || d.loser === active);
    // Head to head against the picked taker: wins and losses of each opponent against him.
    const h2h = React.useMemo(() => {
        const out = new Map<number, [number, number]>();
        if (active == null) return out;
        for (const d of list) {
            if (d.winner === active && d.loser != null) out.set(d.loser, [(out.get(d.loser)?.[0] ?? 0), (out.get(d.loser)?.[1] ?? 0) + 1]);
            if (d.loser === active && d.winner != null) out.set(d.winner, [(out.get(d.winner)?.[0] ?? 0) + 1, out.get(d.winner)?.[1] ?? 0]);
        }
        return out;
    }, [active, list]);

    // The draws in view at each dot (picked taker, hovered opponent). Beads are one per draw, so several games keep them
    // only while every dot's draws fit its ring; past that the dots switch to solid rings (beads would read as draws).
    const pools = byDot.map(ds => ds.filter(d => involved(d) && (pair == null || vsPair(d))));
    const beads = !season || pools.every((p, k) => p.length <= capOf(ringOf(k)));

    // A zone under the pointer (on the ice or its bar below): its beads stay bright and its draws are listed.
    const [hot, setHot] = React.useState<0 | 1 | 2 | null>(null);

    const total = (s: Side) => list.filter(d => d.win === s).length;
    const ledBy = (s: Side) => list.filter(d => d.win === s && d.led).length;
    const n = list.length;

    // Each third's draws (only the picked taker's when one is picked); each end is named for the team that attacks it.
    const thirds = THIRDS.map((t, z) => {
        const ds = list.filter(d => thirdOf(d) === z && involved(d));
        const away = m.teams.away.tri;
        const home = m.teams.home.tri;
        return {
            ...t,
            ds,
            // The left end is the away team's own, so the home team attacks it (and the reverse on the right).
            name: z === 0 ? `${home} attacks` : z === 2 ? `${away} attacks` : 'Neutral',
            title: z === 0 ? `${home} attacking zone` : z === 2 ? `${away} attacking zone` : 'Neutral ice',
            caps: z === 0 ? [`${away} DZ`, `${home} OZ`] : z === 2 ? [`${away} OZ`, `${home} DZ`] : [`${away} NZ`, `${home} NZ`],
            away: ds.filter(d => d.win === 'away').length,
            home: ds.filter(d => d.win === 'home').length,
        };
    });
    // The team's own record by zone (its offensive zone is where it attacks).
    const teamZone = (side: Side) =>
        (['D', 'N', 'O'] as Zone[]).map(z => ({
            z,
            w: list.filter(d => d.win === side && d.e.zone === z).length,
            l: list.filter(d => d.win !== side && d.e.zone != null && flip(d.e.zone) === z).length,
        }));

    const zoneTip = (z: 0 | 1 | 2) => {
        const t = thirds[z];
        if (season) {
            const tot = t.away + t.home;
            const top = takersOf(t.ds, byId)
                .filter(x => x.side === 'away')
                .slice(0, 6);
            return (
                <div className="flex w-64 flex-col gap-2">
                    <div className="flex items-baseline justify-between gap-3">
                        <span className="font-bold text-fg-1">{t.title}</span>
                        <span className="text-caption font-bold tabular-nums">
                            <span style={{ color: colors.away }}>{fmtInt(t.away)}</span>
                            <span className="px-1 font-normal text-fg-3">–</span>
                            <span style={{ color: colors.home }}>{fmtInt(t.home)}</span>
                        </span>
                    </div>
                    <p className="text-micro uppercase tracking-label text-fg-3">
                        {m.teams.away.tri} won <Pct w={t.away} l={t.home} /> of {fmtInt(tot)}
                    </p>
                    <ol className="flex flex-col gap-1 border-t border-line pt-2 text-caption">
                        {top.map(x => (
                            <li key={x.id} className="flex items-baseline justify-between gap-2">
                                <span className="truncate font-semibold text-fg-1">{label(x.id)}</span>
                                <span className="tabular-nums text-fg-2">
                                    {wl(x.w, x.l)} <Pct w={x.w} l={x.l} />
                                </span>
                            </li>
                        ))}
                    </ol>
                </div>
            );
        }
        return (
            <div className="flex w-72 flex-col gap-2">
                <div className="flex items-baseline justify-between gap-3">
                    <span className="font-bold text-fg-1">{t.title}</span>
                    <span className="text-caption font-bold tabular-nums">
                        <span style={{ color: colors.away }}>{fmtInt(t.away)}</span>
                        <span className="px-1 font-normal text-fg-3">–</span>
                        <span style={{ color: colors.home }}>{fmtInt(t.home)}</span>
                    </span>
                </div>
                <ol className="flex max-h-80 flex-col gap-1 overflow-hidden text-caption">
                    {t.ds.map(d => (
                        <li key={d.e.id} className="grid grid-cols-[3.75rem_minmax(0,1fr)_auto] items-baseline gap-2">
                            <span className="text-micro tabular-nums text-fg-3">
                                {periodLabel(d.e.period)} {d.e.clock}
                            </span>
                            <span className="min-w-0 truncate">
                                <span className="font-semibold" style={{ color: colors[d.win] }}>
                                    {label(d.winner)}
                                </span>
                                <span className="text-fg-3"> over </span>
                                <span className="text-fg-2">{label(d.loser)}</span>
                            </span>
                            <span className="flex items-baseline gap-1.5 text-micro uppercase tracking-label text-fg-2">
                                {ppSide(d) ? <span className="text-warn">{m.teams[ppSide(d)!].tri} PP</span> : null}
                                {d.led ? (d.led.type === 'goal' ? `Goal ${Math.round(d.led.t - d.e.t)}s` : `Shot ${Math.round(d.led.t - d.e.t)}s`) : ''}
                            </span>
                        </li>
                    ))}
                </ol>
            </div>
        );
    };

    const wl = (w: number, l: number) => `${fmtInt(w)}–${fmtInt(l)}`;
    // D / N / O side by side: win % over the W–L, three fixed columns so the rows line up.
    const zoneCells = (z: Record<Zone, [number, number]>, className?: string) => (
        <span className={cn('grid grid-cols-3 gap-x-2 text-micro tabular-nums', className)}>
            {(['D', 'N', 'O'] as Zone[]).map(k => {
                const [w, l] = z[k];
                return (
                    <span key={k} className={cn('flex min-w-0 flex-col leading-tight', !(w + l) && 'opacity-40')}>
                        <span className="whitespace-nowrap text-fg-2">
                            <span className="text-fg-3">{k}</span> <Pct w={w} l={l} />
                        </span>
                        <span className="whitespace-nowrap text-fg-3">{w + l ? wl(w, l) : '—'}</span>
                    </span>
                );
            })}
        </span>
    );

    // Whose win % the zone bars state: the picked taker's side, else the away side (the team, on a team page).
    const view: Side = activeSide ?? 'away';

    const rail = (side: Side) => {
        // A season lists the regular takers (10+ draws) and the opponents faced most, or those the picked taker faced.
        const rows = !season
            ? takers.filter(t => t.side === side)
            : side === 'away'
              ? takers.filter(t => t.side === 'away' && t.w + t.l >= 10).slice(0, 12)
              : active != null && activeSide === 'away'
                ? takers
                      .filter(t => t.side === 'home' && h2h.has(t.id))
                      .sort((a, b) => h2h.get(b.id)![0] + h2h.get(b.id)![1] - (h2h.get(a.id)![0] + h2h.get(a.id)![1]))
                      .slice(0, 10)
                : takers.filter(t => t.side === 'home').slice(0, 10);
        const w = total(side);
        const l = n - w;
        return (
            <div className="flex min-w-0 flex-col gap-1.5">
                <div className={cn('flex items-center gap-3', side === 'home' && 'lg:flex-row-reverse lg:text-right')}>
                    <Crest tri={m.teams[side].tri} size={44} className="h-11 w-11 shrink-0" />
                    <div className="min-w-0 leading-tight">
                        <div className={cn('flex items-baseline gap-2', side === 'home' && 'lg:justify-end')}>
                            <span className="text-h3 font-bold tabular-nums text-fg-1">{wl(w, l)}</span>
                            <Pct w={w} l={l} className="text-caption font-semibold tabular-nums" />
                        </div>
                        {zoneCells(Object.fromEntries(teamZone(side).map(({ z, w: zw, l: zl }) => [z, [zw, zl]])) as Record<Zone, [number, number]>, 'mt-1')}
                        <span className={cn('mt-1 flex items-center gap-1 text-micro uppercase tracking-label text-fg-3', side === 'home' && 'lg:justify-end')}>
                            <SparkIcon /> {fmtInt(ledBy(side))} won into a shot
                        </span>
                    </div>
                </div>
                <ul className="flex flex-col">
                    {rows.map(t => {
                        const isActive = t.id === active;
                        const rec = h2h.get(t.id);
                        const faded = active != null && !isActive && (activeSide === side || !rec);
                        const p = byId.get(t.id);
                        return (
                            <li key={t.id}>
                                <button
                                    type="button"
                                    aria-pressed={pinned === t.id}
                                    onPointerEnter={e => e.pointerType === 'mouse' && rec && setPair(t.id)}
                                    onPointerLeave={e => e.pointerType === 'mouse' && setPair(null)}
                                    onClick={() => {
                                        setPinned(cur => (cur === t.id ? null : t.id));
                                        setPair(null);
                                    }}
                                    className={cn(
                                        'grid w-full grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 rounded-control border px-2 py-1.5 text-left transition-[opacity,background-color,border-color] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand',
                                        isActive ? 'border-brand/60 bg-surface-2' : 'border-transparent hover:bg-surface-2/60',
                                        faded && 'opacity-35',
                                    )}
                                >
                                    <JerseyNumber tri={m.teams[side].tri} num={p?.num ?? null} ring={colors[side]} size={24} />
                                    <span className="flex min-w-0 flex-col gap-1">
                                        <span className="flex items-baseline justify-between gap-2">
                                            <span className="flex min-w-0 items-baseline gap-1.5">
                                                <span className="truncate text-caption font-semibold text-fg-1">{label(t.id)}</span>
                                                {t.led ? (
                                                    <span className="flex shrink-0 items-center gap-0.5 text-micro tabular-nums text-fg-3" title="Wins into a shot">
                                                        <SparkIcon />
                                                        {fmtInt(t.led)}
                                                    </span>
                                                ) : null}
                                            </span>
                                            {rec && !isActive ? (
                                                <span className="shrink-0 whitespace-nowrap text-caption font-bold tabular-nums text-brand">
                                                    <span className="mr-1 text-micro font-normal uppercase tracking-label text-fg-3">vs</span>
                                                    {wl(rec[0], rec[1])} <Pct w={rec[0]} l={rec[1]} className="font-normal" />
                                                </span>
                                            ) : (
                                                <span className="shrink-0 whitespace-nowrap text-caption font-bold tabular-nums text-fg-1">
                                                    {wl(t.w, t.l)} <Pct w={t.w} l={t.l} className="font-normal" />
                                                </span>
                                            )}
                                        </span>
                                        {zoneCells(t.zone)}
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            </div>
        );
    };

    if (!all.length)
        return (
            <GameSection id="faceoffs" title="Faceoffs">
                <p className="panel p-card label">No faceoffs yet</p>
            </GameSection>
        );

    const picked = active != null ? byId.get(active) : null;
    return (
        <GameSection
            id="faceoffs"
            title="Faceoffs"
            aside={
                picked ? (
                    <button
                        type="button"
                        onClick={() => setPinned(null)}
                        className="flex h-8 items-center gap-2 rounded-full border border-brand/60 px-3 text-micro uppercase tracking-label text-brand hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand coarse:h-11"
                    >
                        {label(picked.id)}
                        <span className="text-fg-3">· Show both teams</span>
                        <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
                            <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
                        </svg>
                    </button>
                ) : (
                    <span className="text-micro uppercase tracking-label text-fg-3">Both teams · pick a taker to focus</span>
                )
            }
        >
            <div className="panel overflow-hidden">
                <ControlRow label="Faceoff controls">
                    <Segmented
                        label="Strength"
                        size="sm"
                        value={strength}
                        onChange={v => {
                            setStrength(v);
                            setPair(null);
                        }}
                        optionClassName="px-2"
                        options={[
                            { value: 'all', label: 'All' },
                            { value: '5v5', label: '5v5' },
                            { value: 'ev', label: 'EV' },
                            { value: 'awayPP', label: `${m.teams.away.tri} PP` },
                            { value: 'homePP', label: `${m.teams.home.tri} PP` },
                        ]}
                    />
                    <Segmented
                        label="Period"
                        size="sm"
                        value={period}
                        onChange={v => {
                            setPeriod(v);
                            setPair(null);
                        }}
                        optionClassName="px-2"
                        options={[{ value: 'all', label: 'All' }, ...periods.map(p => ({ value: String(p), label: periodLabel(p) }))]}
                    />
                    {strength === 'awayPP' || strength === 'homePP' ? (
                        <span className="text-micro uppercase tracking-label text-fg-3">
                            {m.teams[strength === 'awayPP' ? 'home' : 'away'].tri} on the kill
                        </span>
                    ) : null}
                </ControlRow>
                {!n ? <p className="p-card label">No faceoffs {period === 'all' ? 'at this strength' : 'in this view'}</p> : null}
                <div className={cn('relative grid gap-5 p-card sm:grid-cols-2 lg:grid-cols-[15.5rem_minmax(0,1fr)_15.5rem] lg:items-start', !n && 'hidden')}>
                    <div className="order-2 lg:order-1">{rail('away')}</div>
                    <div className="order-1 flex min-w-0 flex-col gap-2 sm:col-span-2 lg:order-2 lg:col-span-1">
                        <svg
                            viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`}
                            className="block h-auto w-full"
                            role="img"
                            aria-label={`${fmtInt(n)} faceoffs: ${m.teams.away.tri} won ${fmtInt(total('away'))}, ${m.teams.home.tri} won ${fmtInt(total('home'))}`}
                        >
                            <defs>
                                <clipPath id="fo-rink">
                                    <path d={RINK_PATH} />
                                </clipPath>
                            </defs>
                            <RinkMarkings />
                            {hot != null ? (
                                <rect x={THIRDS[hot].x0} y={-42.5} width={THIRDS[hot].x1 - THIRDS[hot].x0} height={85} clipPath="url(#fo-rink)" fill="rgb(var(--brand-rgb) / 0.06)" />
                            ) : null}
                            {!beads
                                ? (() => {
                                      // Too many draws for a bead each: each dot is a solid ring, the team's colour clockwise from the top up to its win share, thicker for more draws.
                                      const most = Math.max(1, ...pools.map(p => p.length));
                                      return FO_SPOTS.map(([cx, cy], k) => {
                                          const pool = pools[k];
                                          const nn = pool.length;
                                          const r = ringOf(k);
                                          const aw = pool.filter(d => d.win === 'away').length;
                                          const sw = nn ? 1.2 + 3.2 * Math.sqrt(nn / most) : 0.6;
                                          const x0 = boardX(cx);
                                          const third = x0 < -25 ? 0 : x0 > 25 ? 2 : 1;
                                          return (
                                              <g key={k} transform={`translate(${x0},${-cy})`} style={{ opacity: hot != null && hot !== third ? 0.25 : 1, transition: 'opacity 140ms' }}>
                                                  <title>{nn ? `${m.teams.away.tri} ${wl(aw, nn - aw)} (${pct(aw, nn - aw)})` : 'No draws'}</title>
                                                  {/* The rest is a thin, faint track in the opponent's colour; the team's share is the thick arc, so its end reads by shape, not by hue. */}
                                                  <circle r={r} fill="none" stroke={nn ? colors.home : 'var(--mute)'} strokeWidth={Math.max(0.6, sw * 0.4)} opacity={nn ? 0.55 : 0.3} />
                                                  {aw ? (
                                                      <circle r={r} fill="none" stroke={colors.away} strokeWidth={sw} pathLength={100} strokeDasharray={`${((aw / nn) * 100).toFixed(2)} 100`} transform="rotate(-90)" />
                                                  ) : null}
                                                  {/* Notches where the arc starts (twelve o'clock) and ends. */}
                                                  {aw && aw < nn
                                                      ? [-Math.PI / 2, -Math.PI / 2 + (aw / nn) * 2 * Math.PI].map((a, i) => {
                                                            const c = Math.cos(a);
                                                            const sn = Math.sin(a);
                                                            const r0 = r - sw / 2 - 0.4;
                                                            const r1 = r + sw / 2 + 0.4;
                                                            return <line key={i} x1={(r0 * c).toFixed(2)} y1={(r0 * sn).toFixed(2)} x2={(r1 * c).toFixed(2)} y2={(r1 * sn).toFixed(2)} stroke="var(--bg)" strokeWidth={0.9} />;
                                                        })
                                                      : null}
                                                  {/* Sparks as a density: along each side's stretch of the ring, as many as its share of wins turned into a shot (one per 15° slot at 100%). */}
                                                  {nn
                                                      ? (['away', 'home'] as Side[]).flatMap(sd => {
                                                            const won = pool.filter(d => d.win === sd);
                                                            if (!won.length) return [];
                                                            const f = won.filter(d => d.led).length / won.length;
                                                            const a0 = -Math.PI / 2 + (sd === 'away' ? 0 : (aw / nn) * 2 * Math.PI);
                                                            const span = (won.length / nn) * 2 * Math.PI;
                                                            const lit = Math.round((span / (Math.PI / 12)) * f);
                                                            const r0 = r + sw / 2 + 0.5;
                                                            const r1 = r0 + 2.6;
                                                            return Array.from({ length: lit }, (_, i) => {
                                                                const a = a0 + ((i + 0.5) * span) / lit;
                                                                const c = Math.cos(a);
                                                                const sn = Math.sin(a);
                                                                return <line key={`${sd}${i}`} x1={(r0 * c).toFixed(2)} y1={(r0 * sn).toFixed(2)} x2={(r1 * c).toFixed(2)} y2={(r1 * sn).toFixed(2)} className="stroke-fg-1" strokeWidth={0.6} strokeLinecap="round" />;
                                                            });
                                                        })
                                                      : null}
                                                  {/* Even: an index pointer outside the ring at six o'clock, lit in the team's colour once the share passes it. */}
                                                  <path
                                                      d={`M0,${(r + sw / 2 + 0.7).toFixed(2)} l1.5,2.6 h-3 Z`}
                                                      fill={nn && aw * 2 >= nn ? colors.away : 'var(--text-3)'}
                                                      opacity={nn && aw * 2 >= nn ? 1 : 0.7}
                                                  />
                                              </g>
                                          );
                                      });
                                  })()
                                : FO_SPOTS.map(([cx, cy], k) => {
                                // A game draws every draw (dimming the rest when a taker is picked); several games draw only the draws in view.
                                const ds = season ? pools[k] : byDot[k];
                                const r = ringOf(k);
                                const spots = beadSpots(ds.length, r);
                                return (
                                    <g key={k} transform={`translate(${boardX(cx)},${-cy})`}>
                                        {isNeutral(k) ? <circle r={r} fill="none" stroke="var(--line-strong)" strokeWidth={0.3} strokeDasharray="1 1.2" /> : null}
                                        {ds.map((d, i) => {
                                            const s = spots[i];
                                            const on = involved(d);
                                            const hit = vsPair(d);
                                            return (
                                                <g
                                                    key={d.e.id}
                                                    style={{ opacity: (!on ? 0.12 : pair != null && !hit ? 0.3 : 1) * (hot != null && thirdOf(d) !== hot ? 0.25 : 1), transition: 'opacity 140ms' }}
                                                >
                                                    <circle cx={s.x} cy={s.y} r={BEAD} fill={colors[d.win]} stroke={hit ? 'var(--brand)' : 'var(--bg)'} strokeWidth={hit ? 0.8 : 0.45} />
                                                    {d.led ? <Spark x={s.x} y={s.y} a={s.a} goal={d.led.type === 'goal'} /> : null}
                                                </g>
                                            );
                                        })}
                                    </g>
                                );
                            })}
                            {/* The thirds are the hover targets: the beads read by zone, not by dot. */}
                            {thirds.map((t, z) => (
                                <rect
                                    key={z}
                                    x={t.x0}
                                    y={-42.5}
                                    width={t.x1 - t.x0}
                                    height={85}
                                    fill="transparent"
                                    className="cursor-crosshair"
                                    {...bind(zoneTip(z as 0 | 1 | 2), { enter: () => setHot(z as 0 | 1 | 2), leave: () => setHot(null) })}
                                />
                            ))}
                        </svg>
                        <div className="grid grid-cols-[75fr_50fr_75fr] gap-3 text-micro uppercase tracking-label text-fg-3">
                            {thirds.map((t, z) => {
                                const tot = t.away + t.home;
                                return (
                                    <div
                                        key={z}
                                        onPointerEnter={e => e.pointerType === 'mouse' && setHot(z as 0 | 1 | 2)}
                                        onPointerLeave={e => e.pointerType === 'mouse' && setHot(null)}
                                        className={cn('flex min-w-0 flex-col gap-1 rounded-control px-2 py-1.5 transition-colors', hot === z && 'bg-surface-2')}
                                    >
                                        <span className="flex items-center justify-center gap-1.5 whitespace-nowrap">
                                            {t.dir < 0 ? <Arrow dir={-1} /> : null}
                                            {t.dir ? <Crest tri={t.dir < 0 ? m.teams.home.tri : m.teams.away.tri} size={16} className="h-4 w-4" /> : null}
                                            {t.name}
                                            {t.dir > 0 ? <Arrow dir={1} /> : null}
                                        </span>
                                        {/* Tug of war: away wins from the left, home wins from the right. */}
                                        <span className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-body font-bold normal-case tracking-normal tabular-nums">
                                            <span style={{ color: colors.away }}>{fmtInt(t.away)}</span>
                                            <span className="flex h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
                                                {tot ? (
                                                    <>
                                                        <span style={{ width: `${(t.away / tot) * 100}%`, background: colors.away }} />
                                                        <span className="flex-1" style={{ background: colors.home }} />
                                                    </>
                                                ) : null}
                                            </span>
                                            <span style={{ color: colors.home }}>{fmtInt(t.home)}</span>
                                        </span>
                                        <span className="flex justify-between gap-2 whitespace-nowrap">
                                            {/* Only the team's (or the picked taker's) win %: the other side's is the rest. */}
                                            <span>
                                                {t.caps[0]} {view === 'away' ? <Pct w={t.away} l={t.home} /> : null}
                                            </span>
                                            <span>
                                                {view === 'home' ? <Pct w={t.home} l={t.away} /> : null} {t.caps[1]}
                                            </span>
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    <div className="order-3">{rail('home')}</div>
                </div>
                <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-card py-2 text-micro uppercase tracking-label text-fg-3">
                    <span className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: colors.away }} />
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: colors.home }} />
                        {beads ? 'Bead = draw, winner\u2019s colour' : 'Ring = win share, clockwise from the top'}
                    </span>
                    <span>{beads ? 'Clockwise from the top in game order' : 'Pointer = 50% · thicker = more draws'}</span>
                    <span className="flex items-center gap-1.5">
                        <SparkIcon /> {beads ? `Shot attempt within ${DRAW_WINDOW}s` : `More sparks = more wins into a shot (${DRAW_WINDOW}s)`}
                    </span>
                    <span>{season ? 'Hover a zone for its takers' : 'Hover a zone for its draws'} · click a taker to focus</span>
                </p>
                {tip}
            </div>
        </GameSection>
    );
}

