'use client';

import * as React from 'react';
import { FilterChip } from '@/components/ui/filter-chip';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/utils';
import { gameIndexAt, inPeriod, isUnblocked, matchTeamStrength, periodLabel, shortName, type TeamStrength } from '@/lib/game/analytics';
import { SIDES, type GameEvent, type Side } from '@/lib/game/types';
import { ControlRow } from './ControlRow';
import { GameSection, sideTeams, useGame } from './GameContext';
import { RinkMarkings } from './Rink';
import { Rink3D } from '@/components/rink/Rink3D';
import { Crest } from '@/components/ui/crest';
import { ShotDetail, ShotMapFrame, ShotSummary, geometry, useShotPick, type ShotInfo, type ShotPerson } from '@/components/rink/ShotDetail';
import { OPP_GOALIE } from '@/lib/game/season';
import type { ShotRow } from '@/lib/shots';
import { TeamToggle } from '@/components/ui/team-toggle';
import { fmtInt } from '@/components/views/format';
import { JerseyNumber } from './Jersey';

type Kind = 'goal' | 'shot' | 'miss' | 'block';
const KINDS: { kind: Kind; label: string }[] = [
    { kind: 'goal', label: 'Goals' },
    { kind: 'shot', label: 'Saved' },
    { kind: 'miss', label: 'Missed' },
    { kind: 'block', label: 'Blocked' },
];

/**
 * A shot as a row for the tilted rink, turned toward the net it attacked (at +89 ft), keeping the
 * flat map's left and right: home attacks +x, away -x.
 */
function toRow(e: GameEvent): ShotRow {
    const home = e.side === 'home';
    const v = home ? e.x! : -e.x!;
    const u = home ? -e.y! : e.y!;
    const goal = e.type === 'goal' ? 1 : 0;
    return [0, v, u, e.xg ?? 0.02, goal, goal || e.type === 'shot' ? 1 : 0, 0, 0, 0];
}

