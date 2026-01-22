import { useState, useEffect } from 'react';
import { TeamStatsResponse } from '@/types';

export function useTeamData(teamAbbr: string) {
    const [data, setData] = useState<TeamStatsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!teamAbbr) return;

        const fetchData = async () => {
            setLoading(true);
            try {
                const res = await fetch(`/api/teams/${teamAbbr}/stats`);
                if (!res.ok) {
                    throw new Error('Failed to fetch team data');
                }
                const jsonData = await res.json();
                setData(jsonData);
            } catch (err) {
                setError((err as Error).message);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [teamAbbr]);

    return { data, loading, error };
}
