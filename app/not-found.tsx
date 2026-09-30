import type { Metadata } from 'next';
import Link from 'next/link';
import FullLogoAnimated from '@/components/FullLogoAnimated';
import { Crest } from '@/components/ui/crest';
import { TEAM_CODES } from '@/components/ui/team-color';

export const metadata: Metadata = {
    title: 'Page not found',
    robots: { index: false },
};

/** 404: the nav stays (layout), plus a way back to tonight's games and all 32 crests. */
export default function NotFound() {
    return (
        <main className="mx-auto max-w-[1100px] px-4 pb-12 pt-10 md:px-6 md:pt-14">
            <div className="mx-auto max-w-[280px]" aria-hidden="true">
                <FullLogoAnimated idPrefix="nf-logo" />
            </div>
            <div className="mt-8 text-center">
                <p className="label text-warn">404</p>
                <h1 className="heading-page mt-3">Wide of the net</h1>
                <div className="mt-6 flex flex-wrap justify-center gap-3">
                    <Link
                        href="/"
                        className="inline-flex min-h-11 items-center rounded-control bg-brand px-5 text-caption font-bold uppercase tracking-chip text-brand-ink transition-[filter] hover:brightness-110"
                    >
                        Go to today&apos;s games
                    </Link>
                    <Link
                        href="/teams"
                        className="inline-flex min-h-11 items-center rounded-control border border-line px-5 text-caption font-bold uppercase tracking-chip text-fg-1 transition-colors hover:border-line-strong"
                    >
                        All teams
                    </Link>
                </div>
            </div>

            <section aria-labelledby="nf-teams" className="mt-12">
                <h2 id="nf-teams" className="label mb-3">
                    Teams
                </h2>
                <ul className="grid grid-cols-4 gap-2 sm:grid-cols-8">
                    {TEAM_CODES.map(tri => (
                        <li key={tri}>
                            <Link
                                href={`/teams/${tri}`}
                                className="panel panel-hover flex min-h-11 items-center justify-center gap-2 px-2 py-2 text-caption font-bold tracking-wide text-fg-1"
                            >
                                <Crest tri={tri} size={24} className="drop-shadow-none" />
                                {tri}
                            </Link>
                        </li>
                    ))}
                </ul>
            </section>
        </main>
    );
}
