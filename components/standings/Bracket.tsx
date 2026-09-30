'use client';

import * as React from 'react';
import { Segmented } from '@/components/ui/segmented';
import { TEAM_NAMES } from '@/components/ui/team-color';
import { TeamLogo } from '@/components/views/TeamLogo';
import { fmtProb, pctTone } from '@/components/views/format';
import { cn } from '@/lib/utils';
import { seriesOdds, type Conference, type ConferenceSeeding, type Seed, type TeamStrength } from './model';

export interface BracketProps {
    seeding: Record<Conference, ConferenceSeeding>;
    strengths: Record<string, TeamStrength>;
    /** Tricode → league order (0 = best), used for home ice in the Final. */
    leagueOrder: Record<string, number>;
}

type SeriesId = string;

interface SeriesSlot {
    id: SeriesId;
    round: 1 | 2 | 3 | 4;
    conference: Conference | 'Final';
    top: Seed | null;
    bottom: Seed | null;
}

const ROUND_NAMES: Record<number, string> = { 1: 'First round', 2: 'Second round', 3: 'Conference final', 4: 'Stanley Cup Final' };

/** Which later series a pick in `id` feeds (cleared when the pick changes). */
function downstreamOf(id: SeriesId): SeriesId[] {
    const [conf, round, idx] = id.split('-');
    if (id === 'final') return [];
    if (round === 'cf') return ['final'];
    if (round === 'r2') return [`${conf}-cf`, 'final'];
    return [`${conf}-r2-${Math.floor(Number(idx) / 2)}`, `${conf}-cf`, 'final'];
}

function buildSlots(seeding: Record<Conference, ConferenceSeeding>, picks: Record<SeriesId, string>): Record<SeriesId, SeriesSlot> {
    const slots: Record<SeriesId, SeriesSlot> = {};
    const seedOf = new Map<string, Seed>();
    for (const conf of ['West', 'East'] as Conference[]) for (const pair of seeding[conf].r1) for (const s of pair) seedOf.set(s.tri, s);
    const winner = (id: SeriesId): Seed | null => {
        const slot = slots[id];
        const tri = picks[id];
        if (!slot || !tri) return null;
        if (slot.top?.tri === tri) return slot.top;
        if (slot.bottom?.tri === tri) return slot.bottom;
        return null;
    };
    for (const conf of ['West', 'East'] as Conference[]) {
        seeding[conf].r1.forEach(([a, b], i) => {
            slots[`${conf}-r1-${i}`] = { id: `${conf}-r1-${i}`, round: 1, conference: conf, top: a, bottom: b };
        });
        for (let j = 0; j < 2; j++) {
            slots[`${conf}-r2-${j}`] = { id: `${conf}-r2-${j}`, round: 2, conference: conf, top: winner(`${conf}-r1-${2 * j}`), bottom: winner(`${conf}-r1-${2 * j + 1}`) };
        }
        slots[`${conf}-cf`] = { id: `${conf}-cf`, round: 3, conference: conf, top: winner(`${conf}-r2-0`), bottom: winner(`${conf}-r2-1`) };
    }
    slots.final = { id: 'final', round: 4, conference: 'Final', top: winner('West-cf'), bottom: winner('East-cf') };
    return slots;
}

