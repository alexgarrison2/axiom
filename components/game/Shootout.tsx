'use client';

import * as React from 'react';
import { PlayerLink } from '@/components/players/PlayerLink';
import { Crest } from '@/components/ui/crest';
import { readableTextOn } from '@/components/ui/color';
import { cn } from '@/lib/utils';
import { shortName } from '@/lib/game/analytics';
import { SIDES, other, type ShootoutAttempt, type Side } from '@/lib/game/types';
import { GameSection, useGame } from './GameContext';
import { RinkMarkings } from './Rink';

/*
 * The shootout as a duel. Down the middle, a ladder of rounds: each team's shooter on its own side (away left,
 * home right), the running score between them, the decisive goal in a solid block of its side's colour. Either
 * side of the ladder, the net each team shot at, its goalie named above, both nets facing the ladder: every
 * attempt is a numbered mark where it was released, with a schematic line in to the net (to the post it rang,
 * wide for a miss). Hover or focus a ladder card and its mark lights on the rink (cyan, the reader's stop).
 */

type Outcome = 'goal' | 'save' | 'post' | 'bar' | 'miss';

interface Shot extends ShootoutAttempt {
    /** Order in the whole shootout, 1-based. */
    seq: number;
    /** The team's attempt number (the round), 1-based. */
    round: number;
    outcome: Outcome;
}

const WORD: Record<Outcome, string> = { goal: 'Goal', save: 'Save', post: 'Post', bar: 'Crossbar', miss: 'Miss' };

function outcomeOf(a: ShootoutAttempt): Outcome {
    if (a.goal) return 'goal';
    const r = (a.reason ?? '').toLowerCase();
    if (r.includes('post')) return 'post';
    if (r.includes('crossbar') || r.includes('over')) return r.includes('crossbar') ? 'bar' : 'miss';
    return a.reason ? 'miss' : 'save';
}

/** Where the schematic line ends: the net mouth for a goal or save, the post it rang, or wide of it. */
function target(s: Shot): [number, number] {
    const r = (s.reason ?? '').toLowerCase();
    // The shooter's right is +y when he faces the net at +x.
    const side = r.includes('right') ? 1 : r.includes('left') ? -1 : (s.y ?? 0) >= 0 ? -1 : 1;
    if (s.outcome === 'post') return [89, 3 * side];
    if (s.outcome === 'miss') return [89, r.includes('high') || r.includes('over') ? 0 : 4.6 * side];
    return [89, 0];
}

