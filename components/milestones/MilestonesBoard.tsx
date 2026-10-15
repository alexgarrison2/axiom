'use client';

import * as React from 'react';
import { FilterChip } from '@/components/ui/filter-chip';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { fmtInt } from '@/components/views/format';
import { filterMilestones, KINDS, parseMilestones, sortMilestones, type Kind, type MilestonesDoc, type Sort } from '@/lib/milestones';
import { MilestoneRow } from './MilestoneRow';
import { DayLabel } from './parts';

const PAGE = 60;

type Slim = Pick<MilestonesDoc, 'players' | 'next' | 'items'>;

/**
 * Everything within reach this season: kind chips, Soonest (grouped by the
 * projected night) or Rarest, a one-game filter and a name / team search. The
 * first screen comes from the server; the full file loads right after.
 */
export function MilestonesBoard({ preview, counts, src, sinceTag }: {
    preview: Slim;
    counts: Record<Kind | 'all', number>;
    src: string;
    sinceTag: string | null;
}) {
    const [doc, setDoc] = React.useState<Slim>(preview);
    const [full, setFull] = React.useState(false);
    const [kind, setKind] = React.useState<Kind | 'all'>('all');
    const [sort, setSort] = React.useState<Sort>('soon');
    const [one, setOne] = React.useState(false);
    const [query, setQuery] = React.useState('');
    const [n, setN] = React.useState(PAGE);

    React.useEffect(() => {
        let live = true;
        fetch(src)
            .then(r => (r.ok ? r.json() : null))
            .then(raw => {
                const d = parseMilestones(raw);
                if (live && d) {
                    setDoc(d);
                    setFull(true);
                }
            })
            .catch(() => {});
        return () => {
            live = false;
        };
    }, [src]);

    const filtered = React.useMemo(() => {
        const rows = filterMilestones(doc, doc.items, kind, query).filter(m => !one || m.one);
        return sortMilestones(rows, sort);
    }, [doc, kind, query, one, sort]);
    const shown = filtered.slice(0, n);
    const reset = <T,>(set: (v: T) => void) => (v: T) => {
        set(v);
        setN(PAGE);
    };

    // Soonest groups the rows by the projected night.
    const groups: { date: string | null; rows: typeof shown }[] = [];
    for (const m of shown) {
        const date = sort === 'soon' ? m.eta[1] : null;
        if (!groups.length || groups[groups.length - 1].date !== date) groups.push({ date, rows: [] });
        groups[groups.length - 1].rows.push(m);
    }

    return (
        <section aria-labelledby="ms-board" className="flex flex-col gap-3">
            <h2 id="ms-board" className="sr-only">
                All milestones this season
            </h2>
            <div className="sticky top-[calc(var(--appbar-h)+var(--vv-top,0px))] z-20 -mx-4 flex flex-col gap-2 border-b border-line bg-bg/95 px-4 py-2 backdrop-blur md:-mx-6 md:px-6 lg:flex-row lg:items-center">
                <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 scrollbar-hide md:mx-0 md:flex-wrap md:px-0" role="group" aria-label="Milestone kind">
                    {KINDS.map(k => (
                        <FilterChip key={k.key} selected={kind === k.key} onSelectedChange={() => reset(setKind)(k.key)} count={counts[k.key]}>
                            {k.label}
                        </FilterChip>
                    ))}
                </div>
                <div className="flex flex-wrap items-center gap-2 lg:ml-auto lg:flex-nowrap">
                    <Segmented
                        label="Order"
                        size="sm"
                        options={[{ value: 'soon', label: 'Soonest' }, { value: 'rare', label: 'Rarest' }]}
                        value={sort}
                        onChange={reset(setSort)}
                    />
                    <FilterChip selected={one} onSelectedChange={reset(setOne)}>
                        One game
                    </FilterChip>
                    <Input
                        type="search"
                        value={query}
                        onChange={e => reset(setQuery)(e.target.value)}
                        placeholder="Player or team"
                        aria-label="Search players or teams"
                        className="min-w-0 flex-1 max-sm:basis-full lg:w-48 lg:flex-none"
                    />
                </div>
            </div>
            <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-micro uppercase tracking-label text-fg-3">
                <span className="text-fg-2">{fmtInt(full ? filtered.length : counts.all)} milestones</span>
                <span>
                    <span className="font-bold text-model">G#</span> projected
                </span>
                <a href="/methodology#milestones" className="ml-auto underline-offset-4 hover:text-fg-1 hover:underline coarse:py-3">
                    Method
                </a>
            </p>
            {groups.length ? (
                <div className="panel overflow-hidden max-lg:bg-none max-lg:bg-surface-1">
                    {groups.map((g, gi) => (
                        <div key={`${g.date}-${gi}`}>
                            {g.date ? (
                                <h3 className="flex items-baseline gap-3 border-b border-line bg-bg/60 px-card py-2">
                                    <DayLabel date={g.date} className="heading-sub" />
                                    <span className="text-micro text-fg-3">{g.rows.length}{gi === groups.length - 1 && n < filtered.length ? '+' : ''}</span>
                                </h3>
                            ) : null}
                            <ul>
                                {g.rows.map(m => (
                                    <MilestoneRow key={`${m.p}-${m.kind}-${m.stat}-${m.target}`} m={m} doc={doc} sinceTag={sinceTag} />
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            ) : (
                <p className="panel p-card py-10 text-center text-caption text-fg-3">{full ? 'No milestone matches.' : 'Loading…'}</p>
            )}
            {n < filtered.length ? (
                <button
                    type="button"
                    onClick={() => setN(n + PAGE)}
                    className="self-center rounded-full border border-line px-4 py-2 text-micro uppercase tracking-label text-fg-2 hover:border-line-strong hover:text-fg-1 coarse:py-[15px]"
                >
                    Show {Math.min(PAGE, filtered.length - n)} more
                </button>
            ) : null}
        </section>
    );
}
