'use client';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { Crest } from '@/components/ui/crest';
import { LocalTime } from '@/components/ui/local-time';
import { dayLabel, meter, type Milestone, type NextGame } from '@/lib/milestones';
import { cn } from '@/lib/utils';

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
