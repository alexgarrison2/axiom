import type { Metadata } from 'next';
import { cache } from 'react';
import { getImplications, getPlayoffOdds, getPlayoffSeries, getPredictions } from '@/utils/data';
import PredictionsViewer from '@/components/PredictionsViewer';
import { homeDate } from '@/lib/matchup/lifecycle';
import { compactForClient } from '@/lib/matchup/parse';
import { addDays, slateDate } from '@/lib/matchup/format';
import { validDate, isFinalState, slateTitle, type ArchiveSlate } from '@/lib/matchup/archive';
import { getArchiveSlate } from '@/lib/matchup/archive-server';
import { trimGame } from '@/app/api/scores/route';
import type { LiveMap } from '@/lib/matchup/lifecycle';

/*
 * Rendered per request so /?date= paints the requested slate on the server
 * (no wrong-date flash, no layout shift). The heavy inputs are cached: the
 * CSV is a local read, the NHL feeds sit in the Data Cache.
 */

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** One CSV parse per request, shared by the metadata and the page. */
const loadPredictions = cache(getPredictions);

/**
 * ?date= must be a real day between the first season the NHL score feed
 * covers well and five years out: bounds the feed fetches (each day is one
 * cached fetch), anything else falls back to the default slate.
 */
const FIRST_DATE = '2005-10-01';

function requested(sp: Record<string, string | string[] | undefined>, today: string): string | null {
    const d = sp.date;
    const s = Array.isArray(d) ? d[0] : d;
    if (!validDate(s)) return null;
    return s >= FIRST_DATE && s <= addDays(today, 5 * 366) ? s : null;
}

/**
 * Scores for a slate that has started, so the first paint sorts and draws the cards as the
 * browser's first live update will (a game the file still calls live may be final): no
 * reorder or resize when the scores land. Same feed and cache as /api/scores; a slow or
 * failed feed just leaves it to the browser.
 */
async function startedScores(date: string | null, games: { id: string; date: string; startTimeUtc: string }[]): Promise<LiveMap | null> {
    if (!date) return null;
    const ids = new Set(games.filter(g => g.date === date).map(g => g.id));
    const now = Date.now();
    if (!games.some(g => g.date === date && Date.parse(g.startTimeUtc) <= now)) return null;
    try {
        const res = await fetch(`https://api-web.nhle.com/v1/score/${date}`, {
            next: { revalidate: 20 },
            signal: AbortSignal.timeout(1500),
            headers: { 'User-Agent': 'pony-xg (live scores)' },
        });
        if (!res.ok) return null;
        const body = (await res.json()) as { games?: Parameters<typeof trimGame>[0][] };
        const out: LiveMap = {};
        for (const g of body.games ?? []) {
            const t = trimGame(g);
            if (t && ids.has(t.id)) out[t.id] = t;
        }
        return Object.keys(out).length ? out : null;
    } catch {
        return null;
    }
}

async function slateDates(): Promise<string[]> {
    const predictions = await loadPredictions();
    return [...new Set(predictions.map(p => p.date))].sort();
}

/** Today's games from the score feed when the prediction file no longer (or not yet) has them. */
const offFileToday = cache(async (today: string, dates: string[]): Promise<ArchiveSlate | null> => {
    if (dates.includes(today)) return null;
    const slate = await getArchiveSlate(today, today);
    return slate.games.length ? slate : null;
});

/** Dated title that follows ?date=, e.g. "NHL predictions for Thu, Oct 1 | Pony xG". */
export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
    const today = slateDate();
    const dates = await slateDates();
    const asked = requested(await searchParams, today);
    const date = asked ?? homeDate(dates, today, (await offFileToday(today, dates))?.games.length ?? 0) ?? today;
    return { title: { absolute: slateTitle(date, today) } };
}

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
    const sp = await searchParams;
    const predictions = await loadPredictions();
    const today = slateDate();
    const dates = [...new Set(predictions.map(p => p.date))].sort();
    const asked = requested(sp, today);
    // Midnight to 3am ET: the night that just ended is off the file but still today's slate.
    const todaySlate = await offFileToday(today, dates);
    const initialDate = asked ?? homeDate(dates, today, todaySlate?.games.length ?? 0);
    const yesterday = addDays(today, -1);

    const teams = [...new Set(predictions.flatMap(p => [p.home.team.triCode, p.away.team.triCode]))];
    const [allOdds, implications, series, archive, yArchive, initialLive] = await Promise.all([
        getPlayoffOdds(),
        getImplications(),
        getPlayoffSeries(predictions),
        initialDate && !dates.includes(initialDate)
            ? initialDate === today && todaySlate
                ? Promise.resolve(todaySlate)
                : getArchiveSlate(initialDate, today)
            : Promise.resolve<ArchiveSlate | null>(null),
        // The Yesterday chip: only while yesterday has finals and isn't already a slate day.
        dates.includes(yesterday) || initialDate === yesterday ? Promise.resolve<ArchiveSlate | null>(null) : getArchiveSlate(yesterday, today),
        startedScores(initialDate, predictions),
    ]);
    const playoffOdds = Object.fromEntries(teams.filter(t => allOdds[t] != null).map(t => [t, allOdds[t]]));

    const extraDays: { date: string; count: number }[] = [];
    const ySlate = initialDate === yesterday ? archive : yArchive;
    const yFinals = ySlate?.games.filter(g => isFinalState(g.state)).length ?? 0;
    if (yFinals && !dates.includes(yesterday)) extraDays.push({ date: yesterday, count: ySlate!.games.length });
    // Today's chip while its games are off the file (the night that just ended, before 3am ET).
    if (todaySlate) extraDays.push({ date: today, count: todaySlate.games.length });
    if (archive && initialDate && initialDate !== yesterday && initialDate !== today) extraDays.push({ date: initialDate, count: archive.games.length });

    return (
        <main className="page pt-4 md:pb-12 md:pt-7 [&>*]:max-w-[1192px] xl:max-w-[1620px] xl:px-8 xl:[&>*]:max-w-none">
            <PredictionsViewer
                key={initialDate ?? 'none'}
                predictions={predictions.map(compactForClient)}
                implications={implications}
                playoffOdds={playoffOdds}
                today={today}
                initialDate={initialDate}
                explicitDate={asked != null}
                archive={archive}
                extraDays={extraDays}
                series={series}
                initialLive={initialLive}
            />
        </main>
    );
}
