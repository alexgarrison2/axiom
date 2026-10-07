import type { ComparedKey, LeagueStat, TeamSchedule } from './metrics';

/** What /api/teams/[tri]/schedule/[season] serves to the Schedule tab. */
export interface SchedulePayload {
    season: string;
    tri: string;
    /** Build date (ET), to mark today on the strip. */
    today: string;
    /** Every game final. */
    complete: boolean;
    /** Where opponent strength came from: this season's team ratings, or the finished season's results. */
    strength: 'ratings' | 'season';
    schedule: TeamSchedule;
    league: Record<ComparedKey, LeagueStat>;
    /** Season simulator's 10th-90th percentile of final points (current season). */
    seasonRange?: [number, number] | null;
}

export const scheduleUrl = (tri: string, season: string) => `/api/teams/${tri}/schedule/${season}`;
