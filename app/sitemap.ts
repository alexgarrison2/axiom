import type { MetadataRoute } from 'next';
import { NAV_ITEMS } from '@/components/nav-items';
import { listArchiveSeasons } from '@/components/playoff/archive';
import { TEAM_CODES } from '@/components/ui/team-color';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.ponyxg.com';

export const revalidate = 86400;

/** Canonical routes, the playoff archives and the 32 team pages. */
export default function sitemap(): MetadataRoute.Sitemap {
    const now = new Date();
    const sections = NAV_ITEMS.map(i => {
        const home = i.href === '/';
        const method = i.href === '/methodology';
        return {
            url: `${SITE_URL}${home ? '' : i.href}`,
            lastModified: now,
            changeFrequency: (home ? 'hourly' : method ? 'weekly' : 'daily') as 'hourly' | 'daily' | 'weekly',
            priority: home ? 1 : method ? 0.5 : 0.8,
        };
    });
    return [
        ...sections,
        ...listArchiveSeasons().map(season => ({
            url: `${SITE_URL}/playoffs/${season}`,
            lastModified: now,
            changeFrequency: 'monthly' as const,
            priority: 0.4,
        })),
        ...TEAM_CODES.map(tri => ({
            url: `${SITE_URL}/teams/${tri}`,
            lastModified: now,
            changeFrequency: 'daily' as const,
            priority: 0.6,
        })),
    ];
}
