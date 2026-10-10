'use client';

import * as React from 'react';
import { FilterChip } from '@/components/ui/filter-chip';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/utils';
import { gameIndexAt, inPeriod, isUnblocked, matchTeamStrength, periodLabel, shortName, type TeamStrength } from '@/lib/game/analytics';
import { SIDES, type GameEvent, type Side } from '@/lib/game/types';
import { ControlRow } from './ControlRow';
import { GameSection, useGame } from './GameContext';
import { RinkMarkings } from './Rink';
import { Rink3D } from '@/components/rink/Rink3D';
import { ShotDetail, ShotMapFrame, ShotSummary, geometry, useShotPick, type ShotInfo, type ShotPerson } from '@/components/rink/ShotDetail';
import { OPP_GOALIE } from '@/lib/game/season';
import type { ShotRow } from '@/lib/shots';

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
                <span className="text-model">{xg.toFixed(2)} xG</span> · {n} unblocked · {blocked} blocked
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
        () => base.filter(e => e.side === side && e.type !== 'block' && kinds.has(e.type as Kind) && (player === 'all' || String(e.player) === player)),
        [base, side, kinds, player],
    );
    const rows = React.useMemo(() => shown.map(toRow), [shown]);
    const shooters = [...new Set(base.filter(e => e.side === side).map(e => e.player).filter((p): p is number => p != null))]
        .map(id => byId.get(id))
        .filter(Boolean)
        .sort((a, b) => a!.last.localeCompare(b!.last));
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
                        <Segmented label="Team" size="sm" value={side} onChange={pickSide} optionClassName="px-2.5" options={SIDES.map(sd => ({ value: sd, label: m.teams[sd].tri }))} />
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
                            <label className="sr-only" htmlFor="shot-player">
                                Shooter
                            </label>
                            <select
                                id="shot-player"
                                value={player}
                                onChange={e => setPlayer(e.target.value)}
                                className="h-8 min-w-0 max-w-[12rem] rounded-control border border-line bg-surface-1 px-2 text-caption uppercase tracking-wide text-fg-1 hover:border-line-strong coarse:h-11 md:ml-auto"
                            >
                                <option value="all">All shooters</option>
                                {shooters.map(p => (
                                    <option key={p!.id} value={p!.id}>
                                        {shortName(p)}
                                    </option>
                                ))}
                            </select>
                        </>
                    ) : null}
                </ControlRow>

                {view === 'map' ? (
                    <div className="p-card">
                        <ShotMapFrame
                            map={
                                <Rink3D
                                    shots={rows}
                                    mode="shots"
                                    tone="pos"
                                    goalColor={colors[side]}
                                    maxWidth={1100}
                                    label={`${m.teams[side].tri} shot attempts: ${shown.filter(e => e.type === 'goal').length} goals, ${shown.filter(e => e.type === 'shot').length} saved, ${shown.filter(e => e.type === 'miss').length} missed.`}
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
                                                ['Attempts', shown.length],
                                                ['Goals', shown.filter(e => e.type === 'goal').length],
                                                ['On target', `${shown.filter(e => e.type === 'goal' || e.type === 'shot').length} of ${shown.length}`],
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
                                        <span className="text-fg-2 sm:hidden">{`${unb.length}\u00a0unblocked ·\u00a0${evs.filter(e => e.type === 'block').length}\u00a0blocked`}</span>
                                        <span className="hidden text-fg-2 sm:inline">
                                            {unb.length} unblocked · {evs.filter(e => e.type === 'block').length} blocked
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
