'use client';

import * as React from 'react';
import Link from 'next/link';
import { Switcher } from '@/components/Switcher';
import { Crest } from '@/components/ui/crest';
import { cn } from '@/lib/utils';
import { ALL_TEAMS, DIVISIONS, DIVISION_LABEL } from '@/utils/team-stats/teams';

interface TeamSelectorProps {
    /** Tricode of the team being viewed. */
    current: string;
    className?: string;
}

/** Team switcher: every team by division, filtered by the search box (panel and behaviour in Switcher). */
export default function TeamSelector({ current, className }: TeamSelectorProps) {
    const [open, setOpen] = React.useState(false);
    const [q, setQ] = React.useState('');
    const [suffix, setSuffix] = React.useState('');
    const cur = ALL_TEAMS.find(t => t.tri === current);

    const onOpenChange = (o: boolean) => {
        setOpen(o);
        if (o) {
            setQ('');
            try {
                const tab = new URLSearchParams(window.location.search).get('tab');
                setSuffix(tab ? `?tab=${encodeURIComponent(tab)}` : '');
            } catch {
                setSuffix('');
            }
        }
    };

    const query = q.trim().toLowerCase();
    const matches = (t: (typeof ALL_TEAMS)[number]) =>
        !query || t.name.toLowerCase().includes(query) || t.common.toLowerCase().includes(query) || t.tri.toLowerCase().includes(query);

    return (
        <Switcher
            open={open}
            onOpenChange={onOpenChange}
            triggerLabel={`Switch team (current: ${cur?.name ?? current})`}
            className={className}
            panelLabel="Choose a team"
            panelClassName="md:w-[720px] md:max-h-[min(80vh,640px,var(--radix-popover-content-available-height))]"
            query={q}
            onQuery={setQ}
            searchLabel="Search teams"
        >
            <div className="grid grid-cols-2 gap-x-3 gap-y-3 md:grid-cols-4">
                {DIVISIONS.map(div => {
                    const teams = ALL_TEAMS.filter(t => t.division === div && matches(t)).sort((a, b) => a.tri.localeCompare(b.tri));
                    if (!teams.length) return null;
                    return (
                        <div key={div}>
                            <p className="label mb-1 px-2">{DIVISION_LABEL[div]}</p>
                            <ul>
                                {teams.map(t => (
                                    <li key={t.tri}>
                                        <Link
                                            href={`/teams/${t.tri}${suffix}`}
                                            onClick={() => setOpen(false)}
                                            aria-current={t.tri === current ? 'page' : undefined}
                                            className={cn(
                                                'flex min-h-8 items-center gap-2 rounded-control px-2 text-caption transition-colors hover:bg-surface-2 coarse:min-h-11',
                                                t.tri === current ? 'bg-surface-3 text-brand' : 'text-fg-2 hover:text-fg-1',
                                            )}
                                        >
                                            <Crest tri={t.tri} size={26} className="drop-shadow-none" />
                                            <span className="font-bold text-fg-1">{t.tri}</span>
                                            <span className="truncate text-fg-3">{t.common}</span>
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    );
                })}
            </div>
            {ALL_TEAMS.every(t => !matches(t)) ? <p className="label px-2 py-6 text-center">No match</p> : null}
        </Switcher>
    );
}
