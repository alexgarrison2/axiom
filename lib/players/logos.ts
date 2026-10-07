import registry from './logo-registry.json';

/*
 * League and team logos for the career tables on the player page. The NHL
 * landing payload carries only a league abbreviation ("QMJHL", "WJC-20") and a
 * short team name ("Halifax", "Färjestad BK J20", "Canada U20") per season, so
 * this maps those strings onto the files under /public/logos:
 *   - NHL clubs by full name and season (era logos, e.g. the 2003-14 Phoenix Coyotes);
 *   - national teams to their flag ("Canada U20", "Team USA", "Czech Republic U18");
 *   - other clubs by league family (a J20 or U18 side shares its club's crest) and
 *     season range where the club changed logos (HockeyTech per-season logos).
 * logo-registry.json is generated (sources in public/logos/SOURCES.md). Anything
 * unknown returns null: callers render nothing, never a broken image.
 */

type Era = [from: number, to: number, file: string];
interface Registry {
    leagues: Record<string, string | Era[]>;
    families: Record<string, string[]>;
    teams: Record<string, Record<string, Era[]>>;
    flags: Record<string, string>;
    nhl: Record<string, Era[]>;
}
const R = registry as unknown as Registry;
const ROOT = '/logos/';

/** Repair UTF-8 read as Latin-1 ("BrynÃ¤s IF"), which the landing feed sometimes returns. */
function demojibake(s: string): string {
    if (!/[ÃÂ]/.test(s)) return s;
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(s, c => c.charCodeAt(0) & 0xff));
    } catch {
        return s;
    }
}

const LIGATURES: [RegExp, string][] = [
    [/œ/g, 'oe'], [/Œ/g, 'Oe'], [/æ/g, 'ae'], [/Æ/g, 'Ae'], [/ø/g, 'o'], [/Ø/g, 'O'], [/ß/g, 'ss'], [/ł/g, 'l'], [/Ł/g, 'L'], [/đ/g, 'd'],
];

/** Lowercase, accent-free, punctuation-free key: "Québec Remparts" -> "quebec remparts", "Val-d'Or" -> "val dor". */
export function normName(s: string | null | undefined): string {
    let t = demojibake(s ?? '');
    for (const [re, to] of LIGATURES) t = t.replace(re, to);
    return t
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[.'’`´]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

// Trailing age group, junior, reserve, tier and colour tags: "Frölunda HC J18 2", "Skelleftea Jr.", "Canada Red U17", "Shattuck St. Mary's 16U AAA".
const SUFFIX = /(?:\s(?:jr|junior|juniors|j20|j18|j17|j16|u20|u19|u18|u17|u16|u15|u14|u13|u12|u22|2|3|ii|iii|b|ungdom|akademi|academy|future|spirit|young|youth|white|blue|red|black|gold|green|grey|gray|orange|selects|team|\d\du|aaa|aa|prep|bantam|midget|major|minor|peewee|pw|t1))+$/;

/** The club behind a junior or reserve side: "Färjestad BK J20" -> "farjestad bk", "Canada U20" -> "canada". */
export function baseName(s: string | null | undefined): string {
    let k = normName((s ?? '').replace(/\s*\(.*?\)\s*/g, ' '));
    for (let prev = ''; prev !== k; ) {
        prev = k;
        k = k.replace(SUFFIX, '').trim();
    }
    return k;
}

const COUNTRY_ALIASES: Record<string, string> = {
    usa: 'us', 'united states': 'us', us: 'us', 'united states of america': 'us', america: 'us',
    canada: 'ca', sweden: 'se', finland: 'fi', suomi: 'fi', russia: 'ru', czechia: 'cz', 'czech republic': 'cz', czech: 'cz',
    slovakia: 'sk', switzerland: 'ch', swiss: 'ch', germany: 'de', latvia: 'lv', denmark: 'dk', norway: 'no', belarus: 'by',
    austria: 'at', france: 'fr', slovenia: 'si', kazakhstan: 'kz', italy: 'it', hungary: 'hu', poland: 'pl',
    'great britain': 'gb', 'united kingdom': 'gb', japan: 'jp', ukraine: 'ua', netherlands: 'nl', 'south korea': 'kr', korea: 'kr',
    estonia: 'ee', lithuania: 'lt', romania: 'ro', croatia: 'hr', china: 'cn', australia: 'au',
};

/** ISO code for a national team name ("Canada U20", "Team USA", "Canada West U19", "Russia (EHT)"), else null. */
export function countryOf(team: string | null | undefined): string | null {
    let k = baseName(team).replace(/^team\s+/, '');
    k = k.replace(/\s(?:east|west|north|south|eht|a)$/, '').trim();
    return COUNTRY_ALIASES[k] ?? null;
}

function pick(eras: Era[] | undefined, season: number): string | null {
    if (!eras?.length) return null;
    const hit = eras.find(([from, to]) => season >= from && season <= to);
    return hit ? hit[2] : null;
}

/** Logo for a league or tournament abbreviation as the landing feed spells it ("OHL", "WJC-20", "J20 SuperElit"). */
export function leagueLogo(league: string | null | undefined, season = 0): string | null {
    const v = R.leagues[league ?? ''];
    if (!v) return null;
    const file = typeof v === 'string' ? v : pick(v, season);
    return file ? ROOT + file : null;
}

/** Era-correct NHL crest for a full club name in a season ("Atlanta Thrashers", 20082009). */
export function nhlTeamLogo(team: string | null | undefined, season: number): string | null {
    const file = pick(R.nhl[normName(team)], season);
    return file ? ROOT + file : null;
}

export interface TeamLogo {
    src: string;
    /** Flags are 4:3 rectangles; crests are drawn square. */
    kind: 'flag' | 'crest';
}

/** Logo for one career row: NHL crest, national flag, or the club's crest in its league family. */
export function teamLogo(league: string | null | undefined, team: string | null | undefined, season: number): TeamLogo | null {
    if (!team) return null;
    if (league === 'NHL') {
        const src = nhlTeamLogo(team, season);
        return src ? { src, kind: 'crest' } : null;
    }
    const iso = countryOf(team);
    if (iso && R.flags[iso]) return { src: ROOT + R.flags[iso], kind: 'flag' };
    const keys = [...new Set([normName(team), baseName(team)])].filter(Boolean);
    const fams = [...(R.families[league ?? ''] ?? []), 'any'];
    for (const fam of fams) {
        const table = R.teams[fam];
        if (!table) continue;
        for (const k of keys) {
            const file = pick(table[k], season);
            if (file) return { src: ROOT + file, kind: 'crest' };
        }
    }
    return null;
}
