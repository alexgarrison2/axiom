import { useState, useEffect } from 'react';
import { TeamStatsResponse } from '@/types';

export function useTeamData(teamAbbr: string) {
    const [data, setData] = useState<TeamStatsResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!teamAbbr) return;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        const fetchData = async () => {
            setLoading(true);
            setError(null);
            try {
                const res = await fetch(`/api/teams/${teamAbbr}/stats`, { signal: controller.signal });
                if (!res.ok) {
                    throw new Error('Failed to fetch team data');
                }
                const jsonData = await res.json();
                setData(jsonData);
            } catch (err) {
                if ((err as Error).name === 'AbortError') {
                    setError('Request timed out. Please try again.');
                } else {
                    setError((err as Error).message);
                }
            } finally {
                clearTimeout(timeoutId);
                setLoading(false);
            }
        };

        fetchData();
    }, [teamAbbr]);

    return { data, loading, error };
}
