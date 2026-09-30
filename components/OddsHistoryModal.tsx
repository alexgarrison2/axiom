'use client';

import { Dialog } from '@/components/ui/dialog';
import type { OddsEntry, OddsTotal } from '@/app/api/odds-history/route';
import type { TeamRef } from '@/types/prediction';
import { fmtOdds, sourceLabel, sourceTag } from '@/lib/matchup/format';
import { bookSwitches } from '@/lib/matchup/line-move';
import { cn } from '@/lib/utils';

/** Snapshot time: ISO UTC → viewer's clock, plus the day when it is not today; legacy "HH:MM" (US Central) → "6:22 PM CT". */
function when(ts: string): { day: string | null; time: string } {
    if (/^\d{4}-\d{2}-\d{2}T/.test(ts)) {
        const d = new Date(ts);
        if (Number.isNaN(d.getTime())) return { day: null, time: ts };
        const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
        const sameDay = d.toDateString() === new Date().toDateString();
        return { day: sameDay ? null : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), time };
    }
    const m = ts.match(/^(\d{1,2}):(\d{2})/);
    if (!m) return { day: null, time: ts };
    const h = Number(m[1]);
    return { day: null, time: `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'} CT` };
}

function When({ ts }: { ts: string }) {
    const t = when(ts);
    return (
        <>
            {t.day ? <span>{t.day},</span> : null}
            <span>{t.time}</span>
        </>
    );
}

const toNum = (o: string) => {
    const n = Number(String(o).replace('−', '-'));
    return Number.isFinite(n) ? n : null;
};

/** Implied chance (with vig) from an American line, for comparing two prices. */
const implied = (n: number) => (n < 0 ? -n / (-n + 100) : 100 / (n + 100));

/** Direction of a price move from the team's point of view: shortened (more likely) / drifted (less likely). */
function moveOf(from: string, to: string): 'short' | 'drift' | null {
    const a = toNum(from);
    const b = toNum(to);
    if (a == null || b == null || a === b) return null;
    return implied(b) > implied(a) ? 'short' : 'drift';
}

/** ▲ shortened (market rates the team more likely) / ▼ drifted. */
function Arrow({ dir, className }: { dir: 'short' | 'drift' | 'up' | 'down' | null | undefined; className?: string }) {
    if (!dir) return null;
    const up = dir === 'short' || dir === 'down';
    return (
        <span className={cn('text-micro', up ? 'text-pos' : 'text-neg', className)}>
            <span aria-hidden="true">{up ? '▲' : '▼'}</span>
            <span className="sr-only">{up ? ' shortened' : ' drifted'}</span>
        </span>
    );
}

/** "Total 6 → 5.5" / "Total 6.5". */
export function totalSummary(from: OddsTotal | null | undefined, to: OddsTotal | null | undefined): string | null {
    if (!to) return null;
    if (!from || Number(from.line) === Number(to.line)) return `${to.line}`;
    return `${from.line} → ${to.line}`;
}

function TotalCell({ t, dir }: { t: OddsTotal | null | undefined; dir: 'up' | 'down' | null | undefined }) {
    if (!t) return <span className="text-fg-3">—</span>;
    return (
        <span className="inline-flex flex-col items-end leading-tight">
            <span className="font-bold text-fg-1">
                {dir ? (
                    <span className={cn('mr-1 text-micro', dir === 'up' ? 'text-warn' : 'text-fg-2')}>
                        <span aria-hidden="true">{dir === 'up' ? '▲' : '▼'}</span>
                        <span className="sr-only">{dir === 'up' ? 'up' : 'down'} </span>
                    </span>
                ) : null}
                {t.line}
            </span>
            <span className="flex flex-col items-end text-micro text-fg-3 sm:flex-row sm:flex-wrap sm:justify-end sm:gap-x-2">
                <span className="whitespace-nowrap">
                    <abbr title="Over" className="no-underline">
                        O
                    </abbr>{' '}
                    {fmtOdds(t.over) ?? t.over}
                </span>
                <span className="whitespace-nowrap">
                    <abbr title="Under" className="no-underline">
                        U
                    </abbr>{' '}
                    {fmtOdds(t.under) ?? t.under}
                </span>
            </span>
        </span>
    );
}

/** One team's open → latest summary tile. */
function MoveTile({ label, from, to, dir }: { label: string; from: string; to: string; dir: ReturnType<typeof moveOf> }) {
    return (
        <div className="tile flex min-w-0 flex-col gap-0.5 px-3 py-2">
            <span className="label">{label}</span>
            <span className="flex items-baseline gap-1.5 font-display text-title font-bold tabular-nums text-fg-1">
                <span className="text-fg-3">{fmtOdds(from) ?? from}</span>
                <span aria-hidden="true" className="text-micro text-fg-3">
                    →
                </span>
                <span className="sr-only"> to </span>
                {fmtOdds(to) ?? to}
                <Arrow dir={dir} />
            </span>
        </div>
    );
}

