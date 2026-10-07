'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/utils';
import { ALL_TEAMS, DIVISIONS } from '@/lib/pony/teams';

/**
 * The leaderboard's filter bar. Every filter is a URL parameter (shareable,
 * back-button friendly); a change replaces the URL and the server re-ranks.
 */

const SELECT =
    'h-8 min-w-0 rounded-control border border-line bg-surface-1 px-2 text-caption uppercase tracking-wide text-fg-1 hover:border-line-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand coarse:h-11';

const seasonLabel = (s: string) => `${s.slice(0, 4)}-${s.slice(6)}`;

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
    return (
        <label className={cn('flex min-w-0 flex-col gap-1', className)}>
            <span className="text-micro uppercase tracking-label text-fg-3">{label}</span>
            {children}
        </label>
    );
}

export function PonyFilters({ seasons, dates }: { seasons: string[]; dates: { min: string; max: string } | null }) {
    const router = useRouter();
    const pathname = usePathname();
    const sp = useSearchParams();
    const [pending, start] = React.useTransition();
    const [open, setOpen] = React.useState(false);
    const get = (k: string, d = '') => sp.get(k) ?? d;

    const set = (patch: Record<string, string | null>) => {
        const next = new URLSearchParams(sp.toString());
        for (const [k, v] of Object.entries(patch)) {
            if (v == null || v === '' || v === 'all') next.delete(k);
            else next.set(k, v);
        }
        // A new season's dates don't carry over.
        if ('season' in patch) {
            next.delete('from');
            next.delete('to');
        }
        start(() => router.replace(`${pathname}${next.toString() ? `?${next}` : ''}`, { scroll: false }));
    };
    const active = ['from', 'to', 'last', 'venue', 'rest', 'result', 'vs', 'team', 'gp'].some(k => sp.has(k));
    const pos = get('pos', 'all');

    return (
        <div className={cn('flex flex-col gap-3 transition-opacity', pending && 'opacity-60')} aria-busy={pending}>
            <div className="flex flex-wrap items-center gap-2">
                <Segmented
                    label="Position"
                    size="sm"
                    value={pos}
                    onChange={v => set({ pos: v, sort: v === 'G' && ['off', 'def'].includes(get('sort')) ? null : get('sort') || null })}
                    optionClassName="px-2.5"
                    options={[
                        { value: 'all', label: 'Skaters' },
                        { value: 'F', label: 'Forwards' },
                        { value: 'D', label: 'Defence' },
                        { value: 'G', label: 'Goalies' },
                    ]}
                />
                <Segmented
                    label="Order"
                    size="sm"
                    value={get('dir', 'top')}
                    onChange={v => set({ dir: v === 'top' ? null : v })}
                    optionClassName="px-2.5"
                    options={[
                        { value: 'top', label: 'Top' },
                        { value: 'bottom', label: 'Bottom' },
                    ]}
                />
                <Segmented
                    label="Rank by"
                    size="sm"
                    value={get('sort', 'avg')}
                    onChange={v => set({ sort: v === 'avg' ? null : v })}
                    optionClassName="px-2.5"
                    options={[
                        { value: 'avg', label: 'Per game' },
                        { value: 'total', label: 'Total' },
                        { value: 'per60', label: 'Per 60' },
                        ...(pos === 'G' ? [] : [
                            { value: 'off', label: 'Offence' },
                            { value: 'def', label: 'Defence' },
                        ]),
                    ]}
                />
                {active ? (
                    <button
                        type="button"
                        onClick={() => start(() => router.replace(`${pathname}${get('season') ? `?season=${get('season')}` : ''}`, { scroll: false }))}
                        className="ml-auto h-8 rounded-control px-2.5 text-micro uppercase tracking-label text-fg-3 hover:text-fg-1 coarse:h-11"
                    >
                        Clear filters
                    </button>
                ) : null}
            </div>
            {/* Phones: the selects fold behind one button. */}
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen(o => !o)}
                className="flex h-10 items-center justify-between rounded-control border border-line px-3 text-micro uppercase tracking-label text-fg-2 sm:hidden"
            >
                Filters{active ? ' · on' : ''}
                <svg viewBox="0 0 16 16" className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} aria-hidden="true">
                    <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </button>
            <div className={cn('grid-cols-2 gap-x-3 gap-y-2 sm:grid sm:grid-cols-4 lg:grid-cols-9', open ? 'grid' : 'hidden')}>
                <Field label="Season">
                    <select className={SELECT} value={get('season', seasons[0])} onChange={e => set({ season: e.target.value === seasons[0] ? null : e.target.value })}>
                        {seasons.map(s => (
                            <option key={s} value={s}>
                                {seasonLabel(s)}
                            </option>
                        ))}
                    </select>
                </Field>
                <Field label="Games">
                    <select className={SELECT} value={get('last', 'all')} onChange={e => set({ last: e.target.value })}>
                        <option value="all">All</option>
                        {[5, 10, 20, 40].map(n => (
                            <option key={n} value={n}>
                                Last {n}
                            </option>
                        ))}
                    </select>
                </Field>
                <Field label="Venue">
                    <select className={SELECT} value={get('venue', 'all')} onChange={e => set({ venue: e.target.value })}>
                        <option value="all">All</option>
                        <option value="home">Home</option>
                        <option value="road">Road</option>
                    </select>
                </Field>
                <Field label="Rest">
                    <select className={SELECT} value={get('rest', 'all')} onChange={e => set({ rest: e.target.value })}>
                        <option value="all">All</option>
                        <option value="b2b">Back-to-back</option>
                        <option value="1">1 day</option>
                        <option value="2+">2+ days</option>
                    </select>
                </Field>
                <Field label="Result">
                    <select className={SELECT} value={get('result', 'all')} onChange={e => set({ result: e.target.value })}>
                        <option value="all">All</option>
                        <option value="W">Wins</option>
                        <option value="L">Losses</option>
                    </select>
                </Field>
                <Field label="Versus">
                    <select className={SELECT} value={get('vs', 'all')} onChange={e => set({ vs: e.target.value })}>
                        <option value="all">Anyone</option>
                        <optgroup label="Conference">
                            <option value="conf:East">East</option>
                            <option value="conf:West">West</option>
                        </optgroup>
                        <optgroup label="Division">
                            {Object.keys(DIVISIONS).map(d => (
                                <option key={d} value={`div:${d}`}>
                                    {d}
                                </option>
                            ))}
                        </optgroup>
                        <optgroup label="Team">
                            {ALL_TEAMS.map(t => (
                                <option key={t} value={t}>
                                    {t}
                                </option>
                            ))}
                        </optgroup>
                    </select>
                </Field>
                <Field label="Team">
                    <select className={SELECT} value={get('team', 'all')} onChange={e => set({ team: e.target.value })}>
                        <option value="all">All teams</option>
                        {ALL_TEAMS.map(t => (
                            <option key={t} value={t}>
                                {t}
                            </option>
                        ))}
                    </select>
                </Field>
                <Field label="From">
                    <input
                        type="date"
                        className={cn(SELECT, 'normal-case')}
                        value={get('from')}
                        min={dates?.min}
                        max={dates?.max}
                        onChange={e => set({ from: e.target.value || null })}
                    />
                </Field>
                <Field label="To">
                    <input
                        type="date"
                        className={cn(SELECT, 'normal-case')}
                        value={get('to')}
                        min={dates?.min}
                        max={dates?.max}
                        onChange={e => set({ to: e.target.value || null })}
                    />
                </Field>
            </div>
            <div className={cn('flex-wrap items-center gap-2 text-micro uppercase tracking-label text-fg-3 sm:flex', open ? 'flex' : 'hidden')}>
                <span>Min games</span>
                {[0, 3, 5, 10, 20, 40].map(n => (
                    <button
                        key={n}
                        type="button"
                        onClick={() => set({ gp: n ? String(n) : null })}
                        aria-pressed={Number(get('gp', '0')) === n}
                        className={cn(
                            'h-7 rounded-full border px-2.5 tabular-nums coarse:h-10',
                            Number(get('gp', '0')) === n ? 'border-brand/60 text-brand' : 'border-line text-fg-3 hover:border-line-strong hover:text-fg-1',
                        )}
                    >
                        {n || 'Any'}
                    </button>
                ))}
            </div>
        </div>
    );
}
