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
