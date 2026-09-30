'use client';

import type { PickSummaries, Prediction } from '@/types/prediction';
import type { GameImplication } from '@/utils/implications';
import type { Phase } from '@/lib/matchup/lifecycle';
import { pickForm } from '@/lib/matchup/edge';
import { priorSeriesNote } from '@/lib/matchup/pills';
import RecentGamesList from '@/components/RecentGamesList';
import PlayerNewsList from '@/components/PlayerNewsList';
import { WhyThisPick } from './WhyThisPick';
import { DetailsLoading, type DetailsState } from './DetailsLoading';
import { cn } from '@/lib/utils';

function PickForm({ label, entries }: { label: string; entries: boolean[] }) {
    const f = pickForm(entries);
    return (
        <div className="flex items-center justify-between gap-2 text-caption">
            <span className="text-fg-2">{label}</span>
            {entries.length ? (
                <span className="flex items-center gap-1.5 tabular-nums">
                    <span aria-hidden="true" className="flex gap-0.5">
                        {entries.map((ok, i) => (
                            <span key={i} className={cn('h-1.5 w-1.5 rounded-full', ok ? 'bg-pos' : 'bg-neg')} />
                        ))}
                    </span>
                    <span className="font-semibold text-fg-1">
                        {f.w}–{f.l}
                    </span>
                    {f.pct != null ? <span className="text-fg-2">{f.pct}%</span> : null}
                </span>
            ) : (
                <span className="text-fg-3">No picks yet</span>
            )}
        </div>
    );
}

function Implications({ p, imp }: { p: Prediction; imp: GameImplication }) {
    const rows = [
        { t: p.away.team, base: imp.away_current_playoff_pct, win: imp.scenarios.away_reg_win.away_playoff_pct, lose: imp.scenarios.home_reg_win.away_playoff_pct },
        { t: p.home.team, base: imp.home_current_playoff_pct, win: imp.scenarios.home_reg_win.home_playoff_pct, lose: imp.scenarios.away_reg_win.home_playoff_pct },
    ].filter(r => r.base != null && r.win != null && r.lose != null && r.base > 1 && r.base < 99);
    if (!rows.length) return null;
    return (
        <section aria-label="Playoff odds at stake" className="flex flex-col gap-1.5">
            <h3 className="hud-label">Playoff odds at stake</h3>
            {rows.map(r => (
                <p key={r.t.triCode} className="text-body-sm tabular-nums text-fg-1">
                    <span className="font-bold">{r.t.triCode}</span> {r.base!.toFixed(0)}% →{' '}
                    <span className="text-pos">{r.win!.toFixed(0)}% W</span> / <span className="text-neg">{r.lose!.toFixed(0)}% L</span>
                </p>
            ))}
        </section>
    );
}

/** First tab: why the model leans the way it does, then recent form and the pick record. */
export function PreviewPanel({ p, phase, state, implication }: { p: Prediction; phase: Phase; state: DetailsState; implication: GameImplication | null; playoffOdds: Record<string, number> }) {
    const prior = priorSeriesNote(p);
    const sides = [p.away, p.home];
    const anyPicksIn = (picks: PickSummaries) => sides.some(s => (picks[s.team.triCode]?.pickedWin.length ?? 0) + (picks[s.team.triCode]?.pickedLose.length ?? 0) > 0);
    return (
        <div className="flex flex-col gap-4 py-1">
            {p.breakdown.length ? <WhyThisPick p={p} /> : phase === 'pre' ? <p className="text-body-sm text-fg-2">No model breakdown for this game.</p> : null}
            {prior ? <p className="text-caption text-fg-2">{prior}</p> : null}
            {implication ? <Implications p={p} imp={implication} /> : null}

            <DetailsLoading state={state}>
                {d => (
                    <div className="flex flex-col gap-4">
                        <div className="grid grid-cols-1 gap-4 cq-sm:grid-cols-2">
                            <RecentGamesList team={p.away.team} gp={p.away.gp} games={d.away.recent} starter={p.away.goalie} />
                            <RecentGamesList team={p.home.team} gp={p.home.gp} games={d.home.recent} starter={p.home.goalie} />
                        </div>
                        {anyPicksIn(d.picks) ? (
                            <section aria-label="Model pick record this season" className="flex flex-col gap-2">
                                <h3 className="hud-label">Our picks this season</h3>
                                <div className="grid grid-cols-1 gap-3 cq-sm:grid-cols-2">
                                    {sides.map(s => (
                                        <div key={s.team.triCode} className="flex flex-col gap-1 rounded-control border border-line px-3 py-2">
                                            <span className="text-caption font-bold text-fg-1">{s.team.triCode}</span>
                                            <PickForm label="Picked to win" entries={d.picks[s.team.triCode]?.pickedWin ?? []} />
                                            <PickForm label="Picked to lose" entries={d.picks[s.team.triCode]?.pickedLose ?? []} />
                                        </div>
                                    ))}
                                </div>
                            </section>
                        ) : null}
                        {d.away.news.length || d.home.news.length ? (
                            <details className="group rounded-control border border-line px-3 py-2">
                                <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between text-caption font-semibold text-fg-1 coarse:min-h-11">
                                    Player news
                                    <span className="text-fg-3 group-open:rotate-180">▾</span>
                                </summary>
                                <div className="mt-2 grid grid-cols-1 gap-3 cq-sm:grid-cols-2">
                                    <PlayerNewsList news={d.away.news} teamTriCode={p.away.team.triCode} />
                                    <PlayerNewsList news={d.home.news} teamTriCode={p.home.team.triCode} />
                                </div>
                            </details>
                        ) : null}
                        <p className="flex flex-wrap gap-x-4 gap-y-1 text-caption">
                            <a href={`/teams/${p.away.team.triCode}`} className="font-semibold text-brand hover:underline">
                                {p.away.team.commonName} team page →
                            </a>
                            <a href={`/teams/${p.home.team.triCode}`} className="font-semibold text-brand hover:underline">
                                {p.home.team.commonName} team page →
                            </a>
                        </p>
                    </div>
                )}
            </DetailsLoading>
        </div>
    );
}

export default PreviewPanel;
