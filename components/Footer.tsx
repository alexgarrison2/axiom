import Link from 'next/link';

const SOURCES = [
    { name: 'NHL', href: 'https://www.nhl.com' },
    { name: 'MoneyPuck.com', href: 'https://moneypuck.com' },
    { name: 'DailyFaceoff', href: 'https://www.dailyfaceoff.com' },
    { name: 'ESPN', href: 'https://www.espn.com/nhl/' },
];

const link = 'inline-flex min-h-6 items-center transition-colors hover:text-fg-1';

/** One line of credits (MoneyPuck's terms require credit), the methodology link and 21+. */
export default function Footer() {
    return (
        <footer className="pb-tabbar mt-12 border-t border-line">
            <div className="page flex flex-wrap items-center gap-x-5 gap-y-1 py-4 text-micro uppercase tracking-wide text-fg-3">
                <p className="flex flex-wrap items-center gap-x-3">
                    <span>Data</span>
                    {SOURCES.map(s => (
                        <a key={s.name} href={s.href} className={link} rel="noopener noreferrer" target="_blank">
                            {s.name}
                        </a>
                    ))}
                </p>
                <nav aria-label="Footer" className="flex items-center gap-x-5 md:ml-auto">
                    <Link href="/methodology" className={link}>
                        Methodology
                    </Link>
                    <span>21+ · 1-800-GAMBLER</span>
                </nav>
            </div>
        </footer>
    );
}
