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

const selectCls = 'min-h-9 w-full rounded-control border border-line bg-well px-2.5 text-base uppercase text-fg-1 md:text-caption coarse:min-h-11';

/** The team page's game-log filters (rendered inside a FilterSheet). */
export default function FilterControls({ filters, setFilters, goalies, opponents, hasPlayoffs }: FilterControlsProps) {
    const set = <K extends keyof TeamGameFilters>(k: K, v: TeamGameFilters[K]) => setFilters(f => ({ ...f, [k]: v }));
    return (
        <div>
            {hasPlayoffs ? (
                <Field label="Games">
                    <Segmented
                        label="Games"
                        size="sm"
                        value={filters.scope}
                        onChange={v => set('scope', v)}
                        options={[
                            { value: 'regular', label: 'Regular' },
                            { value: 'playoffs', label: 'Playoffs' },
                        ]}
                    />
                </Field>
            ) : null}
            <Field label="Recent">
                <Segmented
                    label="Recent"
                    size="sm"
                    value={String(filters.recent)}
                    onChange={v => set('recent', (v === 'All' ? 'All' : Number(v)) as Recent)}
                    options={[
                        { value: 'All', label: 'Season' },
                        { value: '5', label: 'L5' },
                        { value: '10', label: 'L10' },
                        { value: '15', label: 'L15' },
                        { value: '20', label: 'L20' },
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
                        { value: 'W', label: 'W' },
                        { value: 'L', label: 'L' },
                    ]}
                />
            </Field>
            <div className="grid grid-cols-2 gap-3">
                <Field label="Goalie">
                    <select aria-label="Starting goalie" className={selectCls} value={filters.goalie} onChange={e => set('goalie', e.target.value)}>
                        <option value="All">Any</option>
                        {goalies.map(g => (
                            <option key={g} value={g}>
                                {g}
                            </option>
                        ))}
                    </select>
                </Field>
                <Field label="Opponent">
                    <select aria-label="Opponent" className={selectCls} value={filters.opponent} onChange={e => set('opponent', e.target.value)}>
                        <option value="All">Any</option>
                        {opponents.map(o => (
                            <option key={o} value={o}>
                                {o}
                            </option>
                        ))}
                    </select>
                </Field>
            </div>
            <Field label="Period">
                <Segmented
                    label="Period"
                    size="sm"
                    value={filters.period}
                    onChange={v => set('period', v)}
                    options={(['All', '1st', '2nd', '3rd', 'OT'] as PeriodFilter[]).map(p => ({ value: p, label: p === 'All' ? 'Game' : p }))}
                />
            </Field>
            <details className="group py-1">
                <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between text-micro font-medium uppercase tracking-label text-fg-2 coarse:min-h-11">
                    Per game
                    <span aria-hidden="true" className="text-fg-3 transition-transform group-open:rotate-180">
                        ▾
                    </span>
                </summary>
                <TriField label="PP goal" value={filters.ppg} onChange={v => set('ppg', v)} />
                <TriField label="PP goal against" value={filters.ppga} onChange={v => set('ppga', v)} />
                <TriField label="First goal" value={filters.scoredFirst} onChange={v => set('scoredFirst', v)} labels={['Any', 'For', 'Against']} />
                <div className="py-3">
                    <RangeFields ranges={filters.ranges} onChange={(k, v) => setFilters(f => ({ ...f, ranges: { ...f.ranges, [k]: v } }))} />
                </div>
            </details>
        </div>
    );
}
