'use client';

import { useEffect, useState } from 'react';
import { SEASON_ID } from '@/lib/season';
import { fetchJsonCached, teamUrl } from '@/utils/team-stats/client-cache';
import type { TeamPayload } from '@/utils/team-stats/team-types';

/**
 * One team's season payload from the static team API, cached per session so
 * tab switches and route re-entry never refetch. Team pages get their current
 * season server-side and only call this for other seasons.
 */
export function useTeamData(teamAbbr: string, season: string = SEASON_ID) {
    const [state, setState] = useState<{ key: string; data: TeamPayload | null; error: string | null }>({ key: '', data: null, error: null });
    const key = `${teamAbbr}|${season}`;

    useEffect(() => {
        if (!teamAbbr) return;
        let live = true;
        fetchJsonCached<TeamPayload>(teamUrl(teamAbbr.toUpperCase(), season))
            .then(data => live && setState({ key, data, error: null }))
            .catch((e: Error) => live && setState({ key, data: null, error: e.message || 'Failed to load team data' }));
        return () => {
            live = false;
        };
    }, [teamAbbr, season, key]);

    const current = state.key === key;
    return { data: current ? state.data : null, loading: !current, error: current ? state.error : null };
}
