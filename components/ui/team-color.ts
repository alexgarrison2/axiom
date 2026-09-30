/**
 * The one team-colour helper for dark surfaces.
 *
 * Replaces the VIVID maps that were copy-pasted into MatchupCard,
 * PlayoffBracket and PlayoffHub. `primary` is each club's main colour tuned to
 * stay visible on the #05070B ice; `alt` is a genuinely different club colour
 * used when two primaries clash in the same bar (CAR vs FLA, TOR vs WPG …).
 *
 * Use `clashSafePair(away, home)` for anything that puts two teams side by
 * side (win bars, series bars, charts) and `readableTextOn(color)` for text on
 * a team fill.
 */
import { deltaE, readableTextOn } from './color';

export interface TeamPalette {
    primary: string;
    alt: string;
}

export const TEAM_PALETTE: Record<string, TeamPalette> = {
    ANA: { primary: '#F47A38', alt: '#B9975B' },
    BOS: { primary: '#FFB81C', alt: '#C9CED6' },
    BUF: { primary: '#1F6FD1', alt: '#FCB514' },
    CAR: { primary: '#CC0000', alt: '#A2AAAD' },
    CBJ: { primary: '#2F5FB3', alt: '#CE1126' },
    CGY: { primary: '#D2001C', alt: '#F1BE48' },
    CHI: { primary: '#CF0A2C', alt: '#D9D9D9' },
    COL: { primary: '#9B4060', alt: '#3E7FC1' },
    DAL: { primary: '#00875A', alt: '#8F8F8C' },
    DET: { primary: '#CE1126', alt: '#E6E6E6' },
    EDM: { primary: '#FF4C00', alt: '#2F5DA8' },
    FLA: { primary: '#C8102E', alt: '#B9975B' },
    LAK: { primary: '#A8AEB5', alt: '#5A5F66' },
    MIN: { primary: '#3A8F5A', alt: '#A6192E' },
    MTL: { primary: '#AF1E2D', alt: '#3A48B0' },
    NJD: { primary: '#CE1126', alt: '#A2AAAD' },
    NSH: { primary: '#FFB81C', alt: '#2F5DA8' },
    NYI: { primary: '#0068C2', alt: '#F47D30' },
    NYR: { primary: '#0083C6', alt: '#CE1126' },
    OTT: { primary: '#C52032', alt: '#D19F2A' },
    PHI: { primary: '#F74902', alt: '#D9D9D9' },
    PIT: { primary: '#FCB514', alt: '#A2AAAD' },
    SEA: { primary: '#7DE0DE', alt: '#E9072B' },
    SJS: { primary: '#007889', alt: '#EA7200' },
    STL: { primary: '#5B8EE8', alt: '#FCB514' },
    TBL: { primary: '#3278D4', alt: '#E6E6E6' },
    TOR: { primary: '#5B8EE8', alt: '#E6E6E6' },
    UTA: { primary: '#71AFE5', alt: '#B5B5B5' },
    VAN: { primary: '#2E62C0', alt: '#00943D' },
    VGK: { primary: '#B4975A', alt: '#8C9AA0' },
    WPG: { primary: '#2A6FC9', alt: '#AC162C' },
    WSH: { primary: '#C8102E', alt: '#3B5BA9' },
};

