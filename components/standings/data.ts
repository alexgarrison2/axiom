import 'server-only';
import { SEASON_ID } from '@/lib/season';
import { readPublicJson } from '@/components/views/read-data';
import { TEAM_CODES, TEAM_NAMES } from '@/components/ui/team-color';
import {
    CONFERENCE_OF_DIVISION,
    DIVISION_OF,
    parseProjectionHistory,
    parseProjections,
    strengthFromRatings,
    trendFor,
    type Division,
    type StandingsRow,
    type TeamStrength,
} from './model';

export interface StandingsPageData {
    rows: StandingsRow[];
    /** Projections exist and belong to the current season. */
    projectionsCurrent: boolean;
    projectionsSeason: string | null;
    projectionsAt: string | null;
    totalSims: number;
    /** Where the W-L-OTL came from. */
    standingsSource: 'nhl' | 'none';
    standingsAt: string | null;
    minGp: number;
    strengths: Record<string, TeamStrength>;
}

const readJson = readPublicJson;

interface NhlStandingsTeam {
    teamAbbrev?: { default?: string };
    gamesPlayed?: number;
    wins?: number;
    losses?: number;
    otLosses?: number;
    points?: number;
    regulationWins?: number;
    regulationPlusOtWins?: number;
    goalDifferential?: number;
    goalFor?: number;
    divisionName?: string;
    seasonId?: number;
    gameTypeId?: number;
}

const DIVISION_NAMES: Record<string, Division> = {
    Atlantic: 'Atlantic',
    Metropolitan: 'Metropolitan',
    Metro: 'Metropolitan',
    Central: 'Central',
    Pacific: 'Pacific',
};

/**
 * Live standings from the NHL (cached by the Data Cache for 30 min, so the
 * page stays static between revalidations). Returns null on any failure;
 * the page then shows 0-0-0 and says so. Ignores a response from another
 * season (the /now endpoints lag around opening night).
 */
async function fetchNhlStandings(): Promise<{ teams: NhlStandingsTeam[]; at: string | null } | null> {
    try {
        const res = await fetch('https://api-web.nhle.com/v1/standings/now', {
            next: { revalidate: 1800 },
            signal: AbortSignal.timeout(8000),
            headers: { 'User-Agent': 'pony-xg (standings page)' },
        });
        if (!res.ok) return null;
        const body = (await res.json()) as { standings?: NhlStandingsTeam[]; standingsDateTimeUtc?: string };
        const teams = (body.standings ?? []).filter(t => !t.seasonId || String(t.seasonId) === SEASON_ID);
        if (!teams.length) return null;
        return { teams, at: body.standingsDateTimeUtc ?? null };
    } catch {
        return null;
    }
}

export async function loadStandingsPage(): Promise<StandingsPageData> {
    const projections = parseProjections(readJson('season_projections.json'));
    const projectionsCurrent = projections.seasonId === SEASON_ID && Object.keys(projections.byTeam).length > 0;
    const history = projectionsCurrent ? parseProjectionHistory(readJson('season_projections_history.json'), SEASON_ID) : {};
    const ratings = (readJson('team_ratings.json') ?? {}) as Record<string, Record<string, unknown>>;
    const nhl = await fetchNhlStandings();

    const byTri = new Map<string, NhlStandingsTeam>();
    for (const t of nhl?.teams ?? []) if (t.teamAbbrev?.default) byTri.set(t.teamAbbrev.default, t);

    const rows: StandingsRow[] = TEAM_CODES.map(tri => {
        const live = byTri.get(tri);
        const division = (live?.divisionName && DIVISION_NAMES[live.divisionName]) || DIVISION_OF[tri];
        const proj = projectionsCurrent ? projections.byTeam[tri] ?? null : null;
        const { delta24, trend } = trendFor(history[tri], proj?.playoffPct);
        return {
            tri,
            name: TEAM_NAMES[tri]?.name ?? tri,
            short: TEAM_NAMES[tri]?.short ?? tri,
            conference: CONFERENCE_OF_DIVISION[division],
            division,
            gp: live?.gamesPlayed ?? 0,
            w: live?.wins ?? 0,
            l: live?.losses ?? 0,
            otl: live?.otLosses ?? 0,
            pts: live?.points ?? 0,
            rw: live?.regulationWins ?? 0,
            row: live?.regulationPlusOtWins ?? 0,
            gd: live?.goalDifferential ?? 0,
            gf: live?.goalFor ?? 0,
            proj,
            delta24: proj ? delta24 : null,
            trend: proj ? trend : [],
        };
    });

    const strengths: Record<string, TeamStrength> = {};
    for (const tri of TEAM_CODES) strengths[tri] = strengthFromRatings(ratings[TEAM_NAMES[tri]?.short ?? '']);

    return {
        rows,
        projectionsCurrent,
        projectionsSeason: projections.seasonId,
        projectionsAt: projections.generatedAt,
        totalSims: projections.totalSims,
        standingsSource: nhl ? 'nhl' : 'none',
        standingsAt: nhl?.at ?? null,
        minGp: rows.reduce((m, r) => Math.min(m, r.gp), Infinity),
        strengths,
    };
}
