import { TeamLineup } from '@/utils/data';
import { ArrowUp, ArrowDown, Plus } from 'lucide-react';

interface LineupGridProps {
    lineup?: TeamLineup;
    triCode: string;
    lineupScore?: number;  // quality ratio vs league avg (1.0 = avg)
}

// ── Lineup Quality Gauge ──────────────────────────────────────────────────────
// A pill gauge where the centre = league average (ratio 1.0).
// Fill extends RIGHT from centre for above-average lineups (green).
// Fill extends LEFT  from centre for below-average lineups (orange/red).
// Scale: ±10% maps to 0–50% fill width; values beyond ±10% are clamped.
function LineupScoreGauge({ score }: { score: number }) {
    const pct      = (score - 1.0) * 100;               // e.g. +2.3, -1.5
    const clamped  = Math.max(-10, Math.min(10, pct));   // cap at ±10 %
    const fillPct  = (Math.abs(clamped) / 10) * 50;     // 0–50 % of pill width
    const positive = pct >= 0;

    const fillColor     = positive ? '#22c55e' : '#f97316';   // green : orange
    const fillColorFade = positive ? '#22c55e28' : '#f9731628';
    const label         = (positive ? '+' : '') + pct.toFixed(1) + '%';
    const isNeutral     = Math.abs(pct) < 0.05;

    return (
        <div className="relative flex-1 h-[18px] bg-white/5 rounded-full overflow-hidden border border-white/10">
            {/* Centre divider */}
            <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/20 z-10" />

            {/* Fill — extends outward from the centre */}
            {!isNeutral && (
                <div
                    className="absolute top-0 bottom-0"
                    style={{
                        [positive ? 'left' : 'right']: '50%',
                        width: `${fillPct}%`,
                        background: positive
                            ? `linear-gradient(to right, ${fillColorFade}, ${fillColor})`
                            : `linear-gradient(to left,  ${fillColorFade}, ${fillColor})`,
                    }}
                />
            )}

            {/* Score label — white when over fill, muted grey when near empty */}
            <div
                className="absolute inset-0 flex items-center z-20 text-[9px] font-bold tabular-nums"
                style={{
                    justifyContent: positive ? 'flex-end' : 'flex-start',
                    paddingLeft:    positive ? 0 : '6px',
                    paddingRight:   positive ? '6px' : 0,
                    color: isNeutral ? '#6b7280' : fillPct > 8 ? '#ffffff' : fillColor,
                }}
            >
                {isNeutral ? 'AVG' : label}
            </div>
        </div>
    );
}

