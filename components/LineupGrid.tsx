import { TeamLineup } from '@/utils/data';
import { ArrowUp, ArrowDown, Plus } from 'lucide-react';

interface LineupGridProps {
    lineup?: TeamLineup;
    triCode: string;
    lineupScore?: number;    // quality ratio vs league avg (1.0 = avg)
    lineupVsTeam?: number;   // quality ratio vs this team's own historical avg
}

// ── Lineup Score Label Chips ──────────────────────────────────────────────────
// Two compact text chips showing lineup quality vs league and vs team average.
// Color scale:
//   ≤ -5%  → dark red    #ef4444
//   -5 to -2% → orange   #f97316
//   -2 to +2% → neutral  #6b7280
//   +2 to +5% → green    #22c55e
//   ≥ +5%  → bright green #16a34a
function scoreColor(pct: number): string {
    if (pct <= -5)  return '#ef4444';
    if (pct <= -2)  return '#f97316';
    if (pct <   2)  return '#6b7280';
    if (pct <   5)  return '#22c55e';
    return '#16a34a';
}

function LineupScoreChip({ label, ratio }: { label: string; ratio: number }) {
    const pct   = (ratio - 1.0) * 100;
    const sign  = pct >= 0 ? '+' : '';
    const color = scoreColor(pct);
    const display = `${sign}${pct.toFixed(1)}%`;

    return (
        <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/5 border border-white/10">
            <span className="text-[9px] text-neutral-500 font-medium">{label}</span>
            <span className="text-[9px] font-bold tabular-nums" style={{ color }}>{display}</span>
        </div>
    );
}

function LineupScoreLabels({ lineupScore, lineupVsTeam }: { lineupScore?: number; lineupVsTeam?: number }) {
    if (lineupScore === undefined && lineupVsTeam === undefined) return null;
    return (
        <div className="flex items-center gap-1.5 flex-wrap">
            {lineupScore  !== undefined && <LineupScoreChip label="vs. Lg:" ratio={lineupScore}  />}
            {lineupVsTeam !== undefined && <LineupScoreChip label="vs. Tm:" ratio={lineupVsTeam} />}
        </div>
    );
}

export default function LineupGrid({ lineup, lineupScore, lineupVsTeam }: LineupGridProps) {
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
            <div className="flex items-center gap-2 mb-3 flex-wrap">
                <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest shrink-0">
                    Starting Lineup
                </span>
                <LineupScoreLabels lineupScore={lineupScore} lineupVsTeam={lineupVsTeam} />
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
