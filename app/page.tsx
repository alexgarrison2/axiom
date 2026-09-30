import type { Metadata } from 'next';
import { getImplications, getPickSummaries, getPlayoffOdds, getPlayoffSeries, getPredictions } from '@/utils/data';
import PredictionsViewer from '@/components/PredictionsViewer';
import { defaultDate } from '@/lib/matchup/lifecycle';
import { homeTitle } from '@/components/ui/slate-date';
import { easternDate } from '@/lib/matchup/format';

// Static, regenerated at most hourly (every data run also redeploys). Live
// scores come from /api/scores in the browser; ?date= is read client-side.
export const revalidate = 3600;

/** Dated title, e.g. "NHL predictions for Wed, Sep 30 | Pony xG" (set by the design-system shell). */
export function generateMetadata(): Metadata {
    return { title: { absolute: homeTitle() } };
}

export default async function Home() {
    const predictions = await getPredictions();
    const teams = [...new Set(predictions.flatMap(p => [p.home.team.triCode, p.away.team.triCode]))];
    const [picks, allOdds, implications, series] = await Promise.all([getPickSummaries(teams), getPlayoffOdds(), getImplications(), getPlayoffSeries(predictions)]);
    const playoffOdds = Object.fromEntries(teams.filter(t => allOdds[t] != null).map(t => [t, allOdds[t]]));
    const today = easternDate();
    const dates = [...new Set(predictions.map(p => p.date))].sort();

    return (
        <main className="mx-auto w-full max-w-[1400px] px-4 pb-tabbar pt-3 md:px-6 md:pb-10 md:pt-4">
            <PredictionsViewer
                predictions={predictions}
                picks={picks}
                implications={implications}
                playoffOdds={playoffOdds}
                today={today}
                initialDate={defaultDate(dates, today)}
                series={series}
            />
        </main>
    );
}
