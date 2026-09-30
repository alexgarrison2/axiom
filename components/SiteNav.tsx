import fs from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import { BrandMark } from '@/components/ui/brand-mark';
import { FreshnessBadge } from '@/components/ui/freshness-badge';
import { getDataStamp } from '@/components/ui/data-stamp';
import { SEASON_ID, SEASON_START_DATE, SEASON_START_YEAR } from '@/lib/season';
import { SiteNavLinks } from './SiteNavLinks';
import { MobileTabBar } from './MobileTabBar';

function readSeries(): { status?: string; games?: { date?: string }[] }[] {
    try {
        const raw = fs.readFileSync(path.join(process.cwd(), 'public/data/playoff_series.json'), 'utf8');
        const series = JSON.parse(raw);
        return Array.isArray(series) ? series : [];
    } catch {
        return [];
    }
}

const inThisSeason = (s: { games?: { date?: string }[] }) => (s.games ?? []).some(g => (g.date ?? '') >= SEASON_START_DATE);

/** True while a current-season playoff series is scheduled or in progress. */
export function playoffsActive(): boolean {
    return readSeries().some(s => s.status !== 'complete' && inThisSeason(s));
}

/**
 * The postseason the nav links: this season's once it starts, else last
 * season's archive. No directory listing here (the root layout is in every
 * function, and listing public/data/playoffs would trace it into all of them).
 */
export function navPlayoffsSeason(): string {
    return readSeries().some(inThisSeason) ? SEASON_ID : `${SEASON_START_YEAR - 1}${SEASON_START_YEAR}`;
}

/** Puck drops (ISO UTC) within a day of the build/render, for the freshness badge's game-day rules. */
export function puckDrops(now = Date.now()): string[] | null {
    try {
        const raw = fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'upcoming_games.json'), 'utf8');
        const games = JSON.parse(raw) as { startTimeUTC?: string }[];
        if (!Array.isArray(games)) return null;
        const out = new Set<string>();
        for (const g of games) {
            const ms = g.startTimeUTC ? Date.parse(g.startTimeUTC) : NaN;
            if (Number.isFinite(ms) && Math.abs(ms - now) <= 36 * 3_600_000) out.add(new Date(ms).toISOString());
        }
        return [...out].sort();
    } catch {
        return null;
    }
}

/**
 * The one site navigation, rendered once from app/layout.tsx: a compact
 * sticky bar (pony xG logo, mono section links from md up, "UPDATED 4M" live
 * dot) and, below md, a fixed bottom tab bar in the same language.
 */
export default function SiteNav() {
    const stamp = getDataStamp();
    const starts = puckDrops();
    const playoffs = navPlayoffsSeason();

    return (
        <>
            <header className="sticky top-0 z-40 border-b border-line bg-bg/[.82] pt-[env(safe-area-inset-top)] backdrop-blur-[10px]">
                <div className="page flex h-appbar items-center gap-6 md:gap-5 lg:gap-8">
                    <Link
                        href="/"
                        aria-label="Pony xG home"
                        className="-ml-1 flex min-h-11 shrink-0 items-center rounded-control px-1 transition-[filter] hover:brightness-125"
                    >
                        <BrandMark className="h-[28px] drop-shadow-[0_0_10px_rgba(41,231,255,.35)] md:h-[30px]" />
                    </Link>
                    <SiteNavLinks />
                    <div className="ml-auto flex items-center">
                        <FreshnessBadge generatedAt={stamp.generatedAt} starts={starts} />
                    </div>
                </div>
            </header>
            <MobileTabBar playoffsSeason={playoffs} />
        </>
    );
}
