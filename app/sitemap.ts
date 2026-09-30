import type { MetadataRoute } from 'next';
import { NAV_ITEMS } from '@/components/nav-items';
import { TEAM_CODES } from '@/components/ui/team-color';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.ponyxg.com';

export const revalidate = 86400;

/** Canonical routes plus the 32 team pages. */
export default function sitemap(): MetadataRoute.Sitemap {
    const now = new Date();
    const sections = NAV_ITEMS.filter(i => !i.playoffsOnly).map(i => ({
        url: `${SITE_URL}${i.href === '/' ? '' : i.href}`,
        lastModified: now,
        changeFrequency: (i.href === '/' ? 'hourly' : 'daily') as 'hourly' | 'daily',
        priority: i.href === '/' ? 1 : 0.8,
    }));
    return [
        ...sections,
        { url: `${SITE_URL}/methodology`, lastModified: now, changeFrequency: 'weekly', priority: 0.5 },
        ...TEAM_CODES.map(tri => ({
            url: `${SITE_URL}/teams/${tri}`,
            lastModified: now,
            changeFrequency: 'daily' as const,
            priority: 0.6,
        })),
    ];
}
