'use client';

import * as React from 'react';
import { Segmented } from '@/components/ui/segmented';
import { FilterChip } from '@/components/ui/filter-chip';
import { cn } from '@/lib/utils';
import { RANGE_FILTERS, type GameLevelFilters, type RangeKey, type TriState } from '@/utils/team-stats/filter';

/** Labelled block inside a filter sheet: 1-2 word mono label, then the control. */
export function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
    const id = React.useId();
    return (
        <div role="group" aria-labelledby={id} className={cn('flex flex-col gap-2 border-b border-line py-3 last:border-b-0', className)}>
            <p id={id} className="label">
                {label}
            </p>
            {children}
        </div>
    );
}

export function TriField({ label, value, onChange, labels = ['Any', 'Yes', 'No'] }: { label: string; value: TriState; onChange: (v: TriState) => void; labels?: [string, string, string] }) {
    return (
        <Field label={label}>
            <Segmented
                label={label}
                size="sm"
                value={value}
                onChange={onChange}
                options={[
                    { value: 'All', label: labels[0] },
                    { value: 'Yes', label: labels[1] },
                    { value: 'No', label: labels[2] },
                ]}
            />
        </Field>
    );
}

/** Min / max inputs for the per-game range filters. 16px on touch (no iOS zoom). */
export function RangeFields({ ranges, onChange }: { ranges: GameLevelFilters['ranges']; onChange: (key: RangeKey, v: [string, string]) => void }) {
    return (
        <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
            {RANGE_FILTERS.map(rf => {
                const [lo, hi] = ranges[rf.key] ?? ['', ''];
                return (
                    <fieldset key={rf.key} className="min-w-0">
                        <legend className="label mb-1">{rf.label}</legend>
                        <div className="flex items-center gap-1.5">
                            {(['min', 'max'] as const).map((which, i) => (
                                <label key={which} className="flex min-w-0 flex-1 items-center gap-1 rounded-control border border-line bg-well px-1.5 focus-within:border-brand/60">
                                    <span className="text-micro uppercase text-fg-3">{which}</span>
                                    <input
                                        type="number"
                                        inputMode="decimal"
                                        step={rf.step}
                                        value={i === 0 ? lo : hi}
                                        onChange={e => onChange(rf.key, i === 0 ? [e.target.value, hi] : [lo, e.target.value])}
                                        aria-label={`${rf.title} ${which}imum`}
                                        className="min-h-8 w-full min-w-0 bg-transparent text-base text-fg-1 tabular-nums outline-none placeholder:text-fg-3 md:text-caption coarse:min-h-11 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                        placeholder="—"
                                    />
                                </label>
                            ))}
                        </div>
                    </fieldset>
                );
            })}
        </div>
    );
}

/** Wrapping row of toggle chips (multi-select). */
export function ChipRow<T extends string>({
    options,
    selected,
    onToggle,
    label,
}: {
    options: { value: T; label: string }[];
    selected: T[];
    onToggle: (v: T) => void;
    label: string;
}) {
    return (
        <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
            {options.map(o => (
                <FilterChip key={o.value} selected={selected.includes(o.value)} onSelectedChange={() => onToggle(o.value)}>
                    {o.label}
                </FilterChip>
            ))}
        </div>
    );
}