/** Shot density over one offensive zone: a 2ft grid, Gaussian kernel, six alpha steps of the team colour. */
function Heat({ side, events, color }: { side: Side; events: GameEvent[]; color: string }) {
    const pts = events.filter(e => e.side === side && isUnblocked(e) && e.x != null).map(e => [Math.abs(e.x!), side === 'home' ? -e.y! : e.y!] as const);
    const cells = React.useMemo(() => {
        const out: { x: number; y: number; v: number }[] = [];
        if (!pts.length) return out;
        const sigma = 7;
        let max = 0;
        for (let x = 25; x < 100; x += 2) {
            for (let y = -42; y < 42.5; y += 2) {
                let v = 0;
                for (const [px, py] of pts) {
                    const d2 = (x + 1 - px) ** 2 + (y + 1 - py) ** 2;
                    v += Math.exp(-d2 / (2 * sigma * sigma));
                }
                max = Math.max(max, v);
                out.push({ x, y, v });
            }
        }
        return out.map(c => ({ ...c, v: c.v / max }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [events, side]);
    const xg = events.filter(e => e.side === side && isUnblocked(e)).reduce((a, e) => a + (e.xg ?? 0), 0);
    const n = events.filter(e => e.side === side && isUnblocked(e)).length;
    const blocked = events.filter(e => e.side === side && e.type === 'block').length;
    return (
        <figure className="min-w-0">
            <svg viewBox="0 -42.5 100 85" className="block w-full" role="img" aria-label={`Shot density for ${side}`}>
                <clipPath id={`heat-clip-${side}`}>
                    <path d="M0,-42.5 H72 A28,28 0 0 1 100,-14.5 V14.5 A28,28 0 0 1 72,42.5 H0 Z" />
                </clipPath>
                <RinkMarkings half />
                <g clipPath={`url(#heat-clip-${side})`}>
                    {cells.map((c, i) => {
                        const step = Math.floor(c.v * 6) / 6;
                        if (step < 1 / 6) return null;
                        return <rect key={i} x={c.x} y={c.y} width={2.05} height={2.05} fill={color} opacity={0.12 + step * 0.6} />;
                    })}
                </g>
            </svg>
            <figcaption className="mt-1 text-center text-micro uppercase tracking-label text-fg-3 tabular-nums">
                <span className="text-model">{xg.toFixed(2)} xG</span> · {fmtInt(n)} unblocked · {fmtInt(blocked)} blocked
            </figcaption>
        </figure>
    );
}

/** A play as the lead-up to a shot ("off a giveaway"). */
const PREV_WORD: Partial<Record<GameEvent['type'], string>> = {
    faceoff: 'faceoff',
    hit: 'hit',
    shot: 'shot on goal',
    miss: 'missed shot',
    block: 'blocked shot',
    goal: 'goal',
    penalty: 'penalty',
};

export function Shots() {
    const { m, colors, byId } = useGame();
    const [strength, setStrength] = React.useState<TeamStrength>('all');
    const [period, setPeriod] = React.useState<string>('all');
    const [kinds, setKinds] = React.useState<Set<Kind>>(new Set(['goal', 'shot', 'miss']));
    const [player, setPlayer] = React.useState<string>('all');
    // The shooter rail: a hover previews a shooter's marks, a click pins him (as the faceoff rail does).
    const [peek, setPeek] = React.useState<string | null>(null);
    const who = peek ?? player;
    // A merged season (thousands of shots) opens on density; a game on the map.
    const [view, setView] = React.useState<'map' | 'heat'>(m.starts?.length ? 'heat' : 'map');
    // The map shows one team's shots at a time, at the full width of the panel.
    const [side, setSide] = React.useState<Side>('away');

    const per = period === 'all' ? 'all' : Number(period);
    const base = React.useMemo(
        () => m.events.filter(e => (e.type === 'goal' || e.type === 'shot' || e.type === 'miss' || e.type === 'block') && e.x != null && matchTeamStrength(e, strength) && inPeriod(e, per)),
        [m.events, strength, per],
    );
    // Blocks are plotted where the defender stopped them, not where the shot came from, so the map leaves them out.
    const shown = React.useMemo(
        () => base.filter(e => e.side === side && e.type !== 'block' && kinds.has(e.type as Kind) && (who === 'all' || String(e.player) === who)),
        [base, side, kinds, who],
    );
    // Every shooter on this side under the current filters, by xG: attempts, goals and xG on the map's terms.
    const board = React.useMemo(() => {
        const rows = new Map<number, { id: number; att: number; g: number; xg: number }>();
        for (const e of base) {
            if (e.side !== side || e.type === 'block' || !kinds.has(e.type as Kind) || e.player == null) continue;
            const r = rows.get(e.player) ?? { id: e.player, att: 0, g: 0, xg: 0 };
            r.att += 1;
            r.g += e.type === 'goal' ? 1 : 0;
            r.xg += e.xg ?? 0;
            rows.set(e.player, r);
        }
        return [...rows.values()].sort((a, b) => b.xg - a.xg || b.g - a.g || b.att - a.att);
    }, [base, side, kinds]);
    const rows = React.useMemo(() => shown.map(toRow), [shown]);
    const periods = [...new Set(m.events.map(e => (e.period >= 4 ? 4 : e.period)))].sort();
    const toggle = (k: Kind) => setKinds(s => {
        const n = new Set(s);
        if (n.has(k)) n.delete(k);
        else n.add(k);
        return n;
    });
    const pick = useShotPick(shown);
    const pickSide = (s: Side) => {
        setSide(s);
        setPlayer('all');
        setPeek(null);
    };
    // Each shot's event before it on the clock (the play that led to it).
    const prevOf = React.useMemo(() => {
        const out = new Map<number, GameEvent>();
        const evs = [...m.events].sort((x, y) => x.t - y.t);
        evs.forEach((e, i) => {
            if (i > 0) out.set(e.id, evs[i - 1]);
        });
        return out;
    }, [m.events]);
    const info = (e: GameEvent): ShotInfo => {
        const r = toRow(e);
        const own = e.side === 'away' ? e.situation.away : e.situation.home;
        const opp = e.side === 'away' ? e.situation.home : e.situation.away;
        const other: Side = e.side === 'away' ? 'home' : 'away';
        // A merged season names the game a shot came from (its opponent stands in for "OPP"); a game page is that game.
        const gi = m.games ? m.games[gameIndexAt(m, e.t)] : null;
        const tri = (sd: Side) => (gi && m.teams[sd].tri === 'OPP' ? gi.opp : m.teams[sd].tri);
        const person = (id: number | null, sd: Side): ShotPerson | null => {
            const p = id != null ? byId.get(id) : undefined;
            if (!p) return null;
            const pooled = p.id === OPP_GOALIE;
            return { name: pooled ? 'Opponent goalie' : `${p.first.charAt(0)}. ${p.last}`, href: pooled ? null : `/players/${p.id}`, headshot: p.headshot, team: tri(sd) };
        };
        const prev = prevOf.get(e.id);
        const sameGame = prev && (!gi || gameIndexAt(m, prev.t) === gameIndexAt(m, e.t)) && prev.period === e.period;
        return {
            result: e.type === 'goal' ? 'goal' : e.type === 'shot' ? 'saved' : 'missed',
            xg: e.xg ?? 0,
            x: r[1],
            y: r[2],
            type: e.shotType ?? null,
            strength: `${own}v${opp}${e.emptyNet ? ' · empty net' : own > opp ? ' PP' : own < opp ? ' SH' : ''}`,
            period: e.period,
            clock: e.clock,
            lead: e.score[e.side] - e.score[other],
            before: sameGame ? { what: PREV_WORD[prev!.type] ?? prev!.type, secs: Math.max(0, Math.round(e.t - prev!.t)) } : null,
            game: gi ? { href: `/games/${gi.id}`, date: gi.date, opp: gi.opp, home: gi.home, gf: gi.gf, ga: gi.ga, outcome: gi.outcome } : null,
            shooter: person(e.player, e.side),
            goalie: person(e.other, other),
        };
    };

    return (
        <GameSection
            id="shots"
            title="Shots"
            aside={<Segmented label="Shot view" size="sm" value={view} onChange={setView} options={[{ value: 'map', label: 'Map' }, { value: 'heat', label: 'Density' }]} optionClassName="px-2.5" />}
        >
            <div className="panel overflow-hidden">
                <ControlRow label="Shot map controls">
                    {view === 'map' ? (
                        <TeamToggle value={side} onChange={pickSide} teams={sideTeams(m)} />
                    ) : null}
                    <Segmented
                        label="Strength"
                        size="sm"
                        value={strength}
                        onChange={setStrength}
                        optionClassName="px-2"
                        options={[
                            { value: 'all', label: 'All' },
                            { value: '5v5', label: '5v5' },
                            { value: 'awayPP', label: `${m.teams.away.tri} PP` },
                            { value: 'homePP', label: `${m.teams.home.tri} PP` },
                        ]}
                    />
                    <Segmented
                        label="Period"
                        size="sm"
                        value={period}
                        onChange={setPeriod}
                        optionClassName="px-2"
                        options={[{ value: 'all', label: 'All' }, ...periods.map(p => ({ value: String(p), label: periodLabel(p) }))]}
                    />
                    {view === 'map' ? (
                        <>
                            <div role="group" aria-label="Shot results" className="flex flex-wrap gap-1.5">
                                {KINDS.filter(k => k.kind !== 'block').map(k => (
                                    <FilterChip key={k.kind} selected={kinds.has(k.kind)} onSelectedChange={() => toggle(k.kind)} className="min-h-8">
                                        {k.label}
                                    </FilterChip>
                                ))}
                            </div>
                        </>
                    ) : null}
                </ControlRow>

                {view === 'map' ? (
                    <div className="grid min-w-0 gap-4 p-card lg:grid-cols-[15.5rem_minmax(0,1fr)]">
                        <ShooterRail
                            board={board}
                            side={side}
                            tri={m.teams[side].tri}
                            color={colors[side]}
                            pinned={player}
                            peek={peek}
                            onPeek={setPeek}
                            onPin={id => {
                                setPlayer(cur => (cur === id ? 'all' : id));
                                setPeek(null);
                            }}
                            name={id => {
                                const p = byId.get(id);
                                return p ? shortName(p) : '—';
                            }}
                            num={id => byId.get(id)?.num ?? null}
                            pooled={m.teams[side].tri === 'OPP'}
                            totals={{ att: base.filter(e => e.side === side && e.type !== 'block' && kinds.has(e.type as Kind)).length, xg: board.reduce((a, r) => a + r.xg, 0), g: board.reduce((a, r) => a + r.g, 0) }}
                        />
                        <div className="min-w-0">
                        <ShotMapFrame
                            map={
                                <Rink3D
                                    shots={rows}
                                    mode="shots"
                                    tone="pos"
                                    goalColor={colors[side]}
                                    maxWidth={1100}
                                    badge={
                                        m.teams[side].tri === 'OPP' ? (
                                            <span className="font-display text-h2 font-bold uppercase text-fg-3">Opp</span>
                                        ) : (
                                            // The crest fills the open ice above the left boards; smaller on a phone-width map.
                                            <Crest tri={m.teams[side].tri} size={72} className="h-10 w-10 drop-shadow-[0_6px_16px_rgba(0,0,0,.6)] sm:h-[72px] sm:w-[72px]" />
                                        )
                                    }
                                    label={`${m.teams[side].tri} shot attempts: ${fmtInt(shown.filter(e => e.type === 'goal').length)} goals, ${fmtInt(shown.filter(e => e.type === 'shot').length)} saved, ${fmtInt(shown.filter(e => e.type === 'miss').length)} missed.`}
                                    lit={pick.lit}
                                    onHover={pick.onHover}
                                    onTap={pick.onTap}
                                />
                            }
                            detail={
                                <ShotDetail
                                    info={pick.picked ? info(pick.picked) : null}
                                    accent={colors[side]}
                                    summary={
                                        <ShotSummary
                                            rows={[
                                                ['Attempts', fmtInt(shown.length)],
                                                ['Goals', fmtInt(shown.filter(e => e.type === 'goal').length)],
                                                ['On target', `${fmtInt(shown.filter(e => e.type === 'goal' || e.type === 'shot').length)} of ${fmtInt(shown.length)}`],
                                                ['xG', <span key="xg" className="text-model">{shown.reduce((a2, e) => a2 + (e.xg ?? 0), 0).toFixed(2)}</span>],
                                                ['Avg distance', shown.length ? `${Math.round(shown.reduce((a2, e) => { const r = toRow(e); return a2 + geometry(r[1], r[2]).dist; }, 0) / shown.length)} ft` : '—'],
                                            ]}
                                        />
                                    }
                                />
                            }
                        />
                        <div className="mt-2 grid grid-cols-2 gap-4 text-caption tabular-nums">
                            {SIDES.map(side => {
                                const evs = base.filter(e => e.side === side);
                                const unb = evs.filter(isUnblocked);
                                return (
                                    <p key={side} className={cn('flex flex-wrap items-baseline gap-x-2', side === 'home' && 'justify-end text-right')}>
                                        <span className="font-bold" style={{ color: colors[side] }}>
                                            {m.teams[side].tri}
                                        </span>
                                        <span className="text-model">{unb.reduce((a, e) => a + (e.xg ?? 0), 0).toFixed(2)} xG</span>
                                        {/* Phones wrap before the dot, never inside a count. */}
                                        <span className="text-fg-2 sm:hidden">{`${fmtInt(unb.length)}\u00a0unblocked ·\u00a0${fmtInt(evs.filter(e => e.type === 'block').length)}\u00a0blocked`}</span>
                                        <span className="hidden text-fg-2 sm:inline">
                                            {fmtInt(unb.length)} unblocked · {fmtInt(evs.filter(e => e.type === 'block').length)} blocked
                                        </span>
                                    </p>
                                );
                            })}
                        </div>
                        <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-micro uppercase tracking-label text-fg-3">
                            <span className="flex items-center gap-1.5">
                                <span aria-hidden="true" className="h-3 w-0.5 rounded-full" style={{ background: colors[side] }} />
                                Goal, taller = higher xG
                            </span>
                            <span className="flex items-center gap-1.5">
                                <span aria-hidden="true" className="h-2 w-3 rounded-full border border-fg-2/40 bg-fg-2/15" />
                                Saved
                            </span>
                            <span className="flex items-center gap-1.5">
                                <span aria-hidden="true" className="h-2 w-3 rounded-full border border-fg-2/40" />
                                Missed
                            </span>
                            <span>Size = xG</span>
                        </p>
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 gap-4 p-card sm:grid-cols-2">
                        {SIDES.map(side => (
                            <div key={side}>
                                <p className="mb-1 text-micro font-bold uppercase tracking-label" style={{ color: colors[side] }}>
                                    {m.teams[side].tri}
                                </p>
                                <Heat side={side} events={base} color={colors[side]} />
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </GameSection>
    );
}

interface BoardRow {
    id: number;
    att: number;
    g: number;
    xg: number;
}

/**
 * The shot map's shooter rail: "All" with the side's totals, then every shooter by xG with his sweater badge,
 * goals, attempts and an xG bar in the side colour against the side's top shooter. Hover (mouse) previews his
 * marks on the rink, a click pins him and a second click lets go; the rest fade while one is chosen. Wide
 * screens get a column beside the rink; narrower ones a sideways-scrolling strip above it.
 */
function ShooterRail({
    board,
    side,
    tri,
    color,
    pinned,
    peek,
    onPeek,
    onPin,
    name,
    num,
    pooled,
    totals,
}: {
    board: BoardRow[];
    side: Side;
    tri: string;
    color: string;
    pinned: string;
    peek: string | null;
    onPeek: (id: string | null) => void;
    onPin: (id: string) => void;
    name: (id: number) => string;
    num: (id: number) => number | null;
    pooled: boolean;
    totals: { att: number; g: number; xg: number };
}) {
    const [all, setAll] = React.useState(false);
    const top = Math.max(1e-9, ...board.map(r => r.xg));
    const LIMIT = 14;
    const rows = all ? board : board.slice(0, LIMIT);
    const active = peek ?? pinned;
    const item = (selected: boolean, faded: boolean) =>
        cn(
            'group/row grid w-full shrink-0 items-center gap-x-2 rounded-control border px-2 py-1 text-left transition-[opacity,background-color,border-color] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand max-lg:w-[11.5rem]',
            selected ? 'border-brand/60 bg-surface-2' : 'border-transparent hover:bg-surface-2/60',
            faded && 'opacity-40',
        );
    return (
        <div className="flex min-w-0 flex-col gap-2" key={side}>
            <div className="flex items-baseline justify-between gap-2">
                <p className="label">Shooters</p>
                <p className="text-micro tabular-nums text-fg-3">{fmtInt(board.length)}</p>
            </div>
            <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 scrollbar-hide lg:max-h-[27rem] lg:flex-col lg:overflow-y-auto lg:overflow-x-visible lg:pb-0 lg:[scrollbar-width:thin]" aria-label={`${tri} shooters`}>
                <li className="shrink-0">
                    <button
                        type="button"
                        aria-pressed={pinned === 'all'}
                        onClick={() => onPin('all')}
                        className={cn(item(pinned === 'all' && peek == null, false), 'grid-cols-[1.5rem_minmax(0,1fr)_auto]')}
                    >
                        {pooled ? (
                            <span className="flex h-6 w-6 items-center justify-center rounded-full border text-micro font-bold leading-none" style={{ borderColor: color, color }} aria-hidden="true">
                                O
                            </span>
                        ) : (
                            <Crest tri={tri} size={24} className="h-6 w-6 drop-shadow-none" />
                        )}
                        <span className="min-w-0">
                            <span className="block truncate text-caption font-semibold text-fg-1">All shooters</span>
                            <span className="block text-micro tabular-nums text-fg-3">
                                {fmtInt(totals.att)} att · {fmtInt(totals.g)} G
                            </span>
                        </span>
                        <span className="text-caption font-bold tabular-nums text-model">{totals.xg.toFixed(2)}</span>
                    </button>
                </li>
                {rows.map(r => {
                    const id = String(r.id);
                    const on = active === id;
                    return (
                        <li key={r.id} className="shrink-0">
                            <button
                                type="button"
                                aria-pressed={pinned === id}
                                onPointerEnter={e => e.pointerType === 'mouse' && onPeek(id)}
                                onPointerLeave={e => e.pointerType === 'mouse' && onPeek(null)}
                                onFocus={() => onPeek(id)}
                                onBlur={() => onPeek(null)}
                                onClick={() => onPin(id)}
                                className={cn(item(on, active !== 'all' && !on), 'grid-cols-[1.5rem_minmax(0,1fr)_auto]')}
                            >
                                <JerseyNumber tri={tri === 'OPP' ? 'NHL' : tri} num={num(r.id)} ring={color} size={24} />
                                <span className="flex min-w-0 flex-col gap-1">
                                    <span className="flex items-baseline gap-1.5">
                                        <span className={cn('truncate text-caption font-semibold', on ? 'text-brand' : 'text-fg-1')}>{name(r.id)}</span>
                                        {r.g ? (
                                            <span className="shrink-0 text-micro font-bold tabular-nums text-fg-1">
                                                {r.g}
                                                <span className="font-normal text-fg-3">G</span>
                                            </span>
                                        ) : null}
                                    </span>
                                    <span className="flex items-center gap-1.5">
                                        <span className="relative h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-track" aria-hidden="true">
                                            <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(r.xg / top) * 100}%`, background: color, opacity: on ? 1 : 0.7 }} />
                                        </span>
                                        <span className="shrink-0 text-micro tabular-nums text-fg-3">{fmtInt(r.att)}</span>
                                    </span>
                                </span>
                                <span className="text-caption font-semibold tabular-nums text-model">{r.xg.toFixed(2)}</span>
                            </button>
                        </li>
                    );
                })}
                {board.length > LIMIT ? (
                    <li className="shrink-0 self-center lg:self-stretch">
                        <button
                            type="button"
                            onClick={() => setAll(v => !v)}
                            className="h-8 w-full whitespace-nowrap rounded-control px-2 text-left text-micro font-medium uppercase tracking-label text-fg-3 hover:text-fg-1 coarse:h-11"
                        >
                            {all ? 'Top 14' : `All ${board.length}`}
                        </button>
                    </li>
                ) : null}
            </ul>
        </div>
    );
}
