/**
 * The site's route map — one list drives the desktop nav, the mobile tab
 * bar, the sitemap and the 404 page.
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
    description: string;
}

export const NAV_ITEMS: NavItem[] = [
    { key: 'tonight', label: 'Tonight', href: '/', primary: true, description: "Tonight's games, model win odds and edges" },
    { key: 'teams', label: 'Teams', href: '/teams', primary: true, description: 'Standings-style team table and team pages' },
    { key: 'players', label: 'Players', href: '/players', primary: true, description: 'Skater impact ratings' },
    { key: 'accuracy', label: 'Accuracy', href: '/accuracy', primary: true, description: "How the model's picks have graded out" },
    { key: 'standings', label: 'Standings', href: '/standings', description: 'Standings and playoff odds' },
    { key: 'news', label: 'News', href: '/news', description: 'Goalie, injury and lineup news' },
    { key: 'playoffs', label: 'Playoffs', href: '/playoffs', playoffsOnly: true, description: 'Series, bracket and odds' },
];

/** Secondary links (More sheet, footer). */
export const EXTRA_LINKS = [{ key: 'methodology', label: 'How it works', href: '/methodology', description: 'Model, grading, glossary and data sources' }];

export function isActive(href: string, pathname: string | null): boolean {
    if (!pathname) return false;
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(`${href}/`);
}
