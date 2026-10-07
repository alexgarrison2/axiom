import { groupAwards, seasonYears, type AwardIn } from '@/lib/players/awards';
import { YearList } from '@/components/player/YearList';

/*
 * The trophy shelf on a player page: one drawn trophy per award (artwork in
 * /public/trophies), its short name below and the year(s) won under that.
 * Repeat wins fold into one trophy with a count. Renders nothing without awards.
 */
export function AwardShelf({ awards }: { awards: AwardIn[] }) {
    const groups = groupAwards(awards);
    if (!groups.length) return null;
    return (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(6.25rem,1fr))] gap-x-3 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] sm:gap-x-4">
            {groups.map(g => (
                <li key={`${g.art}:${g.name}`} className="flex min-w-0 flex-col items-center text-center">
                    {/* eslint-disable-next-line @next/next/no-img-element -- small static SVGs, no optimisation needed */}
                    <img
                        src={`/trophies/${g.art}.svg`}
                        alt=""
                        width={54}
                        height={72}
                        loading="lazy"
                        decoding="async"
                        draggable={false}
                        className="h-[72px] w-auto select-none sm:h-[88px]"
                    />
                    <p className="mt-2 text-micro font-medium uppercase tracking-label text-fg-1">
                        <span className="sr-only">{g.name}</span>
                        <span aria-hidden="true">{g.label}</span>
                        {g.seasons.length > 1 ? <span className="ml-1 text-fg-2">×{g.seasons.length}</span> : null}
                    </p>
                    <YearList years={seasonYears(g.seasons)} />
                </li>
            ))}
        </ul>
    );
}
