/**
 * utils/implications.ts
 * ---------------------
 * Shared TypeScript types for game_implications.json.
 * Safe to import from both server and client components.
 *
 * Server-side data loading lives in utils/implications-server.ts.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScenarioResult {
    home_playoff_pct: number | null;
    away_playoff_pct: number | null;
    home_avg_pts:     number | null;
    away_avg_pts:     number | null;
}

export interface GameImplication {
    game_id:                   number;
    date:                      string;
    home_abbrev:               string;
    away_abbrev:               string;
    /** Baseline playoff % from the full season_simulator run */
    home_current_playoff_pct:  number | null;
    away_current_playoff_pct:  number | null;
    home_current_avg_pts:      number | null;
    away_current_avg_pts:      number | null;
    scenarios: {
        home_reg_win: ScenarioResult;
        home_otw:     ScenarioResult;
        away_otw:     ScenarioResult;
        away_reg_win: ScenarioResult;
    };
}

export interface GameImplicationsData {
    generated_at: string;
    games:        GameImplication[];
}

// ---------------------------------------------------------------------------
// Helper: look up implications for a specific game by team tricodes
// (safe on client — no Node.js APIs used)
// ---------------------------------------------------------------------------

export function findImplication(
    data:        GameImplicationsData | null | undefined,
    homeTriCode: string,
    awayTriCode: string,
): GameImplication | null {
    if (!data) return null;
    return (
        data.games.find(
            g => g.home_abbrev === homeTriCode && g.away_abbrev === awayTriCode
        ) ?? null
    );
}

// ---------------------------------------------------------------------------
// "Biggest games tonight": playoff-odds swing per game
// ---------------------------------------------------------------------------

export interface TeamSwing {
    tri: string;
    base: number;
    /** Playoff % after a regulation win / regulation loss. */
    win: number;
    lose: number;
    /** win − lose, in points. */
    swing: number;
}

export interface GameSwing {
    gameId: number;
    date: string;
    away: TeamSwing | null;
    home: TeamSwing | null;
    /** Sum of both teams' swings. */
    total: number;
}

/** Minimum swing (points) before the strip is worth showing. */
export const MIN_SWING_PTS = 3;

function teamSwing(tri: string, base: number | null, win: number | null, lose: number | null): TeamSwing | null {
    if (base == null || win == null || lose == null) return null;
    return { tri, base, win, lose, swing: Math.max(0, win - lose) };
}

export function gameSwing(g: GameImplication): GameSwing {
    const s = g.scenarios;
    const home = teamSwing(g.home_abbrev, g.home_current_playoff_pct, s.home_reg_win.home_playoff_pct, s.away_reg_win.home_playoff_pct);
    const away = teamSwing(g.away_abbrev, g.away_current_playoff_pct, s.away_reg_win.away_playoff_pct, s.home_reg_win.away_playoff_pct);
    return { gameId: g.game_id, date: g.date, away, home, total: (home?.swing ?? 0) + (away?.swing ?? 0) };
}

/**
 * Games on `date` sorted by total playoff-odds swing, or [] when no single
 * team's swing reaches MIN_SWING_PTS (e.g. every October).
 */
export function biggestGames(data: GameImplicationsData | null | undefined, date: string, limit = 3): GameSwing[] {
    if (!data?.games?.length) return [];
    const swings = data.games.filter(g => g.date === date).map(gameSwing);
    const maxTeam = Math.max(0, ...swings.flatMap(s => [s.home?.swing ?? 0, s.away?.swing ?? 0]));
    if (maxTeam < MIN_SWING_PTS) return [];
    return swings.filter(s => s.total > 0).sort((a, b) => b.total - a.total).slice(0, limit);
}
