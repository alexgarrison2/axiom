import { useState, useEffect } from 'react';

// True while any series in playoff_series.json is scheduled or in progress. Drives the
// PLAYOFFS nav links so they only appear during the postseason.
export function usePlayoffsActive(): boolean {
    const [active, setActive] = useState(false);

    useEffect(() => {
        fetch('/data/playoff_series.json')
            .then(r => r.json())
            .then((series: { status?: string }[]) => setActive(series.some(s => s.status !== 'complete')))
            .catch(() => setActive(false));
    }, []);

    return active;
}
