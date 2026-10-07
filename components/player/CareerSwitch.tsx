'use client';

import * as React from 'react';
import { Segmented } from '@/components/ui/segmented';

type View = 'regular' | 'playoffs';

/**
 * The career heading with a Regular season / Playoffs switch over two
 * server-rendered views. Switching is local (no navigation); the choice is
 * mirrored into ?career=playoffs so the view can be linked.
 */
export function CareerSwitch({ initial, regular, playoffs }: { initial: View; regular: React.ReactNode; playoffs: React.ReactNode | null }) {
    const [view, setView] = React.useState<View>(playoffs ? initial : 'regular');
    const pick = (v: View) => {
        setView(v);
        const url = new URL(window.location.href);
        if (v === 'playoffs') url.searchParams.set('career', 'playoffs');
        else url.searchParams.delete('career');
        window.history.replaceState(window.history.state, '', url);
    };
    return (
        <>
            <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <h2 id="career-h" className="font-display text-h2 font-bold uppercase leading-none tracking-wide text-fg-1">
                    Career
                </h2>
                {playoffs ? (
                    <Segmented
                        label="Career games"
                        size="sm"
                        value={view}
                        onChange={pick}
                        options={[
                            { value: 'regular', label: 'Regular season' },
                            { value: 'playoffs', label: 'Playoffs' },
                        ]}
                    />
                ) : null}
            </div>
            {/* Both views stay mounted (open panels keep their state); the other one is hidden. */}
            <div className={view === 'regular' ? 'flex flex-col gap-3' : 'hidden'}>
                {regular}
            </div>
            {playoffs ? (
                <div className={view === 'playoffs' ? 'flex flex-col gap-3' : 'hidden'}>
                    {playoffs}
                </div>
            ) : null}
        </>
    );
}
