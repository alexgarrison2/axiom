/**
 * Reading the NHL feed's period clock. Around a period change the feed can
 * carry the break's countdown in the clock field without flagging an
 * intermission (seen live: "P2 20:11"). A clock longer than the period means
 * that period hasn't started, so it's the break after the one before (or,
 * before the 1st, a period not yet under way).
 */

/** Seconds in an "MM:SS" clock, or null when it isn't one. */
export function clockSeconds(s: string | null | undefined): number | null {
    const m = /^(\d{1,2}):(\d{2})$/.exec(s?.trim() ?? '');
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export interface PeriodClock {
    /** The period the game is in, or just finished when `intermission`. */
    period: number;
    intermission: boolean;
    /** Seconds left in `period` (null when unknown or in an intermission). */
    seconds: number | null;
}

export function readClock(period: number, clock: string | null | undefined, intermission: boolean, periodLength: number): PeriodClock {
    const seconds = clockSeconds(clock);
    if (intermission) return { period, intermission: true, seconds: null };
    if (seconds != null && seconds > periodLength) {
        return period > 1 ? { period: period - 1, intermission: true, seconds: null } : { period, intermission: false, seconds: periodLength };
    }
    return { period, intermission: false, seconds };
}

/** Overtime length: 20 minutes in the playoffs (game type 03 in the id), 5 in the regular season. */
export function otLengthOf(gameId: string | number): number {
    return String(gameId).slice(4, 6) === '03' ? 1200 : 300;
}

export const periodLength = (period: number, otLength: number) => (period <= 3 ? 1200 : otLength);

/** "5:07" from 307. */
export const formatClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
