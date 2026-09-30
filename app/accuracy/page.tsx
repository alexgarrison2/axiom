import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeading } from '@/components/ui/page-heading';
import { SEASON_START_YEAR } from '@/lib/season';
import { loadLedger, loadReport } from '@/components/accuracy/data';
import { AccuracyView } from '@/components/accuracy/AccuracyView';

// Rebuilt with every data refresh (each pipeline commit redeploys).
export const revalidate = 3600;

const CURRENT = `${SEASON_START_YEAR}-${String(SEASON_START_YEAR + 1).slice(2)}`;

export const metadata: Metadata = {
    title: 'Accuracy & bet ledger',
    description:
        'How every pregame Pony xG pick has graded out: accuracy, Brier score and log loss next to the betting market and a home-team baseline, calibration, and a public bet ledger.',
    alternates: { canonical: '/accuracy' },
};

export default function AccuracyPage() {
    const report = loadReport();
    const ledger = loadLedger();
    const seasons = [...new Set([CURRENT, ...Object.keys(report.seasons), ...Object.keys(ledger.seasons)])]
        .filter(s => /^\d{4}-\d{2}$/.test(s))
        .sort()
        .reverse();

    return (
        <main className="pb-tabbar">
            <div className="mx-auto flex max-w-[1400px] flex-col gap-8 px-4 py-6 md:px-6 md:py-10">
                <PageHeading
                    eyebrow="Model record"
                    title="Accuracy"
                    description="Every pick we published before puck drop, graded against the final score and compared with the betting market and a simple home-team baseline. No back-filled results in the headline numbers."
                />
                <AccuracyView report={report} ledger={ledger} seasons={seasons} currentSeason={CURRENT} />
                <p className="text-caption text-fg-3">
                    How grading works: <Link href="/methodology#grading" className="font-semibold text-brand hover:underline">methodology</Link>.
                    {report.generatedAt ? ` Report built ${report.generatedAt.slice(0, 10)}.` : ''}
                </p>
            </div>
        </main>
    );
}
