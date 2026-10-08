'use client';

import * as React from 'react';
import { Rink3D } from '@/components/rink/Rink3D';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/utils';
import { S, fetchShots, skaterShotsUrl, type ShotFile } from '@/lib/shots';

/**
 * A skater's unblocked shots for the season on the tilted rink: goals rise as
 * green posts (taller = higher xG), saved shots lie as discs, misses as rings.
 * ZONES shows where he scores above or below his expected goals. Empty-net
 * shots are left off (they say nothing about finishing).
 */
export function ShotMap({ season, id }: { season: string; id: number }) {
    const [file, setFile] = React.useState<ShotFile | null | undefined>(undefined);
    const [mode, setMode] = React.useState<'shots' | 'zones'>('shots');
    const [sit, setSit] = React.useState<'all' | '0' | '1'>('all');
    React.useEffect(() => {
        let live = true;
        setFile(undefined);
        fetchShots<ShotFile>(skaterShotsUrl(season, id)).then(f => live && setFile(f));
        return () => {
            live = false;
        };
    }, [season, id]);

    const set = React.useMemo(
        () => (file?.shots ?? []).filter(s => s[S.strength] !== 3 && s[S.x] >= 25 && (sit === 'all' || String(s[S.strength]) === sit)),
        [file, sit],
    );
    if (file === null || (file && !file.shots.length)) return <p className="panel p-card text-caption text-fg-3">No shots this season yet.</p>;
    const goals = set.filter(s => s[S.goal]).length;
    const saved = set.filter(s => s[S.onGoal] && !s[S.goal]).length;
    const missed = set.filter(s => !s[S.onGoal]).length;
    const xg = set.reduce((a, s) => a + s[S.xg], 0);
    const diff = goals - xg;
    return (
        <section className="panel flex min-w-0 flex-col gap-3 p-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-caption text-fg-2">
                    <b className="text-fg-1">{goals}</b> goals on <span className="text-model">{xg.toFixed(1)} xG</span> ·{' '}
                    <b className={cn(diff >= 0 ? 'text-pos' : 'text-neg')}>
                        {diff >= 0 ? '+' : '−'}
                        {Math.abs(diff).toFixed(1)}
                    </b>{' '}
                    finishing · {set.length} attempts
                </p>
                <div className="flex flex-wrap gap-2">
                    <Segmented label="Map" size="sm" value={mode} onChange={setMode} options={[{ value: 'shots', label: 'Shots' }, { value: 'zones', label: 'Zones' }]} />
                    <Segmented label="Situation" size="sm" value={sit} onChange={setSit} options={[{ value: 'all', label: 'All' }, { value: '0', label: 'Even' }, { value: '1', label: 'PP' }]} />
                </div>
            </div>
            {file ? <Rink3D shots={set} mode={mode} tone="pos" label={`Shots: ${goals} goals, ${saved} saved, ${missed} missed`} /> : <div className="aspect-[16/9] w-full" />}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-micro text-fg-3">
                {mode === 'shots' ? (
                    <>
                        <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-3 w-0.5 rounded-full bg-pos" />goal ({goals}), taller = higher xG</span>
                        <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2 w-3 rounded-full border border-fg-2/40 bg-fg-2/15" />saved ({saved})</span>
                        <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2 w-3 rounded-full border border-fg-2/40" />missed ({missed})</span>
                    </>
                ) : (
                    <>
                        <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2.5 w-2.5 bg-pos/60" />scored more than expected</span>
                        <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2.5 w-2.5 bg-neg/60" />fewer</span>
                        <span>areas with 6+ shots</span>
                    </>
                )}
            </div>
        </section>
    );
}