export default function LineupGrid({ lineup, lineupScore }: LineupGridProps) {
    if (!lineup) return (
        <div className="flex flex-col items-center justify-center p-4 text-neutral-500 text-xs">
            No lineup data available.
        </div>
    );

    // Helpers
    const getPlayers = (keys: string[]) => {
        // e.g. keys=['f1', 'f2', 'f3', 'f4']
        return keys.map(k => lineup[k] || []);
    };

    const forwards = getPlayers(['f1', 'f2', 'f3', 'f4']);
    const defense = getPlayers(['d1', 'd2', 'd3']);

    return (
        <div className="flex flex-col w-full text-left">
            {/* Header */}
            <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest shrink-0">
                    Starting Lineup
                </span>
                {lineupScore !== undefined && (
                    <LineupScoreGauge score={lineupScore} />
                )}
            </div>

            <div className="flex flex-col gap-4">

                {/* Forwards Table */}
                <div className="border border-white/10 rounded-lg overflow-hidden">
                    {/* Header Row */}
                    <div className="grid grid-cols-3 bg-white/5 border-b border-white/10">
                        <div className="py-1 text-center text-[9px] font-bold text-neutral-500 uppercase">LW</div>
                        <div className="py-1 text-center text-[9px] font-bold text-neutral-500 uppercase border-x border-white/5">C</div>
                        <div className="py-1 text-center text-[9px] font-bold text-neutral-500 uppercase">RW</div>
                    </div>

                    {/* Rows */}
                    {forwards.map((line, i) => (
                        <div key={i} className={`grid grid-cols-3 ${i !== forwards.length - 1 ? 'border-b border-white/5' : ''}`}>
                            {[0, 1, 2].map(colIndex => {
                                const player = line[colIndex]; // 0=LW, 1=C, 2=RW (Data is sorted lw,c,rw)
                                return (
                                    <div key={colIndex} className={`py-1.5 px-1 flex items-center justify-center text-center gap-1 ${colIndex === 1 ? 'border-x border-white/5' : ''}`}>
                                        <div className="flex items-center gap-1">
                                            {/* Icon */}
                                            {player && player.movement === 'up' && (
                                                <ArrowUp className="w-3 h-3 text-green-500" strokeWidth={3} />
                                            )}
                                            {player && player.movement === 'down' && (
                                                <ArrowDown className="w-3 h-3 text-red-500" strokeWidth={3} />
                                            )}
                                            {player && player.movement === 'new' && (
                                                <Plus className="w-3 h-3 text-orange-500" strokeWidth={3} />
                                            )}
                                            <span
                                                className="text-[10px] leading-tight select-none"
                                                style={{
                                                    color: player && player.ppUnit === 1 ? '#5382BD' :
                                                        player && player.ppUnit === 2 ? '#FFFFFF' :
                                                            '#697281',
                                                    fontWeight: player && player.ppUnit === 1 ? 700 : 500
                                                }}
                                            >
                                                {player ? formatName(player.name) : '-'}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>

                {/* Defense Table */}
                <div className="border border-white/10 rounded-lg overflow-hidden w-2/3">
                    {/* Header Row */}
                    <div className="grid grid-cols-2 bg-white/5 border-b border-white/10">
                        <div className="py-1 text-center text-[9px] font-bold text-neutral-500 uppercase">LD</div>
                        <div className="py-1 text-center text-[9px] font-bold text-neutral-500 uppercase border-l border-white/5">RD</div>
                    </div>

                    {/* Rows */}
                    {defense.map((pair, i) => (
                        <div key={i} className={`grid grid-cols-2 ${i !== defense.length - 1 ? 'border-b border-white/5' : ''}`}>
                            {[0, 1].map(colIndex => {
                                const player = pair[colIndex];
                                return (
                                    <div key={colIndex} className={`py-1.5 px-1 flex items-center justify-center text-center gap-1 ${colIndex === 1 ? 'border-l border-white/5' : ''}`}>
                                        <div className="flex items-center gap-1">
                                            {/* Icon */}
                                            {player && player.movement === 'up' && (
                                                <ArrowUp className="w-3 h-3 text-green-500" strokeWidth={3} />
                                            )}
                                            {player && player.movement === 'down' && (
                                                <ArrowDown className="w-3 h-3 text-red-500" strokeWidth={3} />
                                            )}
                                            {player && player.movement === 'new' && (
                                                <Plus className="w-3 h-3 text-orange-500" strokeWidth={3} />
                                            )}
                                            <span
                                                className="text-[10px] leading-tight select-none"
                                                style={{
                                                    color: player && player.ppUnit === 1 ? '#5382BD' :
                                                        player && player.ppUnit === 2 ? '#FFFFFF' :
                                                            '#697281',
                                                    fontWeight: player && player.ppUnit === 1 ? 700 : 500
                                                }}
                                            >
                                                {player ? formatName(player.name) : '-'}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>

            </div>
        </div>
    );
}

function formatName(fullName: string) {
    // Connor McDavid -> C. McDavid? Or just Surname?
    // User image shows surnames: "Robertson", "Hintz", "Benn"
    // Let's use Surname.

    if (!fullName) return "";
    const parts = fullName.split(' ');
    // Handle things like "James van Riemsdyk"?
    // Usually last part is safe enough for display, or full surname if multiple parts.
    if (parts.length > 1) {
        return parts[parts.length - 1];
    }
    return fullName;
}
