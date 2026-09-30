import fs from 'node:fs';
import path from 'node:path';
import Link from 'next/link';
import { BrandMark } from '@/components/ui/brand-mark';
import { FreshnessBadge } from '@/components/ui/freshness-badge';
import { getDataStamp } from '@/components/ui/data-stamp';
import { SEASON_START_DATE } from '@/lib/season';
import { SiteNavLinks } from './SiteNavLinks';
import { MobileTabBar } from './MobileTabBar';

/** True while a current-season playoff series is scheduled or in progress. */
export function playoffsActive(): boolean {
    try {
        const raw = fs.readFileSync(path.join(process.cwd(), 'public/data/playoff_series.json'), 'utf8');
        const series = JSON.parse(raw) as { status?: string; games?: { date?: string }[] }[];
        return (
            Array.isArray(series) &&
            series.some(s => s.status !== 'complete' && (s.games ?? []).some(g => (g.date ?? '') >= SEASON_START_DATE))
        );
    } catch {
        return false;
    }
}

/**
 * The one site navigation, rendered once from app/layout.tsx: a compact
 * sticky bar (pony xG logo, mono section links from md up, "UPDATED 4M" live
 * dot) and, below md, a fixed bottom tab bar in the same language.
 */
export default function SiteNav() {
    const stamp = getDataStamp();
    const showPlayoffs = playoffsActive();

    return (
        <>
            <header className="sticky top-0 z-40 border-b border-line bg-bg/[.82] pt-[env(safe-area-inset-top)] backdrop-blur-[10px]">
                <div className="mx-auto flex h-appbar max-w-[1400px] items-center gap-6 px-4 md:gap-5 md:px-6 lg:gap-8">
                    <Link
                        href="/"
                        aria-label="Pony xG home"
                        className="-ml-1 flex min-h-11 shrink-0 items-center rounded-control px-1 transition-[filter] hover:brightness-125"
                    >
                        <BrandMark className="h-[28px] drop-shadow-[0_0_10px_rgba(41,231,255,.35)] md:h-[30px]" />
                    </Link>
                    <SiteNavLinks showPlayoffs={showPlayoffs} />
                    <div className="ml-auto flex items-center">
                        <FreshnessBadge generatedAt={stamp.generatedAt} />
                    </div>
                </div>
            </header>
            <MobileTabBar showPlayoffs={showPlayoffs} />
        </>
    );
}
