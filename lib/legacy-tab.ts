/** Where an old home-page tab (/?tab=…) lives now. Case-insensitive; dates open that slate. */
const TABS: Record<string, string> = {
    teams: '/teams',
    history: '/accuracy',
    accuracy: '/accuracy',
    skaters: '/players',
    players: '/players',
    bracket: '/standings',
    standings: '/standings',
    news: '/news',
    playoffs: '/playoffs',
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(s: string): boolean {
    if (!DATE_RE.test(s)) return false;
    const t = Date.parse(`${s}T00:00:00Z`);
    return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/** Redirect target without the tab param, or null when there is no tab. Unknown tabs go home. */
export function legacyTabDestination(tab: string | null | undefined): string | null {
    if (tab == null) return null;
    const t = tab.trim();
    if (isRealDate(t)) return `/?date=${t}`;
    return TABS[t.toLowerCase()] ?? '/';
}
