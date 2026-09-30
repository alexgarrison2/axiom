'use client';

import { Dialog } from '@/components/ui/dialog';
import type { OddsEntry } from '@/app/api/odds-history/route';
import type { TeamRef } from '@/types/prediction';
import { fmtOdds } from '@/lib/matchup/format';
import { cn } from '@/lib/utils';

/** Snapshot time: ISO UTC → viewer's clock; legacy "HH:MM" (US Central) → "6:22 PM CT". */
function when(ts: string): string {
    if (/^\d{4}-\d{2}-\d{2}T/.test(ts)) {
        const d = new Date(ts);
        if (Number.isNaN(d.getTime())) return ts;
        const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
        const sameDay = d.toDateString() === new Date().toDateString();
        return sameDay ? time : `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`;
    }
    const m = ts.match(/^(\d{1,2}):(\d{2})/);
    if (!m) return ts;
    const h = Number(m[1]);
    return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'} CT`;
}

/** 'up' = longer odds (the team drifted), 'down' = shorter odds (the team shortened). */
function Move({ dir }: { dir: 'up' | 'down' | null }) {
    if (!dir) return null;
    return <span className={cn('mr-1 text-micro font-semibold', dir === 'up' ? 'text-fg-2' : 'text-warn')}>{dir === 'up' ? 'drifted' : 'shortened'}</span>;
}

const toNum = (o: string) => {
    const n = Number(String(o).replace('−', '-'));
    return Number.isFinite(n) ? n : null;
};

/** Implied chance (with vig) from an American line, for comparing two prices. */
const implied = (n: number) => (n < 0 ? -n / (-n + 100) : 100 / (n + 100));

/** "COL shortened from −215 to −205" or "No move". */
function moveSentence(tri: string, from: string, to: string): string {
    const a = toNum(from);
    const b = toNum(to);
    if (a == null || b == null || a === b) return `${tri} unchanged at ${fmtOdds(to) ?? to}`;
    const verb = implied(b) > implied(a) ? 'shortened' : 'drifted';
    return `${tri} ${verb} from ${fmtOdds(from) ?? from} to ${fmtOdds(to) ?? to}`;
}

/**
 * "Line move": how the moneyline moved from the opening snapshot to the
 * latest, in an accessible dialog. Shown only when there are 2+ points.
 */
export default function OddsHistoryModal({ entries, away, home, started = false }: { entries: OddsEntry[]; away: TeamRef; home: TeamRef; started?: boolean }) {
    const first = entries[0];
    const last = entries[entries.length - 1];
    return (
        <Dialog
            title="Line move"
            description={`${away.commonName} at ${home.commonName} · moneyline from our first snapshot to the ${started ? 'close' : 'latest'}`}
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
            <p className="mb-3 text-body-sm text-fg-1">
                {moveSentence(away.triCode, first.awayOdds, last.awayOdds)} · {moveSentence(home.triCode, first.homeOdds, last.homeOdds)}.
                <span className="block text-caption text-fg-3">Shortened means the market now rates the team more likely to win; drifted means less likely.</span>
            </p>
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
                                {e.isOpen ? <span className="mr-1.5 rounded-chip bg-fg-3/15 px-1 text-micro font-bold uppercase text-fg-1">First seen</span> : null}
                                {e.isLatest ? <span className="mr-1.5 rounded-chip bg-brand/15 px-1 text-micro font-bold uppercase text-brand">{started ? 'Close' : 'Latest'}</span> : null}
                                {when(e.timestamp)}
                            </th>
                            <td className="py-1.5 text-right tabular-nums text-fg-1">
                                <Move dir={e.awayDir} /> {fmtOdds(e.awayOdds) ?? e.awayOdds}
                            </td>
                            <td className="py-1.5 pr-1 text-right tabular-nums text-fg-1">
                                <Move dir={e.homeDir} /> {fmtOdds(e.homeOdds) ?? e.homeOdds}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <p className="mt-3 text-caption text-fg-3">From our pregame snapshots. “First seen” is our first capture, not necessarily the book’s opening line; the last six changes are shown.</p>
        </Dialog>
    );
}
