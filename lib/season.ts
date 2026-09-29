// Current NHL season. Mirrors pipeline/season.py: rolls over on July 1
// (start of the NHL league year).
function seasonStartYear(today = new Date()): number {
    return today.getMonth() >= 6 ? today.getFullYear() : today.getFullYear() - 1;
}

export const SEASON_START_YEAR = seasonStartYear();
export const SEASON_ID = `${SEASON_START_YEAR}${SEASON_START_YEAR + 1}`; // "20262027"
// Before opening night; use as a ">=" cutoff for this season's dates.
export const SEASON_START_DATE = `${SEASON_START_YEAR}-09-01`;

export function seasonFile(kind: string, startYear = SEASON_START_YEAR): string {
    return `nhl_season_${startYear}_${startYear + 1}_${kind}.csv`;
}

// Regular-season length: 84 games from 2026-27 (2025 CBA), 82 before.
export const SEASON_GAMES = SEASON_START_YEAR >= 2026 ? 84 : 82;
