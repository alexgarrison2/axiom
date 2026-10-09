import Link from 'next/link';
import { NightRow, reachOf, type NightEntry } from '@/components/pony/NightRow';
import { cn } from '@/lib/utils';
import type { NightGame } from '@/lib/pony/data';
import { shortDate, weekdayDate } from '@/lib/matchup/format';

/**
 * The leaderboard's Nights view: the best and worst single games under the
 * filters, across the season or one night at a time (from = to). The stepper
 * walks the nights; its links keep every other filter.
 */

const STEP =
    'grid h-8 w-8 place-items-center rounded-control border border-line text-fg-2 hover:border-line-strong hover:text-fg-1 coarse:h-11 coarse:w-11';

function Arrow({ dir }: { dir: 'prev' | 'next' }) {
    return (
        <svg viewBox="0 0 8 8" className="h-2.5 w-2.5" aria-hidden="true">
            <path d={dir === 'prev' ? 'M5.5 1 2 4l3.5 3' : 'M2.5 1 6 4 2.5 7'} fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
    );
}

function entry({ row, player }: NightGame, oneNight: boolean): NightEntry {
    const g = 'sa' in row ? row : null;
    return {
        game: row.game,
        player: player.id,
        name: `${player.first.charAt(0)}. ${player.last}`,
        headshot: player.headshot,
        team: row.team,
        opp: row.opp,
        ps: row.ps,
        parts: 'parts' in row ? row.parts : null,
        when: oneNight ? undefined : shortDate(row.date),
        note: g ? `${g.sa - g.ga} saves on ${g.sa}` : undefined,
    };
}

export function PonyNights({
    best,
    worst,
    dates,
    from,
    to,
    href,
}: {
    best: NightGame[];
    worst: NightGame[];
    dates: string[];
    from: string | null;
    to: string | null;
    /** The current URL with these parameters changed (null removes one). */
    href: (patch: Record<string, string | null>) => string;
}) {
    const night = from && from === to ? from : null;
    const ranged = !night && (from || to);
    const i = night ? dates.indexOf(night) : -1;
    // From the whole season, back steps to the latest night.
    const prev = night ? (i > 0 ? dates[i - 1] : null) : (dates[dates.length - 1] ?? null);
    const next = night && i >= 0 && i < dates.length - 1 ? dates[i + 1] : null;
    const go = (d: string) => href({ from: d, to: d });
    const label = night ? weekdayDate(night) : ranged ? `${from ? shortDate(from) : 'Start'} – ${to ? shortDate(to) : 'now'}` : 'All season';

    const lists = [
        ['Best', best.map(r => entry(r, !!night))],
        ['Worst', worst.map(r => entry(r, !!night))],
    ] as const;
    const reach = reachOf([...lists[0][1], ...lists[1][1]]);

    return (
        <div className="flex flex-col gap-3">
            <nav aria-label="Nights" className="flex flex-wrap items-center gap-2">
                {prev ? (
                    <Link href={go(prev)} scroll={false} aria-label={`Previous night, ${weekdayDate(prev)}`} className={STEP}>
                        <Arrow dir="prev" />
                    </Link>
                ) : (
                    <span className={cn(STEP, 'opacity-40')} aria-hidden="true">
                        <Arrow dir="prev" />
                    </span>
                )}
                <span className="min-w-[8.5rem] text-center font-display text-body font-bold uppercase tracking-wide text-fg-1" aria-live="polite">
                    {label}
                </span>
                {next ? (
                    <Link href={go(next)} scroll={false} aria-label={`Next night, ${weekdayDate(next)}`} className={STEP}>
                        <Arrow dir="next" />
                    </Link>
                ) : (
                    <span className={cn(STEP, 'opacity-40')} aria-hidden="true">
                        <Arrow dir="next" />
                    </span>
                )}
                {night || ranged ? (
                    <Link
                        href={href({ from: null, to: null })}
                        scroll={false}
                        className="ml-1 text-micro uppercase tracking-label text-fg-3 underline-offset-4 hover:text-fg-1 hover:underline coarse:inline-flex coarse:min-h-11 coarse:items-center"
                    >
                        All season
                    </Link>
                ) : null}
                {night ? (
                    <Link
                        href={`/?date=${night}`}
                        className="ml-auto text-micro uppercase tracking-label text-fg-3 underline-offset-4 hover:text-fg-1 hover:underline coarse:inline-flex coarse:min-h-11 coarse:items-center"
                    >
                        Slate
                    </Link>
                ) : null}
            </nav>
            {best.length ? (
                <div className="grid gap-3 md:grid-cols-2">
                    {lists.map(([title, list]) => (
                        <div key={title} className="rounded-card border border-line bg-surface-1 px-card py-3 [container-type:inline-size]">
                            <p className="label mb-1">{title}</p>
                            <ol className="divide-y divide-line/60">
                                {list.map((r, k) => (
                                    <NightRow key={`${r.game}-${r.player}`} r={r} rank={k + 1} reach={reach} />
                                ))}
                            </ol>
                        </div>
                    ))}
                </div>
            ) : (
                <p className="py-10 text-center text-caption text-fg-3">No games match these filters.</p>
            )}
        </div>
    );
}