export function Shootout() {
    const { m, colors, byId } = useGame();
    const [lit, setLit] = React.useState<number | null>(null);

    const shots = React.useMemo(() => {
        const n: Record<Side, number> = { away: 0, home: 0 };
        return m.shootout.map((a, i): Shot => ({ ...a, seq: i + 1, round: ++n[a.side], outcome: outcomeOf(a) }));
    }, [m.shootout]);
    if (!shots.length) return null;

    const goals = (side: Side) => shots.filter(s => s.side === side && s.goal).length;
    const tally = { away: goals('away'), home: goals('home') };
    const winner: Side | null = tally.away === tally.home ? null : tally.away > tally.home ? 'away' : 'home';
    // The decisive goal: the winner's last one (the NHL's shootout game-winner).
    const decisive = winner ? [...shots].reverse().find(s => s.side === winner && s.goal)?.seq ?? null : null;
    const rounds = Math.max(...shots.map(s => s.round));
    const firstSide = shots[0].side;
    const goalieOf = (side: Side) => {
        // The goalie in net for this side's shooters (the other team's), from the last attempt that names one.
        const id = [...shots].reverse().find(s => s.side === side && s.goalie != null)?.goalie;
        return id != null ? byId.get(id) : undefined;
    };

    return (
        <GameSection id="shootout" title="Shootout">
            <div className="panel team-wash overflow-hidden" style={{ '--ac': colors.away, '--hc': colors.home } as React.CSSProperties}>
                {/* Tally: crests flush on their sides, the shootout score between. */}
                <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-line px-card py-3 md:px-5">
                    <TeamTally side="away" won={winner === 'away'} />
                    <p className="flex flex-col items-center leading-none">
                        <span className="num-score text-[34px] tabular-nums text-fg-1 md:text-[44px]">
                            <span className={winner === 'home' ? 'text-fg-3' : undefined}>{tally.away}</span>
                            <span className="mx-1.5 text-fg-3">–</span>
                            <span className={winner === 'away' ? 'text-fg-3' : undefined}>{tally.home}</span>
                        </span>
                    </p>
                    <TeamTally side="home" won={winner === 'home'} />
                    <p className="label col-span-3 -mt-1 text-center">
                        {rounds} {rounds === 1 ? 'round' : 'rounds'}
                        {rounds > 3 ? ' · sudden death' : ''} · {m.teams[firstSide].tri} first
                    </p>
                </div>

                <div className="grid grid-cols-2 gap-3 p-card md:gap-4 md:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.55fr)_minmax(0,1fr)] lg:items-center lg:gap-5">
                    <Net side="away" shots={shots.filter(s => s.side === 'away')} lit={lit} color={colors.away} goalie={goalieOf('away')} className="order-2 lg:order-1" />

                    <ol className="order-1 col-span-2 flex flex-col gap-1.5 lg:order-2 lg:col-span-1" aria-label="Shootout rounds">
                        {Array.from({ length: rounds }, (_, i) => i + 1).map(r => {
                            const pair = Object.fromEntries(SIDES.map(sd => [sd, shots.find(s => s.side === sd && s.round === r) ?? null])) as Record<Side, Shot | null>;
                            const upTo = shots.filter(s => s.round <= r && s.goal);
                            const a = upTo.filter(s => s.side === 'away').length;
                            const h = upTo.filter(s => s.side === 'home').length;
                            return (
                                <li key={r} className="grid grid-cols-[minmax(0,1fr)_3.25rem_minmax(0,1fr)] items-stretch gap-1.5 md:grid-cols-[minmax(0,1fr)_4rem_minmax(0,1fr)] md:gap-2">
                                    {SIDES.map(sd => {
                                        const s = pair[sd];
                                        const card = s ? (
                                            <Attempt key={sd} s={s} decisive={s.seq === decisive} lit={lit === s.seq} onLit={setLit} />
                                        ) : (
                                            <span key={sd} className={cn('flex min-h-14 items-center rounded-control border border-dashed border-line px-3 text-micro uppercase tracking-label text-fg-disabled', sd === 'home' && 'justify-end')}>
                                                Not needed
                                            </span>
                                        );
                                        return sd === 'away' ? (
                                            <React.Fragment key={sd}>
                                                {card}
                                                <span className="flex flex-col items-center justify-center rounded-control bg-well leading-none">
                                                    <span className="text-micro uppercase tracking-label text-fg-3">Rd {r}</span>
                                                    <span className="mt-1 font-display text-[17px] font-bold tabular-nums text-fg-1">
                                                        {a}–{h}
                                                    </span>
                                                </span>
                                            </React.Fragment>
                                        ) : (
                                            card
                                        );
                                    })}
                                </li>
                            );
                        })}
                    </ol>

                    <Net side="home" shots={shots.filter(s => s.side === 'home')} lit={lit} color={colors.home} goalie={goalieOf('home')} className="order-3" />
                </div>
            </div>
        </GameSection>
    );
}

function TeamTally({ side, won }: { side: Side; won: boolean }) {
    const { m } = useGame();
    const home = side === 'home';
    return (
        <div className={cn('flex min-w-0 items-center gap-2.5 md:gap-3', home && 'flex-row-reverse text-right')}>
            <Crest tri={m.teams[side].tri} size={56} className={cn('h-10 w-10 shrink-0 md:h-14 md:w-14', !won && 'opacity-60')} />
            <span className="min-w-0 leading-tight">
                <span className={cn('block truncate font-display text-[17px] font-bold uppercase md:text-h3', won ? 'text-fg-1' : 'text-fg-3')}>{m.teams[side].tri}</span>
                <span className={cn('block text-micro font-bold uppercase tracking-label', won ? 'text-pos' : 'text-fg-3')}>{won ? 'Wins' : ' '}</span>
            </span>
        </div>
    );
}

/**
 * One attempt on the ladder, on its team's side: headshot ringed in the side colour, the shooter, shot type and
 * the result. A goal fills the ring; the decisive goal turns the whole card into a block of the side's colour.
 */
