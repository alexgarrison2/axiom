/**
 * The site's route map — one list drives the desktop nav, the mobile tab
 * bar and the sitemap. The set is the same on every route.
 */
export interface NavItem {
    key: string;
    label: string;
    href: string;
    /** Short label for the mobile tab bar. */
    short?: string;
    /** Shown in the mobile bottom bar (the rest go under "More"). */
    primary?: boolean;
    /** Other path prefixes that light this item up (e.g. the playoff archive under Standings). */
    also?: string[];
}

export const NAV_ITEMS: NavItem[] = [
    { key: 'tonight', label: 'Tonight', href: '/', primary: true },
    { key: 'teams', label: 'Teams', href: '/teams', primary: true },
    { key: 'players', label: 'Players', href: '/players', primary: true },
    { key: 'props', label: 'Props', href: '/props', primary: true },
    { key: 'standings', label: 'Standings', href: '/standings', also: ['/playoffs'] },
    { key: 'accuracy', label: 'Accuracy', href: '/accuracy', primary: true },
    { key: 'news', label: 'News', href: '/news' },
    { key: 'methodology', label: 'How it works', href: '/methodology' },
];

/** "20252026" → "25-26". */
export function shortSeason(seasonId: string): string {
    return `${seasonId.slice(2, 4)}-${seasonId.slice(6, 8)}`;
}

/** The playoff archive link for the More sheet and /standings, or null when no archive exists. */
export function playoffsLink(seasonId: string | null | undefined): NavItem | null {
    if (!seasonId || !/^\d{8}$/.test(seasonId)) return null;
    return { key: 'playoffs', label: `Playoffs ${shortSeason(seasonId)}`, href: `/playoffs/${seasonId}` };
}

export function isActive(href: string, pathname: string | null): boolean {
    if (!pathname) return false;
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(`${href}/`);
}

/** Active state for a nav item, including its `also` prefixes. */
export function isItemActive(item: NavItem, pathname: string | null): boolean {
    return isActive(item.href, pathname) || (item.also ?? []).some(p => isActive(p, pathname));
}