/** Full and short club names, for nav grids, sitemaps and labels. */
export const TEAM_NAMES: Record<string, { name: string; short: string }> = {
    ANA: { name: 'Anaheim Ducks', short: 'Ducks' },
    BOS: { name: 'Boston Bruins', short: 'Bruins' },
    BUF: { name: 'Buffalo Sabres', short: 'Sabres' },
    CAR: { name: 'Carolina Hurricanes', short: 'Hurricanes' },
    CBJ: { name: 'Columbus Blue Jackets', short: 'Blue Jackets' },
    CGY: { name: 'Calgary Flames', short: 'Flames' },
    CHI: { name: 'Chicago Blackhawks', short: 'Blackhawks' },
    COL: { name: 'Colorado Avalanche', short: 'Avalanche' },
    DAL: { name: 'Dallas Stars', short: 'Stars' },
    DET: { name: 'Detroit Red Wings', short: 'Red Wings' },
    EDM: { name: 'Edmonton Oilers', short: 'Oilers' },
    FLA: { name: 'Florida Panthers', short: 'Panthers' },
    LAK: { name: 'Los Angeles Kings', short: 'Kings' },
    MIN: { name: 'Minnesota Wild', short: 'Wild' },
    MTL: { name: 'Montréal Canadiens', short: 'Canadiens' },
    NJD: { name: 'New Jersey Devils', short: 'Devils' },
    NSH: { name: 'Nashville Predators', short: 'Predators' },
    NYI: { name: 'New York Islanders', short: 'Islanders' },
    NYR: { name: 'New York Rangers', short: 'Rangers' },
    OTT: { name: 'Ottawa Senators', short: 'Senators' },
    PHI: { name: 'Philadelphia Flyers', short: 'Flyers' },
    PIT: { name: 'Pittsburgh Penguins', short: 'Penguins' },
    SEA: { name: 'Seattle Kraken', short: 'Kraken' },
    SJS: { name: 'San Jose Sharks', short: 'Sharks' },
    STL: { name: 'St. Louis Blues', short: 'Blues' },
    TBL: { name: 'Tampa Bay Lightning', short: 'Lightning' },
    TOR: { name: 'Toronto Maple Leafs', short: 'Maple Leafs' },
    UTA: { name: 'Utah Mammoth', short: 'Mammoth' },
    VAN: { name: 'Vancouver Canucks', short: 'Canucks' },
    VGK: { name: 'Vegas Golden Knights', short: 'Golden Knights' },
    WPG: { name: 'Winnipeg Jets', short: 'Jets' },
    WSH: { name: 'Washington Capitals', short: 'Capitals' },
};

export const TEAM_CODES = Object.keys(TEAM_PALETTE).sort();

/** Minimum CIE76 ΔE for two adjacent team fills to read as different teams. */
export const MIN_TEAM_DELTA_E = 25;

const FALLBACK: TeamPalette = { primary: '#7C8796', alt: '#A9B4C2' };

export function teamPalette(tri: string): TeamPalette {
    return TEAM_PALETTE[tri?.toUpperCase?.()] ?? FALLBACK;
}

/** A team's main colour on dark surfaces. */
export function teamColor(tri: string): string {
    return teamPalette(tri).primary;
}

/** Text colour (near-black or white) with the best WCAG contrast on a team fill. */
export function teamTextColor(tri: string, which: 'primary' | 'alt' = 'primary'): string {
    return readableTextOn(teamPalette(tri)[which]);
}

export interface ColorPair {
    away: string;
    home: string;
    /** Which palette entry was used for each side. */
    awayVariant: 'primary' | 'alt';
    homeVariant: 'primary' | 'alt';
    deltaE: number;
}

/**
 * Colours for two teams shown side by side. Keeps both primaries when they
 * are distinct (ΔE ≥ 25); otherwise swaps the away team to its alt colour,
 * then the home team, then both — and if nothing clears the bar, returns the
 * most distinct combination.
 */
export function clashSafePair(awayTri: string, homeTri: string): ColorPair {
    const a = teamPalette(awayTri);
    const h = teamPalette(homeTri);
    const options: ColorPair[] = (
        [
            ['primary', 'primary'],
            ['alt', 'primary'],
            ['primary', 'alt'],
            ['alt', 'alt'],
        ] as const
    ).map(([av, hv]) => ({
        away: a[av],
        home: h[hv],
        awayVariant: av,
        homeVariant: hv,
        deltaE: deltaE(a[av], h[hv]),
    }));
    return options.find(o => o.deltaE >= MIN_TEAM_DELTA_E) ?? options.reduce((best, o) => (o.deltaE > best.deltaE ? o : best));
}
