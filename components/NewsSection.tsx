'use client';

import * as React from 'react';
import type { GamePrediction } from '@/utils/data';
import { NewsFeed } from './news/NewsFeed';
import { toFeedGroups } from './news/feed';
import type { RawNewsItem } from './news/model';

/**
 * Legacy home-tab adapter: the /news page renders <NewsFeed> directly. This
 * builds the same grouped feed from the news attached to the slate's
 * predictions, so both views look and behave the same.
 */
export default function NewsSection({ predictions }: { predictions: GamePrediction[] }) {
    const groups = React.useMemo(() => {
        const byTeam: Record<string, RawNewsItem[]> = {};
        for (const p of predictions) {
            for (const [tri, items] of [
                [p.homeTeam?.triCode, p.home_news],
                [p.awayTeam?.triCode, p.away_news],
            ] as const) {
                if (!tri || !items) continue;
                byTeam[tri] = [...(byTeam[tri] ?? []), ...items];
            }
        }
        const games = predictions
            .filter(p => p.homeTeam?.triCode && p.awayTeam?.triCode)
            .map(p => ({ id: p.id, home: p.homeTeam.triCode, away: p.awayTeam.triCode, startUtc: null }));
        return toFeedGroups(byTeam, games);
    }, [predictions]);
    return <NewsFeed groups={groups} dayLabel={null} />;
}
