/**
 * The site's route map — one list drives the desktop nav, the mobile tab
 * bar and the sitemap.
 */
export interface NavItem {
    key: string;
    label: string;
    href: string;
    /** Short label for the mobile tab bar. */
    short?: string;
    /** Shown in the mobile bottom bar (the rest go under "More"). */
    primary?: boolean;
    /** Only while the playoffs are running. */
    playoffsOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
    { key: 'tonight', label: 'Tonight', href: '/', primary: true },
    { key: 'teams', label: 'Teams', href: '/teams', primary: true },
    { key: 'players', label: 'Players', href: '/players', primary: true },
    { key: 'standings', label: 'Standings', href: '/standings' },
    { key: 'accuracy', label: 'Accuracy', href: '/accuracy', primary: true },
    { key: 'news', label: 'News', href: '/news' },
    { key: 'playoffs', label: 'Playoffs', href: '/playoffs', playoffsOnly: true },
];

/** Secondary links (mobile More sheet, footer). */
export const EXTRA_LINKS: NavItem[] = [{ key: 'methodology', label: 'Methodology', href: '/methodology' }];

export function isActive(href: string, pathname: string | null): boolean {
    if (!pathname) return false;
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(`${href}/`);
}
