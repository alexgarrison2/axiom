import 'server-only';

/**
 * One player's NHL profile (api-web.nhle.com/v1/player/{id}/landing): bio,
 * action photo, draft, awards and stats by season, normalised for the
 * player page. Cached six hours (Data Cache).
 */

type L = { default?: string } | undefined;
const t = (v: L) => v?.default ?? '';

export interface SeasonLine {
    season: number;
    league: string;
    team: string;
    gameType: number;
    /** The feed's order within a season (1 = first club, 2 = traded-to club, 11+ = tournaments). */
    seq: number;
    gp: number;
    // skaters
    g?: number;
    a?: number;
    p?: number;
    pm?: number;
    pim?: number;
    ppg?: number;
    shots?: number;
    shPct?: number | null;
    toi?: string | null;
    // goalies
    w?: number;
    l?: number;
    otl?: number;
    gaa?: number | null;
    svPct?: number | null;
    so?: number;
}

export interface Profile {
    id: number;
    first: string;
    last: string;
    pos: string;
    goalie: boolean;
    num: number | null;
    team: string | null;
    teamName: string | null;
    active: boolean;
    headshot: string | null;
    hero: string | null;
    birthDate: string | null;
    birthPlace: string;
    heightIn: number | null;
    heightCm: number | null;
    weightLb: number | null;
    weightKg: number | null;
    shoots: string | null;
    draft: { year: number; team: string; round: number; pick: number; overall: number } | null;
    seasons: SeasonLine[];
    career: SeasonLine | null;
    /** NHL playoff career totals (careerTotals.playoffs), null without playoff games. */
    careerPlayoffs: SeasonLine | null;
    awards: { name: string; seasons: number[] }[];
}

type Raw = Record<string, unknown> & {
    firstName?: L;
    lastName?: L;
    seasonTotals?: Record<string, unknown>[];
    careerTotals?: { regularSeason?: Record<string, unknown>; playoffs?: Record<string, unknown> };
    draftDetails?: Record<string, unknown>;
    awards?: { trophy?: L; seasons?: { seasonId: number }[] }[];
    birthCity?: L;
    birthStateProvince?: L;
};

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function line(r: Record<string, unknown>, goalie: boolean): SeasonLine {
    const base: SeasonLine = {
        season: Number(r.season ?? 0),
        league: String(r.leagueAbbrev ?? 'NHL'),
        team: t(r.teamName as L) || t(r.teamCommonName as L),
        gameType: Number(r.gameTypeId ?? 2),
        seq: num(r.sequence) ?? 0,
        gp: num(r.gamesPlayed) ?? 0,
    };
    if (goalie) {
        return { ...base, w: num(r.wins), l: num(r.losses), otl: num(r.otLosses), gaa: num(r.goalsAgainstAvg) ?? null, svPct: num(r.savePctg) ?? null, so: num(r.shutouts) };
    }
    return {
        ...base,
        g: num(r.goals),
        a: num(r.assists),
        p: num(r.points),
        pm: num(r.plusMinus),
        pim: num(r.pim),
        ppg: num(r.powerPlayGoals),
        shots: num(r.shots),
        shPct: num(r.shootingPctg) ?? null,
        toi: typeof r.avgToi === 'string' ? r.avgToi : null,
    };
}

export async function playerProfile(id: number): Promise<Profile | null> {
    let d: Raw | null = null;
    try {
        const res = await fetch(`https://api-web.nhle.com/v1/player/${id}/landing`, {
            next: { revalidate: 21_600 },
            headers: { 'User-Agent': 'pony-xg (player page)' },
            signal: AbortSignal.timeout(8000),
        });
        d = res.ok ? ((await res.json()) as Raw) : null;
    } catch {
        d = null;
    }
    if (!d || !d.playerId) return null;
    const goalie = d.position === 'G';
    const draft = d.draftDetails
        ? {
              year: Number(d.draftDetails.year),
              team: String(d.draftDetails.teamAbbrev ?? ''),
              round: Number(d.draftDetails.round),
              pick: Number(d.draftDetails.pickInRound),
              overall: Number(d.draftDetails.overallPick),
          }
        : null;
    const career = d.careerTotals?.regularSeason ? { ...line(d.careerTotals.regularSeason, goalie), season: 0, league: 'NHL', team: 'Career' } : null;
    const careerPlayoffs = d.careerTotals?.playoffs && num(d.careerTotals.playoffs.gamesPlayed) ? { ...line(d.careerTotals.playoffs, goalie), season: 0, league: 'NHL', team: 'Career', gameType: 3 } : null;
    for (const c of [career, careerPlayoffs]) if (c && !goalie && c.p == null && c.g != null && c.a != null) c.p = c.g + c.a;
    return {
        id: Number(d.playerId),
        first: t(d.firstName),
        last: t(d.lastName),
        pos: String(d.position ?? ''),
        goalie,
        num: num(d.sweaterNumber) ?? null,
        team: typeof d.currentTeamAbbrev === 'string' ? d.currentTeamAbbrev : null,
        teamName: t(d.fullTeamName as L) || null,
        active: Boolean(d.isActive),
        headshot: typeof d.headshot === 'string' ? d.headshot : null,
        hero: typeof d.heroImage === 'string' ? d.heroImage : null,
        birthDate: typeof d.birthDate === 'string' ? d.birthDate : null,
        birthPlace: [t(d.birthCity), t(d.birthStateProvince), typeof d.birthCountry === 'string' ? d.birthCountry : ''].filter(Boolean).join(', '),
        heightIn: num(d.heightInInches) ?? null,
        heightCm: num(d.heightInCentimeters) ?? null,
        weightLb: num(d.weightInPounds) ?? null,
        weightKg: num(d.weightInKilograms) ?? null,
        shoots: typeof d.shootsCatches === 'string' ? d.shootsCatches : null,
        draft,
        seasons: (d.seasonTotals ?? []).map(r => line(r, goalie)),
        career,
        careerPlayoffs,
        awards: (d.awards ?? []).map(a => ({ name: t(a.trophy), seasons: (a.seasons ?? []).map(s => s.seasonId) })),
    };
}

/** Age in whole years on a date. */
export function ageOn(birth: string | null, on = new Date()): number | null {
    if (!birth) return null;
    const b = new Date(`${birth}T00:00:00Z`);
    let age = on.getUTCFullYear() - b.getUTCFullYear();
    const m = on.getUTCMonth() - b.getUTCMonth();
    if (m < 0 || (m === 0 && on.getUTCDate() < b.getUTCDate())) age--;
    return age;
}
