/**
 * Home arenas of the 32 clubs and the special venues that appear in the NHL
 * schedule (outdoor games, Global Series, neutral sites), with coordinates
 * (arena centre, WGS84) and IANA time zones. Used for travel distances and
 * body-clock start times on the team Schedule tab.
 *
 * Venue names match the NHL schedule API's `venue.default`. A special venue
 * missing here falls back to the home club's arena (see `venueFor`), so add
 * new outdoor / international venues as the league announces them.
 */

export interface Place {
    name: string;
    city: string;
    lat: number;
    lon: number;
    tz: string;
}

export interface SpecialVenue extends Place {
    outdoor?: boolean;
}

export const ARENAS: Record<string, Place> = {
    ANA: { name: 'Honda Center', city: 'Anaheim', lat: 33.8078, lon: -117.8765, tz: 'America/Los_Angeles' },
    BOS: { name: 'TD Garden', city: 'Boston', lat: 42.3662, lon: -71.0621, tz: 'America/New_York' },
    BUF: { name: 'KeyBank Center', city: 'Buffalo', lat: 42.875, lon: -78.8764, tz: 'America/New_York' },
    CAR: { name: 'Lenovo Center', city: 'Raleigh', lat: 35.8033, lon: -78.7219, tz: 'America/New_York' },
    CBJ: { name: 'Nationwide Arena', city: 'Columbus', lat: 39.9693, lon: -83.0061, tz: 'America/New_York' },
    CGY: { name: 'Scotiabank Saddledome', city: 'Calgary', lat: 51.0374, lon: -114.0519, tz: 'America/Edmonton' },
    CHI: { name: 'United Center', city: 'Chicago', lat: 41.8807, lon: -87.6742, tz: 'America/Chicago' },
    COL: { name: 'Ball Arena', city: 'Denver', lat: 39.7487, lon: -105.0077, tz: 'America/Denver' },
    DAL: { name: 'American Airlines Center', city: 'Dallas', lat: 32.7905, lon: -96.8103, tz: 'America/Chicago' },
    DET: { name: 'Little Caesars Arena', city: 'Detroit', lat: 42.3411, lon: -83.0553, tz: 'America/Detroit' },
    EDM: { name: 'Rogers Place', city: 'Edmonton', lat: 53.5469, lon: -113.4979, tz: 'America/Edmonton' },
    FLA: { name: 'Amerant Bank Arena', city: 'Sunrise', lat: 26.1584, lon: -80.3256, tz: 'America/New_York' },
    LAK: { name: 'Crypto.com Arena', city: 'Los Angeles', lat: 34.043, lon: -118.2673, tz: 'America/Los_Angeles' },
    MIN: { name: 'Grand Casino Arena', city: 'St. Paul', lat: 44.9448, lon: -93.101, tz: 'America/Chicago' },
    MTL: { name: 'Centre Bell', city: 'Montréal', lat: 45.4961, lon: -73.5693, tz: 'America/Toronto' },
    NJD: { name: 'Prudential Center', city: 'Newark', lat: 40.7334, lon: -74.1711, tz: 'America/New_York' },
    NSH: { name: 'Bridgestone Arena', city: 'Nashville', lat: 36.1592, lon: -86.7785, tz: 'America/Chicago' },
    NYI: { name: 'UBS Arena', city: 'Elmont', lat: 40.7117, lon: -73.7257, tz: 'America/New_York' },
    NYR: { name: 'Madison Square Garden', city: 'New York', lat: 40.7505, lon: -73.9934, tz: 'America/New_York' },
    OTT: { name: 'Canadian Tire Centre', city: 'Ottawa', lat: 45.2969, lon: -75.9272, tz: 'America/Toronto' },
    PHI: { name: 'Xfinity Mobile Arena', city: 'Philadelphia', lat: 39.9012, lon: -75.172, tz: 'America/New_York' },
    PIT: { name: 'PPG Paints Arena', city: 'Pittsburgh', lat: 40.4394, lon: -79.9893, tz: 'America/New_York' },
    SEA: { name: 'Climate Pledge Arena', city: 'Seattle', lat: 47.6221, lon: -122.354, tz: 'America/Los_Angeles' },
    SJS: { name: 'SAP Center at San Jose', city: 'San Jose', lat: 37.3328, lon: -121.9012, tz: 'America/Los_Angeles' },
    STL: { name: 'Enterprise Center', city: 'St. Louis', lat: 38.6268, lon: -90.2026, tz: 'America/Chicago' },
    TBL: { name: 'Benchmark International Arena', city: 'Tampa', lat: 27.9427, lon: -82.4518, tz: 'America/New_York' },
    TOR: { name: 'Scotiabank Arena', city: 'Toronto', lat: 43.6435, lon: -79.3791, tz: 'America/Toronto' },
    UTA: { name: 'Delta Center', city: 'Salt Lake City', lat: 40.7683, lon: -111.9011, tz: 'America/Denver' },
    VAN: { name: 'Rogers Arena', city: 'Vancouver', lat: 49.2778, lon: -123.1089, tz: 'America/Vancouver' },
    VGK: { name: 'T-Mobile Arena', city: 'Las Vegas', lat: 36.1029, lon: -115.1784, tz: 'America/Los_Angeles' },
    WPG: { name: 'Canada Life Centre', city: 'Winnipeg', lat: 49.8928, lon: -97.1436, tz: 'America/Winnipeg' },
    WSH: { name: 'Capital One Arena', city: 'Washington', lat: 38.8981, lon: -77.0209, tz: 'America/New_York' },
};

