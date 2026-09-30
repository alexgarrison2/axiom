import { StatChip, SeasonTag } from '@/components/ui/stat-chip';
import { getGamePills, getTeamPills, pillText, priorSeries, type Pill } from '@/lib/matchup/pills';
import type { Prediction } from '@/types/prediction';
import { cn } from '@/lib/utils';

function Chip({ pill }: { pill: Pill }) {
    return (
        <StatChip
            label={pill.label}
            value={pill.value ?? ''}
            state={pill.state}
            n={pill.n}
            seasonTag={pill.seasonTag}
            title={pill.title}
            tone={pill.tone === 'info' ? 'neutral' : pill.tone}
            className={cn(!pill.value && 'gap-0')}
        />
    );
}

/**
 * Season-aware context chips for the Why tab: one column per team (away
 * left, home right) and the season series underneath. Every chip comes from
 * lib/matchup/pills; last season's series carries a 25-26 tag.
 */
export function ContextChips({ p }: { p: Prediction }) {
    const away = getTeamPills(p, 'away');
    const home = getTeamPills(p, 'home');
    const game = getGamePills(p);
    const prior = priorSeries(p);
    if (!away.length && !home.length && !game.length && !prior) return null;
    return (
        <div className="flex flex-col gap-1.5">
            <div className="grid grid-cols-2 gap-2">
                <ul aria-label={`${p.away.team.commonName} context`} className="flex flex-wrap content-start gap-1">
                    {away.map(pill => (
                        <li key={pill.key}>
                            <Chip pill={pill} />
                        </li>
                    ))}
                </ul>
                <ul aria-label={`${p.home.team.commonName} context`} className="flex flex-wrap content-start justify-end gap-1">
                    {home.map(pill => (
                        <li key={pill.key}>
                            <Chip pill={pill} />
                        </li>
                    ))}
                </ul>
            </div>
            {game.length || prior ? (
                <ul aria-label="Season series" className="flex flex-wrap justify-center gap-1">
                    {game.map(pill => (
                        <li key={pill.key}>
                            <Chip pill={pill} />
                        </li>
                    ))}
                    {prior ? (
                        <li className="inline-flex items-center gap-1.5 rounded-chip border border-dashed border-line px-1.5 py-0.5 text-micro text-fg-3">
                            <SeasonTag>{prior.tag}</SeasonTag>
                            <span className="uppercase tracking-wide">H2H</span>
                            <span className="tabular-nums text-fg-2">{prior.text}</span>
                        </li>
                    ) : null}
                </ul>
            ) : null}
        </div>
    );
}

export { pillText };
export default ContextChips;
