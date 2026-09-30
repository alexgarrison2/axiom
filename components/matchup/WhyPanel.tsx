'use client';

import type { PickSummaries, Prediction } from '@/types/prediction';
import type { GameImplication } from '@/utils/implications';
import type { Phase } from '@/lib/matchup/lifecycle';
import { modelWeight, pickForm } from '@/lib/matchup/edge';
import RecentGamesList from '@/components/RecentGamesList';
import { WhyThisPick } from './WhyThisPick';
import { ContextChips } from './ContextChips';
import { DetailsLoading, type DetailsState } from './DetailsLoading';
import { cn } from '@/lib/utils';

/** Dense stat tile: label, Chakra value, tiny sub. */
function Tile({ label, value, sub, empty }: { label: string; value: string; sub?: string; empty?: boolean }) {
    return (
        <div className="tile flex min-w-0 flex-col gap-0.5 px-2.5 py-2 cq-sm:px-3">
            <span className="label truncate">{label}</span>
            <span className={cn('truncate font-display text-[17px] font-bold leading-6 tabular-nums cq-sm:text-[22px]', empty ? 'text-fg-3' : 'text-fg-1')}>{value}</span>
            {sub ? <span className="truncate text-micro tracking-wide text-fg-3">{sub}</span> : null}
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

/** The Why tab: rest / projected goals / confidence tiles, the why-bars, context chips, stakes, recent form, pick record. */
export function WhyPanel({ p, phase, state, implication }: { p: Prediction; phase: Phase; state: DetailsState; implication: GameImplication | null }) {
    const a = p.away;
    const h = p.home;
    const sides = [a, h];
    const w = modelWeight(p);
    const anyPicksIn = (picks: PickSummaries) => sides.some(s => (picks[s.team.triCode]?.pickedWin.length ?? 0) + (picks[s.team.triCode]?.pickedLose.length ?? 0) > 0);
    const rest = (d: number | null) => (d == null ? '—' : `${d}d`);
    return (
        <div className="flex flex-col gap-3.5">
            <div className="grid grid-cols-3 gap-2">
                <Tile label="Rest" value={`${rest(a.restDays)} · ${rest(h.restDays)}`} sub={`${a.team.triCode} · ${h.team.triCode}`} empty={a.restDays == null && h.restDays == null} />
                <Tile
                    label="Proj G"
                    value={a.xg != null && h.xg != null ? `${a.xg.toFixed(1)} · ${h.xg.toFixed(1)}` : '—'}
                    sub={`${a.team.triCode} · ${h.team.triCode}`}
                    empty={a.xg == null || h.xg == null}
                />
                <Tile
                    label={p.confidenceGrade ? 'Conf' : 'Model wt'}
                    value={p.confidenceGrade ?? (w != null ? `${Math.round(w * 100)}%` : '—')}
                    sub={p.confidenceGrade && w != null && w < 0.999 ? `Model wt ${Math.round(w * 100)}%` : undefined}
                    empty={!p.confidenceGrade && w == null}
                />
            </div>

            {p.breakdown.length ? <WhyThisPick p={p} /> : phase === 'pre' ? <p className="label">No breakdown</p> : null}
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
                            <section aria-label="Model pick record this season" className="flex flex-col gap-1">
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