function Attempt({ s, decisive, lit, onLit }: { s: Shot; decisive: boolean; lit: boolean; onLit: (seq: number | null) => void }) {
    const { m, colors, byId } = useGame();
    const p = s.player != null ? byId.get(s.player) : undefined;
    const color = colors[s.side];
    const home = s.side === 'home';
    const ink = decisive ? readableTextOn(color) : undefined;
    const goalie = s.goalie != null ? byId.get(s.goalie) : undefined;
    const label = `Round ${s.round}, ${m.teams[s.side].tri} ${p ? `${p.first} ${p.last}` : 'shooter'}: ${WORD[s.outcome].toLowerCase()}${s.shotType ? `, ${s.shotType}` : ''}${goalie ? ` on ${goalie.last}` : ''}${decisive ? ', shootout winner' : ''}`;
    return (
        <div
            tabIndex={0}
            aria-label={label}
            onPointerEnter={() => onLit(s.seq)}
            onPointerLeave={() => onLit(null)}
            onFocus={() => onLit(s.seq)}
            onBlur={() => onLit(null)}
            className={cn(
                'relative flex min-h-14 min-w-0 items-center gap-2 rounded-control border px-2 py-1.5 transition-[border-color,background-color] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand md:gap-2.5 md:px-2.5',
                home && 'flex-row-reverse text-right',
                decisive ? 'border-transparent' : lit ? 'border-brand/70 bg-surface-2' : s.goal ? 'border-line-strong bg-surface-2/60' : 'border-line',
            )}
            style={decisive ? { background: color, color: ink } : undefined}
        >
            <span className="relative h-9 w-9 shrink-0 max-sm:hidden md:h-10 md:w-10">
                <span
                    className="block h-full w-full overflow-hidden rounded-full border-2 bg-surface-2"
                    style={{ borderColor: decisive ? ink : color, opacity: s.goal || decisive ? 1 : 0.55 }}
                >
                    {/* eslint-disable-next-line @next/next/no-img-element -- NHL headshots are pre-sized PNGs */}
                    {p?.headshot ? <img src={p.headshot} alt="" width={40} height={40} loading="lazy" className={cn('headshot h-full w-full', !s.goal && !decisive && 'grayscale')} /> : null}
                </span>
            </span>
            <span className="min-w-0 flex-1 leading-tight">
                <span className={cn('block truncate text-caption font-semibold', decisive ? '' : s.goal ? 'text-fg-1' : 'text-fg-2')}>
                    {p ? (
                        <PlayerLink id={p.id} className={decisive ? 'hover:text-current' : undefined}>
                            {shortName(p)}
                        </PlayerLink>
                    ) : (
                        '—'
                    )}
                </span>
                <span className={cn('mt-0.5 flex items-center gap-1.5 text-micro uppercase tracking-wide', home && 'justify-end', decisive ? 'opacity-80' : 'text-fg-3')}>
                    {/* Phones: the result rides on this line instead of its own column. */}
                    <span className={cn('shrink-0 font-bold sm:hidden', decisive ? '' : s.outcome === 'save' ? 'text-goalie' : s.goal ? '' : 'text-fg-2')} style={!decisive && s.goal ? { color } : undefined}>
                        {decisive ? 'Winner' : WORD[s.outcome]}
                    </span>
                    {s.shotType ? <span className="truncate">{s.shotType}</span> : null}
                </span>
            </span>
            <span className={cn('flex shrink-0 flex-col leading-none', home ? 'items-start' : 'items-end')}>
                <span
                    className={cn(
                        'font-display text-[15px] font-bold uppercase tracking-wide max-sm:hidden md:text-[16px]',
                        decisive ? '' : s.outcome === 'goal' ? 'text-fg-1' : s.outcome === 'save' ? 'text-goalie' : 'text-fg-3',
                    )}
                    style={!decisive && s.goal ? { color } : undefined}
                >
                    {WORD[s.outcome]}
                </span>
                {decisive ? <span className="mt-1 text-micro font-bold uppercase tracking-label max-sm:hidden">Winner</span> : null}
                {s.clip ? (
                    <a
                        href={s.clip}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn('inline-flex items-center gap-1 text-micro uppercase tracking-label hover:underline coarse:min-h-8 sm:mt-1', decisive ? '' : 'text-brand')}
                    >
                        Clip
                        <svg viewBox="0 0 8 8" className="h-2 w-2" aria-hidden="true">
                            <path d="M2 6 6 2M3 2h3v3" fill="none" stroke="currentColor" strokeWidth="1.2" />
                        </svg>
                        <span className="sr-only">(opens nhl.com)</span>
                    </a>
                ) : null}
            </span>
        </div>
    );
}

