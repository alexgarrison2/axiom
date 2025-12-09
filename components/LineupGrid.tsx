import { TeamLineup } from '@/utils/data';

interface LineupGridProps {
    lineup?: TeamLineup;
    triCode: string;
}

export default function LineupGrid({ lineup, triCode }: LineupGridProps) {
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
                <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Starting Lineup</span>
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
                                        {/* PP Indicator */}
                                        {player && player.ppUnit === 1 && (
                                            <div className="w-1.5 h-1.5 rounded-full bg-[#21D28B]" title="PP1" />
                                        )}
                                        {player && player.ppUnit === 2 && (
                                            <div className="w-1.5 h-1.5 rounded-full border border-[#F48317]" title="PP2" />
                                        )}

                                        <span className="text-[10px] font-medium text-neutral-300 leading-tight">
                                            {player ? formatName(player.name) : '-'}
                                        </span>
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
                                        {/* PP Indicator */}
                                        {player && player.ppUnit === 1 && (
                                            <div className="w-1.5 h-1.5 rounded-full bg-[#21D28B]" title="PP1" />
                                        )}
                                        {player && player.ppUnit === 2 && (
                                            <div className="w-1.5 h-1.5 rounded-full border border-[#F48317]" title="PP2" />
                                        )}

                                        <span className="text-[10px] font-medium text-neutral-300 leading-tight">
                                            {player ? formatName(player.name) : '-'}
                                        </span>
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
