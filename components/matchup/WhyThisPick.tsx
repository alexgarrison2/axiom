import type { Prediction } from '@/types/prediction';
import { clashSafePair } from '@/components/ui/team-color';
import { waterfallFor } from '@/lib/matchup/waterfall';
import { cn } from '@/lib/utils';
import styles from './slate.module.css';

/** 1-2 word factor labels. */
const SHORT: Record<string, string> = {
    home_ice: 'Home ice',
    strength_5v5: '5v5',
    special_teams: 'PP / PK',
    goaltending: 'Goalies',
    rest: 'Rest',
    lineup: 'Lineups',
    market: 'Market',
};

const ROW = 'grid grid-cols-[5.5rem_minmax(0,1fr)_4.25rem] items-center gap-2.5';

/**
 * Why-bars: each factor's push in win-probability points, diverging from a
 * centre line toward the team it helps (away left, home right, team colours),
 * then the net forecast.
 */
export function WhyThisPick({ p }: { p: Prediction }) {
    const w = waterfallFor(p);
    if (!w) return null;
    const a = p.away.team;
    const h = p.home.team;
    const colors = clashSafePair(a.triCode, h.triCode);
    const net = w.end - 50;
    const max = Math.max(...w.steps.map(s => Math.abs(s.delta)), Math.abs(net), 1);
    const homeFav = w.end >= 50;
    const fav = homeFav ? h : a;
    const favPct = homeFav ? w.end : 100 - w.end;
    const even = Math.round(favPct) <= 50;

    const bar = (delta: number, strong = false) => {
        const width = (Math.abs(delta) / max) * 50;
        const color = delta >= 0 ? colors.home : colors.away;
        return (
            <span aria-hidden="true" className={styles.why} style={strong ? { height: 10 } : undefined}>
                {Math.abs(delta) >= 0.05 ? (
                    <span
                        className={styles.whyFill}
                        style={{
                            ...(delta >= 0 ? { left: '50%' } : { right: '50%' }),
                            width: `${Math.max(width, 1.5)}%`,
                            backgroundColor: color,
                            boxShadow: `0 0 10px -2px ${color}`,
                        }}
                    />
                ) : null}
            </span>
        );
    };

    return (
        <section aria-labelledby={`why-${p.id}`} className="flex flex-col gap-1.5">
            <h3 id={`why-${p.id}`} className="sr-only">
                {even ? 'Why: coin flip' : `Why: ${fav.triCode} ${favPct.toFixed(0)}%`}
            </h3>
            <div aria-hidden="true" className={cn(ROW, 'text-micro uppercase tracking-wide text-fg-3')}>
                <span />
                <span className="flex justify-between">
                    <span>← {a.triCode}</span>
                    <span>{h.triCode} →</span>
                </span>
                <span />
            </div>
            <ol className="flex flex-col gap-1.5">
                {w.steps.map(s => {
                    const toward = s.delta >= 0 ? h : a;
                    const tiny = Math.abs(s.delta) < 0.05;
                    return (
                        <li key={s.factor} className={cn(ROW, 'text-caption')}>
                            <span className="truncate text-micro uppercase tracking-wide text-fg-2">{SHORT[s.factor] ?? s.label}</span>
                            {bar(s.delta)}
                            <span className="text-right tabular-nums text-fg-1">
                                {tiny ? (
                                    <span className="text-fg-3">0.0</span>
                                ) : (
                                    <>
                                        +{Math.abs(s.delta).toFixed(1)} <span className="text-fg-3">{toward.triCode}</span>
                                        <span className="sr-only"> points toward the {toward.commonName}</span>
                                    </>
                                )}
                            </span>
                        </li>
                    );
                })}
                <li className={cn(ROW, 'mt-0.5 border-t border-line pt-2 text-caption')}>
                    <span className="text-micro font-bold uppercase tracking-wide text-fg-1">Net</span>
                    {bar(net, true)}
                    <span className="text-right font-bold tabular-nums text-fg-1">{even ? '50-50' : `${fav.triCode} ${favPct.toFixed(0)}`}</span>
                </li>
            </ol>
        </section>
    );
}

export default WhyThisPick;