/**
 * The net one team shot at, cropped close around the crease and turned to face the ladder (the away team's
 * target opens to the right, the home team's to the left). Each attempt is a numbered mark at its release point
 * with a schematic line in; goals are solid in the side colour, saves and misses hollow, a post rings its post.
 */
function Net({ side, shots, lit, color, goalie, className }: { side: Side; shots: Shot[]; lit: number | null; color: string; goalie?: { id: number; first: string; last: string }; className?: string }) {
    const { m } = useGame();
    const saves = shots.filter(s => s.outcome === 'save').length;
    const onNet = shots.filter(s => s.outcome === 'goal' || s.outcome === 'save').length;
    const located = shots.filter(s => s.x != null && s.y != null);
    const mirror = side === 'home';
    const tx = (x: number) => (mirror ? 150 - x : x);
    return (
        <figure className={cn('flex min-w-0 flex-col gap-2', className)}>
            <figcaption className={cn('flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-micro uppercase tracking-label text-fg-3', mirror && 'flex-row-reverse')}>
                <span>
                    <span className="font-bold" style={{ color }}>
                        {m.teams[side].tri}
                    </span>{' '}
                    shooters
                </span>
                {goalie ? (
                    <span className="whitespace-nowrap normal-case tracking-normal">
                        <span className="font-semibold text-goalie">{goalie.last}</span>{' '}
                        <span className="tabular-nums">
                            {saves}/{onNet} SV
                        </span>
                        <span className="sr-only"> for {m.teams[other(side)].tri}</span>
                    </span>
                ) : null}
            </figcaption>
            {located.length ? (
                <svg
                    viewBox="50 -26 50 52"
                    className="block w-full rounded-control"
                    role="img"
                    aria-label={`${m.teams[side].tri} shootout attempts on ${goalie?.last ?? 'the net'}: ${shots.map(s => `${s.round} ${WORD[s.outcome].toLowerCase()}`).join(', ')}`}
                >
                    <g transform={mirror ? 'translate(150 0) scale(-1 1)' : undefined}>
                        <RinkMarkings half />
                        {/* Net mouth: posts as bright pegs so a post shot has something to ring. */}
                        <circle cx={89} cy={-3} r={0.55} className="fill-fg-2" />
                        <circle cx={89} cy={3} r={0.55} className="fill-fg-2" />
                    </g>
                    {located.map(s => {
                        const x = tx(s.x!);
                        const y = s.y!;
                        const [ex, ey] = target(s);
                        const on = lit === s.seq;
                        const goal = s.outcome === 'goal';
                        return (
                            <g key={s.seq} className="transition-opacity" opacity={lit != null && !on ? 0.3 : 1}>
                                <line
                                    x1={x}
                                    y1={y}
                                    x2={tx(ex)}
                                    y2={ey}
                                    stroke={on ? 'var(--brand)' : color}
                                    strokeWidth={goal ? 0.7 : 0.45}
                                    strokeDasharray={goal ? undefined : '1.2 1'}
                                    strokeLinecap="round"
                                    opacity={goal || on ? 0.95 : 0.6}
                                />
                                {s.outcome === 'post' || s.outcome === 'bar' ? <circle cx={tx(ex)} cy={ey} r={1.3} fill="none" stroke={on ? 'var(--brand)' : color} strokeWidth={0.45} /> : null}
                                {s.outcome === 'save' ? <line x1={tx(87.6)} x2={tx(87.6)} y1={-1.6} y2={1.6} stroke="var(--goalie)" strokeWidth={0.7} strokeLinecap="round" opacity={on ? 1 : 0.7} /> : null}
                                {on ? <circle cx={x} cy={y} r={3.3} fill="none" stroke="var(--brand)" strokeWidth={0.5} /> : null}
                                <circle cx={x} cy={y} r={2.3} fill={goal ? color : 'var(--surface-1)'} stroke={color} strokeWidth={goal ? 0.5 : 0.6} />
                                <text x={x} y={y} dy="0.36em" textAnchor="middle" fontSize={2.6} fontWeight={700} fill={goal ? readableTextOn(color) : color} className="tabular-nums">
                                    {s.round}
                                </text>
                            </g>
                        );
                    })}
                </svg>
            ) : (
                <p className="label rounded-control border border-dashed border-line p-3">No shot locations</p>
            )}
        </figure>
    );
}
