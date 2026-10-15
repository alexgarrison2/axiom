'use client';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { Crest } from '@/components/ui/crest';
import { LocalTime } from '@/components/ui/local-time';
import { dayLabel, meter, STAT_ABBR, type Milestone, type NextGame } from '@/lib/milestones';
import { cn } from '@/lib/utils';
import { fmtInt } from '@/components/views/format';

const noop = () => () => {};
const todayET = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

/** Today's slate date (Eastern) once hydrated; null on the server and first paint. */
export function useToday(): string | null {
    return useSyncExternalStore(noop, todayET, () => null);
}

/** "Tonight" on the slate day itself, else "Fri, Oct 16". */
export function DayLabel({ date, className }: { date: string; className?: string }) {
    const today = useToday();
    return <span className={className}>{today === date ? 'Tonight' : dayLabel(date)}</span>;
}

/**
 * The countdown meter. Up to 10 to go: one pip per unit, the hollow ones still
 * to come (a streak shows every game of it). Otherwise a thin bar of how much
 * of the target he already has.
 */
export function Meter({ m, className }: { m: Milestone; className?: string }) {
    const k = meter(m);
    if ('bar' in k) {
        return (
            <span className={cn('block h-1 w-full overflow-hidden rounded-full bg-track', className)} aria-hidden="true">
                <span className="block h-full rounded-full bg-fg-1/80" style={{ width: `${k.bar * 100}%` }} />
            </span>
        );
    }
    return (
        <span className={cn('flex gap-[3px]', className)} aria-hidden="true">
            {Array.from({ length: k.pips }, (_, i) => (
                <span
                    key={i}
                    className={cn(
                        'h-2 min-w-0 flex-1 rounded-[2px] md:h-2.5',
                        i < k.pips - k.hollow ? 'ms-pip-on' : 'border border-line-strong',
                    )}
                />
            ))}
        </span>
    );
}

/** The team's next game as a link to its matchup page: "vs BUF · Tonight 7:00 PM". */
export function GameChip({ game, className }: { game: NextGame | undefined; className?: string }) {
    if (!game) return <span className={cn('text-fg-3', className)}>No game</span>;
    const [id, date, start, opp, home] = game;
    return (
        <Link
            href={`/games/${id}`}
            className={cn(
                'group inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap rounded-[2px] text-fg-2 underline-offset-4 hover:text-brand coarse:min-h-11',
                className,
            )}
        >
            <span className="text-fg-3">{home ? 'vs' : '@'}</span>
            <Crest tri={opp} size={20} className="drop-shadow-none" />
            <span className="font-bold text-fg-1 group-hover:text-brand">{opp}</span>
            <span className="text-fg-3">·</span>
            <DayLabel date={date} className="group-hover:underline" />
            {start ? <LocalTime iso={start} className="text-fg-3" /> : null}
        </Link>
    );
}

/** Hall of Fame tag beside a passed name. */
export function HofTag() {
    return (
        <abbr title="Hockey Hall of Fame" className="ml-1.5 inline-flex h-[18px] items-center rounded-chip border border-line-strong px-1 align-[1px] text-micro font-bold not-italic leading-none tracking-[0.08em] text-fg-1 no-underline">
            HOF
        </abbr>
    );
}

/** Injury tag (amber: situational, it changes when he gets there). */
export function OutTag({ tag }: { tag: string | null | undefined }) {
    if (!tag) return null;
    return <span className="rounded-chip border border-warn/50 px-1 text-micro font-bold uppercase leading-[16px] tracking-[0.08em] text-warn">{tag}</span>;
}

/** Thin-sample tag on a pace (fewer than 10 games behind it). */
export function ThinTag({ n }: { n: number | undefined }) {
    if (n == null) return null;
    return <span className="rounded-chip border border-dashed border-warn/60 px-1 text-micro leading-[16px] text-warn">n={n}</span>;
}

/**
 * The list around a pass as a micro table: up to two places above the name he
 * passes, that name, then him (raised fill, ink). Ranks and totals are the
 * list as it stands today; games played ride along unless the list is games.
 */
export function Ladder({ m, name, className }: { m: Milestone; name: string; className?: string }) {
    if (!m.ladder?.length) return null;
    const rows = m.ladder;
    const target = rows[rows.length - 1];
    const gp = m.stat !== 'gp' && m.ngp != null;
    const cols = gp ? 'grid-cols-[2.25rem_minmax(0,1fr)_auto_auto]' : 'grid-cols-[2.25rem_minmax(0,1fr)_auto]';
    const row = 'col-span-full grid grid-cols-subgrid px-1.5';
    return (
        <ol className={cn('grid w-full max-w-[320px] text-micro tabular-nums', cols, className)}>
            <li aria-hidden="true" className={cn(row, 'leading-[16px] uppercase tracking-[0.08em] text-fg-3')}>
                <span />
                <span />
                <span className="pl-3 text-right">{STAT_ABBR[m.stat]}</span>
                {gp ? <span className="pl-3 text-right">GP</span> : null}
            </li>
            {rows.map(r => (
                <li key={r[1]} className={cn(row, 'leading-[18px]', r === target ? 'text-fg-2' : 'text-fg-3')}>
                    <span className="text-right">{r[0]}</span>
                    <span className="truncate pl-2">
                        {r[2]}
                        {r[5] ? <span className="text-fg-3"> +{r[5]}</span> : null}
                        {r[4] ? <span className="ml-1 font-bold tracking-[0.08em] text-fg-2">HOF</span> : null}
                    </span>
                    <span className="pl-3 text-right">{fmtInt(r[3])}</span>
                    {gp ? <span className="pl-3 text-right">{r[6] != null ? fmtInt(r[6]) : '—'}</span> : null}
                </li>
            ))}
            {m.gap ? (
                <li className={cn(row, 'leading-[18px] text-fg-3')}>
                    <span />
                    <span className="pl-2">+{m.gap} between</span>
                </li>
            ) : null}
            <li className={cn(row, 'rounded-[4px] bg-surface-3 font-bold leading-[20px] text-fg-1')}>
                <span className="text-right">{m.now ?? ''}</span>
                <span className="truncate pl-2">{name}</span>
                <span className="pl-3 text-right">{fmtInt(m.have)}</span>
                {gp ? <span className="pl-3 text-right">{fmtInt(m.ngp ?? 0)}</span> : null}
            </li>
        </ol>
    );
}
