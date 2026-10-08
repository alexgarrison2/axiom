import Link from 'next/link';
import { cn } from '@/lib/utils';

/** The Players section's views: IMPACT ratings, the Pony Score leaderboard and the goalies. */
export function PlayersTabs({ active }: { active: 'ratings' | 'pony' | 'goalies' }) {
    const tab = (href: string, key: 'ratings' | 'pony' | 'goalies', label: string) => (
        <Link
            href={href}
            aria-current={active === key ? 'page' : undefined}
            className={cn(
                'inline-flex h-8 items-center rounded-full border px-3 text-micro font-medium uppercase tracking-chip transition-colors coarse:h-11',
                active === key ? 'border-brand/60 text-brand' : 'border-line text-fg-3 hover:border-line-strong hover:text-fg-1',
            )}
        >
            {label}
        </Link>
    );
    return (
        <nav aria-label="Player views" className="flex gap-1.5">
            {tab('/players', 'ratings', 'Ratings')}
            {tab('/players/pony', 'pony', 'Pony score')}
            {tab('/players/goalies', 'goalies', 'Goalies')}
        </nav>
    );
}
