import { StatChip } from '@/components/ui/stat-chip';
import { getGamePills, getTeamPills, pillText, type Pill } from '@/lib/matchup/pills';
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
            tone={pill.tone === 'info' ? 'info' : pill.tone}
            title={pill.title}
            className={cn(!pill.value && 'gap-0', pill.tone === 'info' && pill.state === 'current' && 'border-info/30 text-info')}
        />
    );
}

/**
 * Season-aware context chips: one column per team (away left, home right)
 * and the season series underneath. Every chip comes from lib/matchup/pills.
 */
export function ContextChips({ p }: { p: Prediction }) {
    const away = getTeamPills(p, 'away');
    const home = getTeamPills(p, 'home');
    const game = getGamePills(p);
    if (!away.length && !home.length && !game.length) return null;
    return (
        <div className="relative z-10 flex flex-col gap-1.5">
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
            {game.length ? (
                <ul aria-label="Season series" className="flex flex-wrap justify-center gap-1">
                    {game.map(pill => (
                        <li key={pill.key}>
                            <Chip pill={pill} />
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
    );
}

export { pillText };
export default ContextChips;
