'use client';

import * as React from 'react';
import type { SchedulePayload } from '@/lib/schedule/payload';
import { cn } from '@/lib/utils';
import { dateRange, miles, shortDate, type Focus, type Lens } from './schedule-ui';

interface LensesProps {
    payload: SchedulePayload;
    focus: Focus;
    lens: Lens;
    onFocus: (f: Focus) => void;
    onLens: (l: Lens) => void;
    onGame: (id: number) => void;
}

interface Item {
    key: string;
    label: string;
    value: React.ReactNode;
    sub: React.ReactNode;
    pressed: boolean;
    onClick: () => void;
}

const fmt1 = (n: number) => (Math.round(n * 10) / 10).toString();
const rankOf = (r: { rank: number; of: number }) => `#${r.rank} of ${r.of}`;

/**
 * The season's notable facts as a row of lenses: each one lights its games on
 * the strip, map and calendar (or focuses the trip / stretch it names).
 */
export function Lenses({ payload, focus, lens, onFocus, onLens, onGame }: LensesProps) {
    const s = payload.schedule.summary;
    const lg = payload.league;
    const games = payload.schedule.games;
    const special = games.find(g => g.event);
    const toggle = (l: Exclude<Lens, null>) => () => onLens(lens === l ? null : l);
    const items: Item[] = [
        {
            key: 'mi',
            label: 'Miles',
            value: Math.round(s.mi).toLocaleString('en-US'),
            sub: rankOf(lg.mi),
            pressed: focus.kind === 'season' && lens === null,
            onClick: () => {
                onLens(null);
                onFocus({ kind: 'season' });
            },
        },
        {
            key: 'b2b',
            label: 'B2B',
            value: s.b2b,
            sub: `Lg ${fmt1(lg.b2b.avg)} · ${s.b2bRoad} road`,
            pressed: lens === 'b2b',
            onClick: toggle('b2b'),
        },
        {
            key: 'dense',
            label: '3-in-4',
            value: s.in3of4,
            sub: `Lg ${fmt1(lg.in3of4.avg)} · 4-in-6 ${s.in4of6}`,
            pressed: lens === 'dense',
            onClick: toggle('dense'),
        },
        ...(s.longestTrip
            ? [
                  {
                      key: 'trip',
                      label: 'Long trip',
                      value: `${s.longestTrip.games} GP`,
                      sub: miles(s.longestTrip.mi),
                      pressed: focus.kind === 'trip' && focus.id === s.longestTrip.trip,
                      onClick: () => {
                          onLens(null);
                          onFocus({ kind: 'trip', id: s.longestTrip!.trip });
                      },
                  },
              ]
            : []),
        {
            key: 'rest',
            label: 'Rest',
            value: `${s.restEdge - s.restDeficit > 0 ? '+' : s.restEdge - s.restDeficit < 0 ? '−' : ''}${Math.abs(s.restEdge - s.restDeficit)}`,
            sub: `${s.restEdge} edge · ${s.restDeficit} deficit`,
            pressed: lens === 'rest',
            onClick: toggle('rest'),
        },
        {
            key: 'clock',
            label: 'Odd starts',
            value: s.matinees + s.late + s.early,
            sub: `${s.matinees} day · ${s.late + s.early} body`,
            pressed: lens === 'clock',
            onClick: toggle('clock'),
        },
        ...(s.toughest
            ? [
                  {
                      key: 'tough',
                      label: 'Toughest',
                      value: dateRange(games[s.toughest.first].date, games[s.toughest.last].date),
                      sub: `${s.toughest.last - s.toughest.first + 1} GP · diff ${Math.round(s.toughest.diff)}`,
                      pressed: focus.kind === 'range' && focus.first === s.toughest.first,
                      onClick: () => {
                          onLens(null);
                          onFocus({ kind: 'range', first: s.toughest!.first, last: s.toughest!.last });
                      },
                  },
              ]
            : []),
        ...(special && special.event
            ? [
                  {
                      key: 'special',
                      label: special.event.kind === 'global' ? 'Abroad' : special.event.kind === 'outdoor' ? 'Outdoor' : 'Neutral',
                      value: special.event.name,
                      sub: `${shortDate(special.date)} · ${special.city}`,
                      pressed: lens === 'special',
                      onClick: () => {
                          onLens(lens === 'special' ? null : 'special');
                          if (lens !== 'special') onGame(special.id);
                      },
                  },
              ]
            : []),
    ];

    return (
        <div className="-mx-4 overflow-x-auto px-4 scrollbar-hide max-md:edge-fade-right md:mx-0 md:overflow-visible md:px-0">
            <ul className="flex w-max gap-2 md:grid md:w-auto md:grid-cols-4 xl:grid-cols-8" aria-label="Season facts">
                {items.map(it => (
                    <li key={it.key} className="min-w-0">
                        <button
                            type="button"
                            aria-pressed={it.pressed}
                            onClick={it.onClick}
                            className={cn(
                                'flex h-full min-h-[64px] w-[132px] flex-col items-start justify-between gap-1 rounded-[10px] border px-3 py-2 text-left transition-[border-color,box-shadow] md:w-full',
                                it.pressed
                                    ? 'border-brand/60 shadow-[inset_0_0_12px_rgb(var(--brand-rgb)/0.12),0_0_16px_rgb(var(--brand-rgb)/0.18)]'
                                    : 'border-line hover:border-line-strong',
                            )}
                        >
                            <span className={cn('label', it.pressed && 'text-brand')}>{it.label}</span>
                            <span className="w-full truncate text-title font-bold tabular-nums text-fg-1">{it.value}</span>
                            <span className="w-full truncate text-micro tabular-nums text-fg-3">{it.sub}</span>
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
}

export default Lenses;
