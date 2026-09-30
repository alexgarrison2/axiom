import type { Metadata } from 'next';
import Link from 'next/link';
import FullLogoAnimated from '@/components/FullLogoAnimated';
import { TEAM_CODES, TEAM_NAMES, teamColor } from '@/components/ui/team-color';

export const metadata: Metadata = {
    title: 'Page not found',
    robots: { index: false },
};

/** 404: the nav stays (layout), plus a way back to tonight's games and a grid of all 32 teams. */
export default function NotFound() {
    return (
        <main className="mx-auto max-w-[1100px] px-4 pb-12 pt-10 md:px-6 md:pt-16">
            <div className="mx-auto max-w-md" aria-hidden="true">
                <FullLogoAnimated idPrefix="nf-logo" />
            </div>
            <div className="mt-8 text-center">
                <p className="hud-label text-warn">404 · Offside</p>
                <h1 className="mt-2 text-display font-black text-fg-1">That page went wide of the net.</h1>
                <p className="mx-auto mt-3 max-w-xl text-body text-fg-2">
                    The link may be old or mistyped. Tonight&apos;s games are one click away, or jump straight to a team.
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-3">
                    <Link
                        href="/"
                        className="inline-flex min-h-11 items-center rounded-control bg-brand px-5 text-body-sm font-bold text-brand-ink transition-[filter] hover:brightness-110"
                    >
                        Go to today&apos;s games
                    </Link>
                    <Link
                        href="/teams"
                        className="inline-flex min-h-11 items-center rounded-control border border-line-strong px-5 text-body-sm font-semibold text-fg-1 hover:bg-surface-2"
                    >
                        All teams
                    </Link>
                </div>
            </div>

            <section aria-labelledby="nf-teams" className="mt-14">
                <h2 id="nf-teams" className="hud-label mb-3">
                    Teams
                </h2>
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
                    {TEAM_CODES.map(tri => (
                        <li key={tri}>
                            <Link
                                href={`/teams/${tri}`}
                                className="group flex min-h-11 items-center gap-2 rounded-control border border-line bg-surface-1 px-3 py-2 transition-colors hover:border-line-strong hover:bg-surface-2"
                            >
                                <span aria-hidden="true" className="h-6 w-1 shrink-0 rounded-full" style={{ backgroundColor: teamColor(tri) }} />
                                <span className="min-w-0">
                                    <span className="block text-body-sm font-bold text-fg-1">{tri}</span>
                                    <span className="block truncate text-caption text-fg-3 group-hover:text-fg-2">{TEAM_NAMES[tri].short}</span>
                                </span>
                            </Link>
                        </li>
                    ))}
                </ul>
            </section>
        </main>
    );
}
