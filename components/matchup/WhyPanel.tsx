'use client';

import type { PickSummaries, Prediction, SideData } from '@/types/prediction';
import type { GameImplication } from '@/utils/implications';
import type { Phase } from '@/lib/matchup/lifecycle';
import { modelWeight, pickForm } from '@/lib/matchup/edge';
import RecentGamesList from '@/components/RecentGamesList';
import { WhyThisPick } from './WhyThisPick';
import { ContextChips } from './ContextChips';
import { termHref } from '@/lib/matchup/glossary-links';
import { DetailsLoading, type DetailsState } from './DetailsLoading';
import { cn } from '@/lib/utils';

const CONF_WORD: Record<string, string> = { A: 'High', B: 'Medium', C: 'Low' };

/** Rest before tonight in words: "B2B", "1 day", "3 days". */
function restWords(s: SideData): string {
    if (s.isB2b) return 'B2B';
    if (s.restDays == null) return '—';
    return `${s.restDays} day${s.restDays === 1 ? '' : 's'}`;
}

/** A team-aligned fact row: away value · label · home value (same layout as the card). */
function Fact({ label, away, home, term }: { label: string; away: React.ReactNode; home: React.ReactNode; term?: string }) {
    const href = term ? termHref(term) : null;
    return (
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-baseline gap-2 border-t border-line py-1.5 text-caption first:border-t-0">
            <span className="font-bold tabular-nums text-fg-1">{away}</span>
            {href ? (
                <a href={href} className="text-micro font-medium uppercase tracking-wide text-fg-3 underline decoration-dotted underline-offset-4 hover:text-fg-1">
                    {label}
                </a>
            ) : (
                <span className="text-micro font-medium uppercase tracking-wide text-fg-3">{label}</span>
            )}
            <span className="text-right font-bold tabular-nums text-fg-1">{home}</span>
        </div>
    );
}

function Dots({ entries }: { entries: boolean[] }) {
    const f = pickForm(entries);
    if (!entries.length) return <span className="text-fg-3">—</span>;
    return (
        <span className="inline-flex items-center gap-1.5 tabular-nums">
            <span aria-hidden="true" className="flex gap-0.5">
                {entries.map((ok, i) => (
                    <span key={i} className={cn('h-1.5 w-1.5 rounded-full', ok ? 'bg-pos' : 'bg-neg')} />
                ))}
            </span>
            <span className="font-bold text-fg-1">
                {f.w}-{f.l}
            </span>
        </span>
    );
}

function Stakes({ p, imp }: { p: Prediction; imp: GameImplication }) {
    const rows = [
        { t: p.away.team, base: imp.away_current_playoff_pct, win: imp.scenarios.away_reg_win.away_playoff_pct, lose: imp.scenarios.home_reg_win.away_playoff_pct },
        { t: p.home.team, base: imp.home_current_playoff_pct, win: imp.scenarios.home_reg_win.home_playoff_pct, lose: imp.scenarios.away_reg_win.home_playoff_pct },
    ].filter(r => r.base != null && r.win != null && r.lose != null && r.base > 1 && r.base < 99);
    if (!rows.length) return null;
    return (
        <section aria-label="Playoff odds at stake" className="flex flex-col gap-1">
            <h3 className="label">Playoff odds</h3>
            {rows.map(r => (
                <p key={r.t.triCode} className="grid grid-cols-[3rem_auto_1fr] items-baseline gap-2 text-caption tabular-nums">
                    <span className="font-bold text-fg-1">{r.t.triCode}</span>
                    <span className="text-fg-2">{r.base!.toFixed(0)}%</span>
                    <span>
                        <span className="text-pos">W {r.win!.toFixed(0)}%</span> <span className="text-fg-3">·</span> <span className="text-neg">L {r.lose!.toFixed(0)}%</span>
                    </span>
                </p>
            ))}
        </section>
    );
}

/**
 * The Why tab, laid out like the card (away left, home right): the pick in one
 * sentence, what moved it (the why-bars), rest, confidence in words, context,
 * stakes, recent form and our pick record.
 */
export function WhyPanel({ p, phase, state, implication }: { p: Prediction; phase: Phase; state: DetailsState; implication: GameImplication | null }) {
    const a = p.away;
    const h = p.home;
    const sides = [a, h];
    const w = modelWeight(p);
    const anyPicksIn = (picks: PickSummaries) => sides.some(s => (picks[s.team.triCode]?.pickedWin.length ?? 0) + (picks[s.team.triCode]?.pickedLose.length ?? 0) > 0);
    const conf = p.confidenceGrade ? (CONF_WORD[p.confidenceGrade] ?? p.confidenceGrade) : null;
    const blend = w != null && w < 0.999 ? `Forecast = model ${Math.round(w * 100)}% + market ${100 - Math.round(w * 100)}%` : null;
    return (
        <div className="flex flex-col gap-3.5">
            {p.pickSummary ? <p className="text-caption text-fg-2">{p.pickSummary}</p> : null}

            {p.breakdown.length ? <WhyThisPick p={p} /> : phase === 'pre' ? <p className="label">No breakdown</p> : null}

            <section aria-label="Rest and confidence" className="flex flex-col">
                <Fact label="Rest" term="rest" away={restWords(a)} home={restWords(h)} />
                {conf ? (
                    <div className="flex flex-col gap-0.5 border-t border-line py-1.5">
                        <span className="flex items-baseline justify-between gap-2 text-caption">
                            <a href={termHref('conf') ?? undefined} className="text-micro font-medium uppercase tracking-wide text-fg-3 underline decoration-dotted underline-offset-4 hover:text-fg-1">
                                Confidence
                            </a>
                            <span className="font-bold text-fg-1">{conf}</span>
                        </span>
                        {p.confidenceNote ? <span className="text-micro text-fg-3">{p.confidenceNote}</span> : null}
                        {blend ? <span className="text-micro text-fg-3">{blend}</span> : null}
                    </div>
                ) : blend ? (
                    <p className="border-t border-line py-1.5 text-micro text-fg-3">{blend}</p>
                ) : null}
            </section>
            <ContextChips p={p} />
            {implication ? <Stakes p={p} imp={implication} /> : null}

            <DetailsLoading state={state}>
                {d => (
                    <div className="flex flex-col gap-3.5">
                        <div className="grid grid-cols-1 gap-3 cq-sm:grid-cols-2">
                            <RecentGamesList team={a.team} gp={a.gp} games={d.away.recent} starter={a.goalie} />
                            <RecentGamesList team={h.team} gp={h.gp} games={d.home.recent} starter={h.goalie} />
                        </div>
                        {anyPicksIn(d.picks) ? (
                            <section className="flex flex-col gap-1">
                                <h3 className="label">Our picks</h3>
                                <div className="grid grid-cols-[3rem_auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1 text-caption">
                                    {sides.map(s => (
                                        <div key={s.team.triCode} className="contents">
                                            <span className="font-bold text-fg-1">{s.team.triCode}</span>
                                            <span className="text-micro uppercase tracking-wide text-fg-3">To win</span>
                                            <Dots entries={d.picks[s.team.triCode]?.pickedWin ?? []} />
                                            <span className="text-micro uppercase tracking-wide text-fg-3">To lose</span>
                                            <Dots entries={d.picks[s.team.triCode]?.pickedLose ?? []} />
                                        </div>
                                    ))}
                                </div>
                            </section>
                        ) : null}
                    </div>
                )}
            </DetailsLoading>
        </div>
    );
}

export default WhyPanel;
