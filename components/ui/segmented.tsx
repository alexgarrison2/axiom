'use client';

import * as React from 'react';
import { cn } from '../../lib/utils';

export interface SegmentedOption<T extends string> {
    value: T;
    label: React.ReactNode;
    /** Accessible label when `label` is an icon. */
    ariaLabel?: string;
    disabled?: boolean;
}

export interface SegmentedProps<T extends string> {
    options: SegmentedOption<T>[];
    value: T;
    onChange: (value: T) => void;
    /** Accessible name for the group. */
    label: string;
    size?: 'sm' | 'md';
    /** Stretch segments to fill the row. */
    block?: boolean;
    className?: string;
}

/**
 * One segmented control for the whole site (views, seasons, splits).
 * A radiogroup: Tab enters the group, arrow keys move and select.
 * Selected = surface-2 fill + 1px brand inner ring + text-1.
 */
export function Segmented<T extends string>({ options, value, onChange, label, size = 'md', block = false, className }: SegmentedProps<T>) {
    const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
    const enabled = options.filter(o => !o.disabled);
    // Roving tab stop: the selected option, or the first enabled one if nothing matches `value`.
    const tabStop = options.some(o => o.value === value && !o.disabled) ? value : enabled[0]?.value;

    const move = (from: number, dir: 1 | -1) => {
        const idx = enabled.findIndex(o => o.value === options[from].value);
        if (!enabled.length) return;
        const next = enabled[(idx + dir + enabled.length) % enabled.length];
        const nextIndex = options.findIndex(o => o.value === next.value);
        onChange(next.value);
        refs.current[nextIndex]?.focus();
    };

    return (
        <div
            role="radiogroup"
            aria-label={label}
            className={cn(
                'inline-flex max-w-full items-center gap-0.5 rounded-control border border-line bg-surface-1 p-0.5',
                block && 'flex w-full',
                className,
            )}
        >
            {options.map((o, i) => {
                const selected = o.value === value;
                return (
                    <button
                        key={o.value}
                        ref={el => {
                            refs.current[i] = el;
                        }}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        aria-label={o.ariaLabel}
                        disabled={o.disabled}
                        tabIndex={o.value === tabStop ? 0 : -1}
                        onClick={() => onChange(o.value)}
                        onKeyDown={e => {
                            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                                e.preventDefault();
                                move(i, 1);
                            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                                e.preventDefault();
                                move(i, -1);
                            }
                        }}
                        className={cn(
                            'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] px-3 font-semibold transition-colors',
                            size === 'sm' ? 'min-h-8 text-caption' : 'min-h-9 text-body-sm',
                            'coarse:min-h-11',
                            block && 'flex-1',
                            selected
                                ? 'bg-surface-3 text-fg-1 shadow-[inset_0_0_0_1px_rgb(var(--brand-rgb))]'
                                : 'text-fg-2 hover:bg-surface-2 hover:text-fg-1',
                            'disabled:cursor-not-allowed disabled:text-fg-disabled',
                        )}
                    >
                        {o.label}
                    </button>
                );
            })}
        </div>
    );
}

export default Segmented;