/** Special venues by the schedule API's venue name. */
export const SPECIAL_VENUES: Record<string, SpecialVenue> = {
    // Outdoor games
    'loanDepot park': { name: 'loanDepot park', city: 'Miami', lat: 25.7781, lon: -80.2197, tz: 'America/New_York', outdoor: true },
    'Raymond James Stadium': { name: 'Raymond James Stadium', city: 'Tampa', lat: 27.9759, lon: -82.5033, tz: 'America/New_York', outdoor: true },
    'AT&T Stadium': { name: 'AT&T Stadium', city: 'Arlington', lat: 32.7473, lon: -97.0945, tz: 'America/Chicago', outdoor: true },
    'Rice-Eccles Stadium': { name: 'Rice-Eccles Stadium', city: 'Salt Lake City', lat: 40.76, lon: -111.8489, tz: 'America/Denver', outdoor: true },
    'Princess Auto Stadium': { name: 'Princess Auto Stadium', city: 'Winnipeg', lat: 49.8077, lon: -97.1433, tz: 'America/Winnipeg', outdoor: true },
    'Ohio Stadium': { name: 'Ohio Stadium', city: 'Columbus', lat: 40.0017, lon: -83.0197, tz: 'America/New_York', outdoor: true },
    'Wrigley Field': { name: 'Wrigley Field', city: 'Chicago', lat: 41.9484, lon: -87.6553, tz: 'America/Chicago', outdoor: true },
    'Fenway Park': { name: 'Fenway Park', city: 'Boston', lat: 42.3467, lon: -71.0972, tz: 'America/New_York', outdoor: true },
    'MetLife Stadium': { name: 'MetLife Stadium', city: 'East Rutherford', lat: 40.8135, lon: -74.0745, tz: 'America/New_York', outdoor: true },
    // Global Series
    'Avicii Arena': { name: 'Avicii Arena', city: 'Stockholm', lat: 59.2936, lon: 18.0831, tz: 'Europe/Stockholm' },
    'Veikkaus Arena': { name: 'Veikkaus Arena', city: 'Helsinki', lat: 60.2052, lon: 24.9286, tz: 'Europe/Helsinki' },
    'PSD Bank Dome': { name: 'PSD Bank Dome', city: 'Düsseldorf', lat: 51.2665, lon: 6.734, tz: 'Europe/Berlin' },
    'O2 Arena': { name: 'O2 Arena', city: 'Prague', lat: 50.1047, lon: 14.4932, tz: 'Europe/Prague' },
    'Nokia Arena': { name: 'Nokia Arena', city: 'Tampere', lat: 61.4943, lon: 23.7733, tz: 'Europe/Helsinki' },
};

const R_MI = 3958.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in miles. */
export function haversineMi(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
    const dLat = rad(b.lat - a.lat);
    const dLon = rad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface ResolvedVenue extends Place {
    /** Stable key: the home tricode for a club arena, else the venue name. */
    key: string;
    outdoor: boolean;
    /** Outside North America (Global Series). */
    abroad: boolean;
    /** True when the venue is not in our tables and we fell back to the home arena. */
    approx: boolean;
}

/** Where a game is played: a special venue by name, else the home club's arena. */
export function venueFor(venueName: string | null | undefined, homeTri: string, apiTz?: string | null): ResolvedVenue {
    const special = venueName ? SPECIAL_VENUES[venueName] : undefined;
    if (special) return { ...special, key: special.name, outdoor: !!special.outdoor, abroad: special.lon > -50, approx: false };
    const arena = ARENAS[homeTri];
    const isHomeArena = !venueName || venueName === arena?.name;
    return {
        ...arena,
        name: venueName || arena.name,
        tz: isHomeArena ? arena.tz : apiTz || arena.tz,
        key: homeTri,
        outdoor: false,
        abroad: false,
        approx: !isHomeArena,
    };
}
