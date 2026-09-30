import type { Prediction } from '@/types/prediction';
import { InfoTip } from '@/components/ui/info-tip';
import { clashSafePair } from '@/components/ui/team-color';
import { axisPos, waterfallFor } from '@/lib/matchup/waterfall';
import { cn } from '@/lib/utils';

const GRADE_TONE: Record<string, string> = {
    A: 'border-pos/40 bg-pos/10 text-pos',
    B: 'border-info/40 bg-info/10 text-info',
    C: 'border-line-strong bg-surface-2 text-fg-1',
};

/**
 * "Why this pick": a horizontal waterfall from a coin flip (50%) through
 * each factor to the published win %. Bars to the right push toward the
 * home team, to the left toward the away team.
 */
export function WhyThisPick({ p }: { p: Prediction }) {
    const w = waterfallFor(p);
    if (!w) return null;
    const a = p.away.team;
    const h = p.home.team;
    const colors = clashSafePair(a.triCode, h.triCode);
    const homeFinal = w.end;
    const fav = homeFinal >= 50 ? h : a;
    const favPct = homeFinal >= 50 ? homeFinal : 100 - homeFinal;
    const mid = axisPos(w, 50);

    return (
        <section aria-labelledby={`why-${p.id}`} className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id={`why-${p.id}`} className="text-body font-bold text-fg-1">
                    Why the {fav.commonName} are favored
                </h3>
                {p.confidenceGrade ? (
                    <span className="inline-flex items-center gap-0.5">
                        <span className={cn('inline-flex items-center gap-1 rounded-chip border px-2 py-0.5 text-caption font-bold', GRADE_TONE[p.confidenceGrade] ?? GRADE_TONE.C)}>
                            Confidence {p.confidenceGrade}
                        </span>
                        <InfoTip term="confidence" />
                    </span>
                ) : null}
            </div>
            {p.pickSummary ? <p className="text-body-sm text-fg-2">{p.pickSummary}</p> : null}

            <ol className="flex flex-col gap-1" aria-label={`From a coin flip to ${fav.triCode} ${favPct.toFixed(1)}%`}>
                <li className="grid grid-cols-[6.5rem_minmax(0,1fr)_3.25rem] items-center gap-2 text-caption">
                    <span className="text-fg-2">Coin flip</span>
                    <span aria-hidden="true" className="relative h-4">
                        <span className="absolute inset-y-0 border-l border-dashed border-fg-3" style={{ left: `${mid}%` }} />
                    </span>
                    <span className="text-right font-semibold tabular-nums text-fg-2">50%</span>
                </li>
                {w.steps.map(s => {
                    const lo = axisPos(w, Math.min(s.from, s.to));
                    const hi = axisPos(w, Math.max(s.from, s.to));
                    const toward = s.delta >= 0 ? h : a;
                    const color = s.delta >= 0 ? colors.home : colors.away;
                    const tiny = Math.abs(s.delta) < 0.05;
                    return (
                        <li key={s.factor} className="grid grid-cols-[6.5rem_minmax(0,1fr)_3.25rem] items-center gap-2 text-caption">
                            <span className="truncate text-fg-1">{s.label}</span>
                            <span aria-hidden="true" className="relative h-4">
                                <span className="absolute inset-y-0 border-l border-dashed border-fg-3/60" style={{ left: `${mid}%` }} />
                                <span
                                    className="absolute inset-y-0.5 rounded-sm"
                                    style={{ left: `${lo}%`, width: `${Math.max(hi - lo, tiny ? 0 : 0.8)}%`, backgroundColor: color }}
                                />
                            </span>
                            <span className="text-right font-semibold tabular-nums text-fg-1">
                                {tiny ? '0.0' : `${s.delta > 0 ? '+' : '−'}${Math.abs(s.delta).toFixed(1)}`}
                                <span className="sr-only"> points toward {toward.commonName}</span>
                            </span>
                        </li>
                    );
                })}
                <li className="mt-0.5 grid grid-cols-[6.5rem_minmax(0,1fr)_3.25rem] items-center gap-2 border-t border-line pt-1.5 text-caption">
                    <span className="font-bold text-fg-1">Our forecast</span>
                    <span aria-hidden="true" className="relative h-5">
                        <span
                            className="absolute inset-y-0 rounded-sm"
                            style={{
                                left: `${Math.min(mid, axisPos(w, homeFinal))}%`,
                                width: `${Math.abs(axisPos(w, homeFinal) - mid)}%`,
                                backgroundColor: homeFinal >= 50 ? colors.home : colors.away,
                            }}
                        />
                        <span className="absolute inset-y-[-2px] w-0.5 rounded bg-fg-1" style={{ left: `${axisPos(w, homeFinal)}%` }} />
                    </span>
                    <span className="text-right font-bold tabular-nums text-fg-1">
                        {fav.triCode} {favPct.toFixed(0)}%
                    </span>
                </li>
            </ol>
            <div aria-hidden="true" className="grid grid-cols-[6.5rem_minmax(0,1fr)_3.25rem] gap-2 text-micro text-fg-3">
                <span />
                <span className="flex justify-between">
                    <span>← {a.triCode}</span>
                    <span>{h.triCode} →</span>
                </span>
                <span />
            </div>
            {p.confidenceNote ? <p className="text-caption text-fg-3">{p.confidenceNote}</p> : null}
        </section>
    );
}

export default WhyThisPick;