/** One snapshot: time, book tag, prices. A row whose book differs from the row above shows ⇄ and no ▲/▼. */
function SnapshotRow({ e, switched, started, hasTotals }: { e: OddsEntry; switched: boolean; started: boolean; hasTotals: boolean }) {
    const tag = sourceTag(e.source);
    return (
        <tr data-book={tag ?? undefined} data-book-change={switched || undefined}>
            <th scope="row" className="text-left font-normal text-fg-2">
                {/* Chip, day and clock wrap as whole pieces, so a dated row never pushes the Total column off a phone. */}
                <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 py-1">
                    {e.isOpen ? (
                        <span title="First line we captured" className="rounded-chip border border-line px-1 text-micro font-bold uppercase tracking-wide text-fg-1">
                            First
                        </span>
                    ) : null}
                    {e.isLatest ? <span className="rounded-chip border border-brand/50 px-1 text-micro font-bold uppercase tracking-wide text-brand">{started ? 'Close' : 'Latest'}</span> : null}
                    <When ts={e.timestamp} />
                    {switched ? (
                        <span title="Book changed" className="text-micro font-bold text-warn">
                            <span aria-hidden="true">⇄</span>
                            <span className="sr-only">book changed to</span>
                        </span>
                    ) : null}
                    {tag ? (
                        <abbr title={sourceLabel(e.source) ?? undefined} className="rounded-chip border border-line px-1 text-micro text-fg-2 no-underline">
                            {tag}
                        </abbr>
                    ) : null}
                </span>
            </th>
            <td className="text-right text-fg-1">
                {switched ? null : <Arrow dir={e.awayDir === 'down' ? 'down' : e.awayDir === 'up' ? 'up' : null} className="mr-1" />}
                {fmtOdds(e.awayOdds) ?? e.awayOdds}
            </td>
            <td className="text-right text-fg-1">
                {switched ? null : <Arrow dir={e.homeDir === 'down' ? 'down' : e.homeDir === 'up' ? 'up' : null} className="mr-1" />}
                {fmtOdds(e.homeOdds) ?? e.homeOdds}
            </td>
            {hasTotals ? (
                <td className="py-1 text-right">
                    <TotalCell t={e.total} dir={switched ? null : e.totalDir} />
                </td>
            ) : null}
        </tr>
    );
}

/**
 * Line move: the moneyline (and the game total, when snapshotted) from our
 * first snapshot to the latest, in an accessible dialog. Shown only with 2+ points.
 */
export default function OddsHistoryModal({ entries, away, home, started = false }: { entries: OddsEntry[]; away: TeamRef; home: TeamRef; started?: boolean }) {
    const first = entries[0];
    const last = entries[entries.length - 1];
    const hasTotals = entries.some(e => e.total);
    const firstTotal = entries.find(e => e.total)?.total;
    const total = totalSummary(firstTotal, last.total);
    // Across a book switch the open → latest difference is not a market move.
    const switches = bookSwitches(entries);
    const crossBook = switches.some(Boolean);
    return (
        <Dialog
            title="Line move"
            description={`${away.triCode} at ${home.triCode}: ${hasTotals ? 'moneyline and total' : 'moneyline'}, first snapshot to ${started ? 'close' : 'latest'}`}
            size="md"
            trigger={
                <button
                    type="button"
                    className="inline-flex min-h-8 items-center gap-2 rounded-control border border-line px-3 text-micro font-medium uppercase tracking-chip text-fg-2 transition-colors hover:border-line-strong hover:text-fg-1 coarse:min-h-11"
                >
                    <svg aria-hidden="true" width="14" height="10" viewBox="0 0 14 10" fill="none">
                        <polyline points="0,8 3,4 6,6 9,2 13,1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Line move
                    <span className="normal-case tracking-normal text-fg-1 tabular-nums">
                        {away.triCode} {fmtOdds(first.awayOdds)} → {fmtOdds(last.awayOdds)}
                    </span>
                </button>
            }
        >
            <div className={cn('mb-3 grid grid-cols-2 gap-2', total && 'sm:grid-cols-3')}>
                <MoveTile label={away.triCode} from={first.awayOdds} to={last.awayOdds} dir={crossBook ? null : moveOf(first.awayOdds, last.awayOdds)} />
                <MoveTile label={home.triCode} from={first.homeOdds} to={last.homeOdds} dir={crossBook ? null : moveOf(first.homeOdds, last.homeOdds)} />
                {total ? (
                    <div className="tile col-span-2 flex min-w-0 items-baseline justify-between gap-0.5 px-3 py-2 sm:col-span-1 sm:flex-col sm:items-start sm:justify-start">
                        <span className="label">Total</span>
                        <span className="font-display text-title font-bold tabular-nums text-fg-1">{total}</span>
                    </div>
                ) : null}
            </div>
            <table className="table-dense">
                <thead>
                    <tr>
                        <th scope="col" className="text-left">
                            Time
                        </th>
                        <th scope="col" className="text-right">
                            {away.triCode}
                        </th>
                        <th scope="col" className="text-right">
                            {home.triCode}
                        </th>
                        {hasTotals ? (
                            <th scope="col" className="text-right">
                                Total
                            </th>
                        ) : null}
                    </tr>
                </thead>
                <tbody>
                    {entries.map((e, i) => (
                        <SnapshotRow key={i} e={e} switched={switches[i]} started={started} hasTotals={hasTotals} />
                    ))}
                </tbody>
            </table>
        </Dialog>
    );
}
