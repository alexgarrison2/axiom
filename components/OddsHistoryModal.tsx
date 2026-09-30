'use client';

import { Dialog } from '@/components/ui/dialog';
import type { OddsEntry } from '@/app/api/odds-history/route';
import type { TeamRef } from '@/types/prediction';
import { fmtClock, fmtOdds } from '@/lib/matchup/format';
import { cn } from '@/lib/utils';

/** Snapshot time: ISO UTC → viewer's clock; legacy "HH:MM" (US Central) → "6:22 PM CT". */
function when(ts: string): string {
    if (/^\d{4}-\d{2}-\d{2}T/.test(ts)) return fmtClock(ts);
    const m = ts.match(/^(\d{1,2}):(\d{2})/);
    if (!m) return ts;
    const h = Number(m[1]);
    return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'} CT`;
}

function Arrow({ dir }: { dir: 'up' | 'down' | null }) {
    if (!dir) return null;
    return (
        <span aria-label={dir === 'up' ? 'longer odds' : 'shorter odds'} className={cn('text-micro', dir === 'up' ? 'text-pos' : 'text-neg')}>
            {dir === 'up' ? '▲' : '▼'}
        </span>
    );
}

/**
 * "Line move": how the moneyline moved from the opening snapshot to the
 * latest, in an accessible dialog. Shown only when there are 2+ points.
 */
export default function OddsHistoryModal({ entries, away, home }: { entries: OddsEntry[]; away: TeamRef; home: TeamRef }) {
    const first = entries[0];
    const last = entries[entries.length - 1];
    return (
        <Dialog
            title="Line move"
            description={`${away.commonName} @ ${home.commonName} · moneyline from open to latest`}
            size="md"
            trigger={
                <button
                    type="button"
                    className="inline-flex min-h-9 items-center gap-2 self-start rounded-control border border-line bg-surface-2 px-3 text-caption font-semibold text-fg-1 transition-colors hover:border-line-strong coarse:min-h-11"
                >
                    <svg aria-hidden="true" width="14" height="10" viewBox="0 0 14 10" fill="none">
                        <polyline points="0,8 3,4 6,6 9,2 13,1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Line move
                    <span className="font-normal text-fg-2 tabular-nums">
                        {away.triCode} {fmtOdds(first.awayOdds)} → {fmtOdds(last.awayOdds)}
                    </span>
                </button>
            }
        >
            <table className="w-full text-body-sm">
                <thead>
                    <tr className="text-micro uppercase tracking-wider text-fg-3">
                        <th scope="col" className="pb-2 text-left font-semibold">
                            Time
                        </th>
                        <th scope="col" className="pb-2 text-right font-semibold">
                            {away.triCode}
                        </th>
                        <th scope="col" className="pb-2 text-right font-semibold">
                            {home.triCode}
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {entries.map((e, i) => (
                        <tr key={i} className={cn('border-t border-line', (e.isOpen || e.isLatest) && 'bg-surface-2/60')}>
                            <th scope="row" className="py-1.5 pl-1 text-left text-caption font-normal text-fg-2">
                                {e.isOpen ? <span className="mr-1.5 rounded-chip bg-fg-3/15 px-1 text-micro font-bold uppercase text-fg-1">Open</span> : null}
                                {e.isLatest ? <span className="mr-1.5 rounded-chip bg-brand/15 px-1 text-micro font-bold uppercase text-brand">Latest</span> : null}
                                {when(e.timestamp)}
                            </th>
                            <td className="py-1.5 text-right tabular-nums text-fg-1">
                                <Arrow dir={e.awayDir} /> {fmtOdds(e.awayOdds) ?? e.awayOdds}
                            </td>
                            <td className="py-1.5 pr-1 text-right tabular-nums text-fg-1">
                                <Arrow dir={e.homeDir} /> {fmtOdds(e.homeOdds) ?? e.homeOdds}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <p className="mt-3 text-caption text-fg-3">From our pregame snapshots. The opening line and the last six changes are shown.</p>
        </Dialog>
    );
}
