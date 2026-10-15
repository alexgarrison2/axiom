import Link from 'next/link';
import { Crest } from '@/components/ui/crest';
import { describe, dayLabel, notableRecent, type MilestonesDoc } from '@/lib/milestones';

/** Round numbers reached in the last ten days, rarest first (green: done). */
export function RecentStrip({ doc, limit = 10 }: { doc: Pick<MilestonesDoc, 'players' | 'recent'>; limit?: number }) {
    const rows = notableRecent(doc.recent.filter(r => doc.players[String(r.p)]), limit);
    if (!rows.length) return null;
    return (
        <section aria-labelledby="ms-recent" className="flex flex-col gap-2">
            <h2 id="ms-recent" className="label">
                Just reached
            </h2>
            <ul className="edge-fade-x -mx-4 flex gap-2 overflow-x-auto px-4 scrollbar-hide md:-mx-6 md:px-6">
                {rows.map(r => {
                    const [first, last, , team] = doc.players[String(r.p)];
                    const c = describe({ p: r.p, kind: 'career', stat: r.stat, have: r.target, target: r.target, need: 0, rate: 0, eta: [r.game, r.date, r.opp, 0, 0], club: r.club - 1 }, null);
                    return (
                        <li key={`${r.p}-${r.stat}-${r.target}`} className="shrink-0">
                            <Link
                                href={`/games/${r.game}`}
                                className="group flex h-11 items-center gap-2 overflow-hidden rounded-full border border-line pr-3.5 hover:border-line-strong"
                            >
                                <Crest tri={team} size={44} alt={team} className="-my-1 drop-shadow-none" />
                                <span className="whitespace-nowrap text-caption">
                                    <span className="font-bold text-fg-1 group-hover:text-brand">{first.charAt(0)}. {last}</span>{' '}
                                    <span className="font-bold text-pos">{c.title}</span>{' '}
                                    <span className="text-fg-3">{c.context.split(" · ")[0]} · {dayLabel(r.date)}</span>
                                </span>
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
