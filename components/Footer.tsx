import Link from 'next/link';
import { getDataStamp } from '@/components/ui/data-stamp';
import { SEASON_START_YEAR } from '@/lib/season';
import { LocalTime } from '@/components/ui/local-time';
import { formatTimeET } from '@/lib/format/time';

const SOURCES = [
    { name: 'NHL', href: 'https://www.nhl.com' },
    { name: 'MoneyPuck.com', href: 'https://moneypuck.com' },
    { name: 'DailyFaceoff', href: 'https://www.dailyfaceoff.com' },
    { name: 'ESPN', href: 'https://www.espn.com/nhl/' },
];

/** Site footer: data credits (MoneyPuck's terms require credit), data-as-of stamp, methodology links. */
export default function Footer() {
    const stampIso = getDataStamp().generatedAt;
    const stamp = stampIso && formatTimeET(stampIso, 'datetime') ? stampIso : null;
    const season = `${SEASON_START_YEAR}-${String(SEASON_START_YEAR + 1).slice(2)}`;

    return (
        <footer className="pb-tabbar mt-16 border-t border-line bg-bg">
            <div className="mx-auto grid max-w-[1800px] gap-6 px-4 py-8 text-body-sm text-fg-2 md:grid-cols-[1fr_auto] md:px-6">
                <div className="space-y-2">
                    <p>
                        <span className="hud-label mr-2">Data</span>
                        {SOURCES.map((s, i) => (
                            <span key={s.name}>
                                <a href={s.href} className="text-fg-1 underline decoration-line-strong underline-offset-4 hover:decoration-brand" rel="noopener noreferrer" target="_blank">
                                    {s.name}
                                </a>
                                {i < SOURCES.length - 1 ? ', ' : ''}
                            </span>
                        ))}
                        .
                    </p>
                    <p className="text-caption text-fg-3">
                        {stamp ? <>Data as of <LocalTime iso={stamp} style="datetime" /> · </> : null}
                        {season} season · Probabilities are estimates, not betting advice. If you bet, bet responsibly (21+, 1-800-GAMBLER).
                    </p>
                </div>
                <nav aria-label="Footer" className="flex flex-wrap items-start gap-x-5 gap-y-1 md:justify-end">
                    <Link href="/methodology" className="inline-flex min-h-11 items-center text-fg-1 hover:text-brand md:min-h-0">
                        How it works
                    </Link>
                    <Link href="/methodology#glossary" className="inline-flex min-h-11 items-center text-fg-1 hover:text-brand md:min-h-0">
                        Glossary
                    </Link>
                    <Link href="/accuracy" className="inline-flex min-h-11 items-center text-fg-1 hover:text-brand md:min-h-0">
                        Model record
                    </Link>
                </nav>
            </div>
        </footer>
    );
}
