import type { Metadata } from 'next';
import { cache } from 'react';
import { getImplications, getPlayoffOdds, getPlayoffSeries, getPredictions } from '@/utils/data';
import PredictionsViewer from '@/components/PredictionsViewer';
import { defaultDate } from '@/lib/matchup/lifecycle';
import { compactForClient } from '@/lib/matchup/parse';
import { addDays, easternDate } from '@/lib/matchup/format';
import { validDate, isFinalState, slateTitle, type ArchiveSlate } from '@/lib/matchup/archive';
import { getArchiveSlate } from '@/lib/matchup/archive-server';

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

async function slateDates(): Promise<string[]> {
    const predictions = await loadPredictions();
    return [...new Set(predictions.map(p => p.date))].sort();
}

/** Dated title that follows ?date=, e.g. "NHL predictions for Thu, Oct 1 | Pony xG". */
export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
    const today = easternDate();
    const date = requested(await searchParams, today) ?? defaultDate(await slateDates(), today) ?? today;
    return { title: { absolute: slateTitle(date, today) } };
}

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
    const sp = await searchParams;
    const predictions = await loadPredictions();
    const today = easternDate();
    const dates = [...new Set(predictions.map(p => p.date))].sort();
    const asked = requested(sp, today);
    const initialDate = asked ?? defaultDate(dates, today);
    const yesterday = addDays(today, -1);

    const teams = [...new Set(predictions.flatMap(p => [p.home.team.triCode, p.away.team.triCode]))];
    const [allOdds, implications, series, archive, yArchive] = await Promise.all([
        getPlayoffOdds(),
        getImplications(),
        getPlayoffSeries(predictions),
        initialDate && !dates.includes(initialDate) ? getArchiveSlate(initialDate, today) : Promise.resolve<ArchiveSlate | null>(null),
        // The Yesterday chip: only while yesterday has finals and isn't already a slate day.
        dates.includes(yesterday) || initialDate === yesterday ? Promise.resolve<ArchiveSlate | null>(null) : getArchiveSlate(yesterday, today),
    ]);
    const playoffOdds = Object.fromEntries(teams.filter(t => allOdds[t] != null).map(t => [t, allOdds[t]]));

    const extraDays: { date: string; count: number }[] = [];
    const ySlate = initialDate === yesterday ? archive : yArchive;
    const yFinals = ySlate?.games.filter(g => isFinalState(g.state)).length ?? 0;
    if (yFinals && !dates.includes(yesterday)) extraDays.push({ date: yesterday, count: ySlate!.games.length });
    if (archive && initialDate && initialDate !== yesterday) extraDays.push({ date: initialDate, count: archive.games.length });

    return (
        <main className="page pb-tabbar pt-4 md:pb-12 md:pt-7 [&>*]:max-w-[1192px]">
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
            />
        </main>
    );
}
