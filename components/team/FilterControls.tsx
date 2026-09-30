'use client';

import * as React from 'react';
import { Segmented } from '@/components/ui/segmented';
import { Field, RangeFields, TriField } from '@/components/teams-table/FilterFields';
import type { PeriodFilter } from '@/utils/team-stats/types';
import type { Recent, TeamGameFilters } from './game-log-model';

interface FilterControlsProps {
    filters: TeamGameFilters;
    setFilters: React.Dispatch<React.SetStateAction<TeamGameFilters>>;
    goalies: string[];
    opponents: string[];
    hasPlayoffs: boolean;
}

const selectCls =
    'min-h-10 w-full rounded-control border border-line bg-surface-2 px-3 text-base text-fg-1 md:text-body-sm coarse:min-h-11';

/** The team page's game-log filters (rendered inside a FilterSheet). */
export default function FilterControls({ filters, setFilters, goalies, opponents, hasPlayoffs }: FilterControlsProps) {
    const set = <K extends keyof TeamGameFilters>(k: K, v: TeamGameFilters[K]) => setFilters(f => ({ ...f, [k]: v }));
    return (
        <div>
            {hasPlayoffs ? (
                <Field label="Games">
                    <Segmented
                        label="Games"
                        value={filters.scope}
                        onChange={v => set('scope', v)}
                        options={[
                            { value: 'regular', label: 'Regular season' },
                            { value: 'playoffs', label: 'Playoffs' },
                        ]}
                    />
                </Field>
            ) : null}
            <Field label="Recent form">
                <Segmented
                    label="Recent form"
                    size="sm"
                    value={String(filters.recent)}
                    onChange={v => set('recent', (v === 'All' ? 'All' : Number(v)) as Recent)}
                    options={[
                        { value: 'All', label: 'Season' },
                        { value: '5', label: 'Last 5' },
                        { value: '10', label: 'Last 10' },
                        { value: '15', label: 'Last 15' },
                        { value: '20', label: 'Last 20' },
                    ]}
                />
            </Field>
            <Field label="Location">
                <Segmented
                    label="Location"
                    size="sm"
                    value={filters.location}
                    onChange={v => set('location', v)}
                    options={[
                        { value: 'All', label: 'All' },
                        { value: 'Home', label: 'Home' },
                        { value: 'Away', label: 'Away' },
                    ]}
                />
            </Field>
            <Field label="Result">
                <Segmented
                    label="Result"
                    size="sm"
                    value={filters.result}
                    onChange={v => set('result', v)}
                    options={[
                        { value: 'All', label: 'All' },
                        { value: 'W', label: 'Wins' },
                        { value: 'L', label: 'Losses' },
                    ]}
                />
            </Field>
            <Field label="Starting goalie">
                <select aria-label="Starting goalie" className={selectCls} value={filters.goalie} onChange={e => set('goalie', e.target.value)}>
                    <option value="All">Any goalie</option>
                    {goalies.map(g => (
                        <option key={g} value={g}>
                            {g}
                        </option>
                    ))}
                </select>
            </Field>
            <Field label="Opponent">
                <select aria-label="Opponent" className={selectCls} value={filters.opponent} onChange={e => set('opponent', e.target.value)}>
                    <option value="All">Any opponent</option>
                    {opponents.map(o => (
                        <option key={o} value={o}>
                            {o}
                        </option>
                    ))}
                </select>
            </Field>
            <Field label="Period" hint="Power-play and empty-net stats are full-game only.">
                <Segmented
                    label="Period"
                    size="sm"
                    value={filters.period}
                    onChange={v => set('period', v)}
                    options={(['All', '1st', '2nd', '3rd', 'OT'] as PeriodFilter[]).map(p => ({ value: p, label: p === 'All' ? 'Full game' : p }))}
                />
            </Field>
            <details className="group py-2">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-body-sm font-semibold text-fg-1">
                    Per-game conditions
                    <span aria-hidden="true" className="text-fg-3 transition-transform group-open:rotate-180">
                        ▾
                    </span>
                </summary>
                <TriField label="Scored a power-play goal" value={filters.ppg} onChange={v => set('ppg', v)} />
                <TriField label="Allowed a power-play goal" value={filters.ppga} onChange={v => set('ppga', v)} />
                <TriField label="Scored first" value={filters.scoredFirst} onChange={v => set('scoredFirst', v)} labels={['Any', 'Scored first', 'Trailed first']} />
                <div className="py-4">
                    <RangeFields ranges={filters.ranges} onChange={(k, v) => setFilters(f => ({ ...f, ranges: { ...f.ranges, [k]: v } }))} />
                </div>
            </details>
        </div>
    );
}