export function Bracket({ seeding, strengths, leagueOrder }: BracketProps) {
    const [picks, setPicks] = React.useState<Record<SeriesId, string>>({});
    const [tab, setTab] = React.useState<'West' | 'East' | 'Final'>('West');
    const slots = React.useMemo(() => buildSlots(seeding, picks), [seeding, picks]);
    const champion = picks.final && (slots.final.top?.tri === picks.final || slots.final.bottom?.tri === picks.final) ? picks.final : null;

    const advance = React.useCallback((id: SeriesId, tri: string) => {
        setPicks(prev => {
            if (prev[id] === tri) {
                // Pressing the picked team again un-picks it.
                const next = { ...prev };
                delete next[id];
                for (const d of downstreamOf(id)) delete next[d];
                return next;
            }
            const next = { ...prev, [id]: tri };
            for (const d of downstreamOf(id)) if (next[d] && next[d] !== tri) delete next[d];
            return next;
        });
    }, []);

    const odds = React.useCallback(
        (slot: SeriesSlot): { top: number; bottom: number } | null => {
            if (!slot.top || !slot.bottom) return null;
            // Home ice: the better seed (by conference seed, or league order in the Final).
            const topHigher =
                slot.round === 4 ? (leagueOrder[slot.top.tri] ?? 99) <= (leagueOrder[slot.bottom.tri] ?? 99) : slot.top.rank <= slot.bottom.rank;
            const [hi, lo] = topHigher ? [slot.top, slot.bottom] : [slot.bottom, slot.top];
            const p = seriesOdds(strengths[hi.tri], strengths[lo.tri]);
            return topHigher ? { top: p, bottom: 1 - p } : { top: 1 - p, bottom: p };
        },
        [strengths, leagueOrder],
    );

    const card = (id: SeriesId) => <SeriesCard key={id} slot={slots[id]} odds={odds(slots[id])} pick={picks[id]} onAdvance={advance} />;
    const conferenceRounds = (conf: Conference) => [
        { round: 1, ids: [0, 1, 2, 3].map(i => `${conf}-r1-${i}`) },
        { round: 2, ids: [0, 1].map(j => `${conf}-r2-${j}`) },
        { round: 3, ids: [`${conf}-cf`] },
    ];

    const hasPicks = Object.keys(picks).length > 0;

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-body-sm text-fg-2">
                    <span className="coarse:hidden">Click a team, or press Enter on it, to advance it.</span>
                    <span className="hidden coarse:inline">Tap a team to advance it.</span> Series odds come from the model&apos;s team ratings.
                </p>
                <button
                    type="button"
                    onClick={() => setPicks({})}
                    disabled={!hasPicks}
                    className="inline-flex min-h-9 items-center rounded-control border border-line-strong px-3 text-body-sm font-semibold text-fg-1 transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:text-fg-disabled coarse:min-h-11"
                >
                    Reset bracket
                </button>
            </div>

            {/* Phones and tablets: one conference at a time, rounds stacked. */}
            <div className="flex flex-col gap-4 lg:hidden">
                <Segmented
                    label="Bracket section"
                    block
                    options={[
                        { value: 'West', label: 'West' },
                        { value: 'East', label: 'East' },
                        { value: 'Final', label: 'Final' },
                    ]}
                    value={tab}
                    onChange={setTab}
                />
                {tab === 'Final' ? (
                    <div className="flex flex-col gap-3">
                        <RoundHeading round={4} />
                        {card('final')}
                        <Champion tri={champion} />
                    </div>
                ) : (
                    conferenceRounds(tab).map(r => (
                        <div key={r.round} className="flex flex-col gap-2">
                            <RoundHeading round={r.round} />
                            <ol className="grid gap-2 sm:grid-cols-2">{r.ids.map(id => <li key={id}>{card(id)}</li>)}</ol>
                        </div>
                    ))
                )}
            </div>

            {/* Desktop: the full bracket, West → Final ← East. */}
            <div className="hidden lg:block">
                <div className="grid grid-cols-7 gap-3">
                    {[...conferenceRounds('West'), { round: 4, ids: ['final'] }, ...conferenceRounds('East').reverse()].map((r, col) => (
                        <div key={col} className="flex flex-col">
                            <p className="hud-label mb-2 text-center">
                                {r.round === 4 ? 'Final' : `${col < 3 ? 'West' : 'East'} · ${r.round === 3 ? 'Conf. final' : `Round ${r.round}`}`}
                            </p>
                            <ol className="flex flex-1 flex-col justify-around gap-3">
                                {r.ids.map(id => (
                                    <li key={id}>
                                        {card(id)}
                                        {id === 'final' ? <Champion tri={champion} className="mt-3" /> : null}
                                    </li>
                                ))}
                            </ol>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function RoundHeading({ round }: { round: number }) {
    return <h3 className="hud-label">{ROUND_NAMES[round]}</h3>;
}

function SeriesCard({
    slot,
    odds,
    pick,
    onAdvance,
}: {
    slot: SeriesSlot;
    odds: { top: number; bottom: number } | null;
    pick?: string;
    onAdvance: (id: SeriesId, tri: string) => void;
}) {
    const decided = !!pick && (slot.top?.tri === pick || slot.bottom?.tri === pick);
    const label = slot.top && slot.bottom ? `${ROUND_NAMES[slot.round]}: ${slot.top.tri} vs ${slot.bottom.tri}` : `${ROUND_NAMES[slot.round]}: to be decided`;
    return (
        <div role="group" aria-label={label} className="overflow-hidden rounded-control border border-line bg-surface-1 shadow-card">
            <TeamLine slotId={slot.id} seed={slot.top} p={odds?.top} picked={decided && pick === slot.top?.tri} eliminated={decided && pick !== slot.top?.tri} onAdvance={onAdvance} />
            <div className="h-px bg-line" />
            <TeamLine slotId={slot.id} seed={slot.bottom} p={odds?.bottom} picked={decided && pick === slot.bottom?.tri} eliminated={decided && pick !== slot.bottom?.tri} onAdvance={onAdvance} />
        </div>
    );
}

function TeamLine({
    slotId,
    seed,
    p,
    picked,
    eliminated,
    onAdvance,
}: {
    slotId: SeriesId;
    seed: Seed | null;
    p?: number;
    picked: boolean;
    eliminated: boolean;
    onAdvance: (id: SeriesId, tri: string) => void;
}) {
    if (!seed) {
        return (
            <div className="flex min-h-11 items-center gap-2 px-2.5 text-body-sm italic text-fg-3">
                <span aria-hidden="true" className="inline-block h-6 w-6 rounded-full border border-dashed border-line-strong" />
                Winner advances
            </div>
        );
    }
    const name = TEAM_NAMES[seed.tri]?.short ?? seed.tri;
    return (
        <button
            type="button"
            aria-pressed={picked}
            aria-label={`${picked ? 'Advanced' : 'Advance'} ${name} (${seed.label})${p != null ? `, ${fmtProb(p)} to win the series` : ''}`}
            onClick={() => onAdvance(slotId, seed.tri)}
            className={cn(
                'group flex min-h-11 w-full items-center gap-2 px-2.5 text-left transition-colors',
                picked ? 'bg-brand/10 shadow-[inset_3px_0_0_rgb(var(--brand-rgb))]' : 'hover:bg-surface-2',
                eliminated && 'opacity-55',
            )}
        >
            <TeamLogo tri={seed.tri} size={24} />
            <span className="w-7 shrink-0 font-mono text-micro text-fg-3">{seed.label}</span>
            <span className={cn('min-w-0 flex-1 truncate font-semibold', picked ? 'text-fg-1' : 'text-fg-1', eliminated && 'line-through decoration-fg-3')}>
                {seed.tri}
            </span>
            {picked ? (
                <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 shrink-0 text-brand">
                    <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            ) : null}
            {p != null ? (
                <span className="shrink-0 text-body-sm font-bold tabular-nums" style={{ color: pctTone(p * 100) }}>
                    {fmtProb(p)}
                </span>
            ) : null}
        </button>
    );
}

function Champion({ tri, className }: { tri: string | null; className?: string }) {
    if (!tri) {
        return (
            <p className={cn('rounded-control border border-dashed border-line-strong px-3 py-3 text-center text-body-sm text-fg-3', className)}>
                Pick a champion
            </p>
        );
    }
    return (
        <div
            role="status"
            className={cn(
                'relative flex flex-col items-center gap-1 overflow-hidden rounded-control border border-brand/40 bg-brand/10 px-3 py-4 text-center motion-safe:animate-pop-in',
                className,
            )}
        >
            <TeamLogo tri={tri} size={48} />
            <span className="hud-label text-brand">Your champion</span>
            <span className="text-title font-black italic uppercase tracking-tight text-fg-1">{TEAM_NAMES[tri]?.short ?? tri}</span>
        </div>
    );
}

export default Bracket;
