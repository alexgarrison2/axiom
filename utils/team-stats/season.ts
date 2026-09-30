import { SEASON_ID, SEASON_START_YEAR } from '../../lib/season';

/** "20252026" → "2025-26". */
export function seasonLabel(seasonId: string): string {
    const y = parseInt(seasonId.slice(0, 4), 10);
    return `${y}-${String(y + 1).slice(2)}`;
}

/** "20262027" → "20252026". */
export function prevSeasonId(seasonId: string): string {
    const y = parseInt(seasonId.slice(0, 4), 10) - 1;
    return `${y}${y + 1}`;
}

export const CURRENT_SEASON_ID = SEASON_ID;
export const PREVIOUS_SEASON_ID = `${SEASON_START_YEAR - 1}${SEASON_START_YEAR}`;

/** Seasons offered by the season switcher (newest first). */
export const TEAM_SEASONS = [CURRENT_SEASON_ID, PREVIOUS_SEASON_ID] as const;

export function isTeamSeason(s: string | null | undefined): s is string {
    return !!s && (TEAM_SEASONS as readonly string[]).includes(s);
}

/** Regular-season length for a season id (84 from 2026-27, 82 before). */
export function seasonGames(seasonId: string): number {
    return parseInt(seasonId.slice(0, 4), 10) >= 2026 ? 84 : 82;
}

/** Game type from an NHL game id: 2025020001 → 2, 2025030111 → 3, else null. */
export function gameTypeOf(gameId: string | number): 2 | 3 | null {
    const t = String(gameId).slice(4, 6);
    return t === '02' ? 2 : t === '03' ? 3 : null;
}

/** 8-digit season id of a game id: 2025020001 → "20252026". */
export function seasonOfGameId(gameId: string | number): string {
    const y = parseInt(String(gameId).slice(0, 4), 10);
    return `${y}${y + 1}`;
}

/** Short tag, "20252026" → "25-26". */
export function shortSeason(seasonId: string): string {
    return `${seasonId.slice(2, 4)}-${seasonId.slice(6, 8)}`;
}
