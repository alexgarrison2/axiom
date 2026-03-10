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
        let isActive = true;

        const fetchData = async () => {
            setLoading(true);
            setError(null);
            try {
                const res = await fetch(`/api/teams/${teamAbbr}/stats`, { signal: controller.signal });
                if (!res.ok) {
                    throw new Error('Failed to fetch team data');
                }
                const jsonData = await res.json();
                if (!isActive) return;
                setData(jsonData);
            } catch (err) {
                if (!isActive) return;
                if ((err as Error).name === 'AbortError') {
                    setError('Request timed out. Please try again.');
                } else {
                    setError((err as Error).message);
                }
            } finally {
                clearTimeout(timeoutId);
                if (isActive) {
                    setLoading(false);
                }
            }
        };

        fetchData();

        return () => {
            isActive = false;
            clearTimeout(timeoutId);
            controller.abort();
        };
    }, [teamAbbr]);

    return { data, loading, error };
}
