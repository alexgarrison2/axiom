import React from 'react';

const Legend: React.FC = () => {
    return (
        <div className="w-full max-w-5xl mx-auto mb-12 relative group cursor-default">

            <div className="glass-panel p-3 md:p-6 mb-8 rounded-3xl relative overflow-hidden w-full mx-auto max-w-7xl">
                {/* Background Decor */}
                <div className="absolute inset-0 z-0 opacity-10 bg-gradient-to-br from-blue-500/10 via-purple-500/10 to-transparent pointer-events-none"></div>

                {/* Header Badge */}
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-black px-4 py-1 rounded-full border border-white/20 text-[10px] font-mono tracking-widest text-gray-400 uppercase z-20">
                    How to Read
                </div>

                {/* Main Grid: Matchup Card Layout Sync */}
                <div className="flex flex-col md:grid md:grid-cols-[1fr_minmax(300px,400px)_1fr] gap-4 md:gap-6 items-center relative z-10 w-full opacity-80 hover:opacity-100 transition-opacity duration-300">

                    {/* LEFT: Team Info */}
                    <div className="relative flex items-center justify-start md:justify-end h-full">
                        <div className="text-left md:text-right relative z-10 flex flex-col items-start md:items-end pr-0 pl-2 md:pl-0 md:pr-4">
                            <div className="mb-2 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-neon-green/10 border border-neon-green/50 text-neon-green text-[10px] font-bold">
                                <span>EV% Badge</span>
                            </div>

                            {/* xG Display */}
                            <div className="flex flex-col items-start md:items-end -mt-1 mb-1">
                                <span className="text-4xl font-black text-white tabular-nums tracking-tighter drop-shadow-2xl leading-none">3.45</span>
                                <span className="text-[10px] text-gray-400 font-mono tracking-widest uppercase opacity-60 mr-1">Expected Goals</span>
                            </div>

                            <div className="font-hand text-lg -rotate-3 mb-2" style={{ textShadow: '0 0 10px #0ff, 0 0 20px #0ff, 0 0 40px #0ff', color: '#fff', fontWeight: 700 }}>
                                Starting Goalie
                            </div>
                        </div>
                    </div>

                    {/* CENTER: Visualization */}
                    <div className="relative w-full flex flex-col items-center justify-center py-2 h-full">

                        <div className="absolute top-0 bottom-0 w-[1px] bg-white/10 z-0"></div>

                        {/* Floating Total Badge */}
                        <div className="absolute top-0 z-30 -translate-y-1/2">
                            <div className="bg-black/80 backdrop-blur-md text-white font-mono font-bold text-[10px] px-3 py-1 rounded-full border border-white/20 shadow-xl tracking-wider">
                                TOTAL GOALS
                            </div>
                        </div>

                        <div className="w-full flex flex-col gap-4 relative z-10 mt-4">

                            {/* Model Win % Explanation */}
                            <div className="flex items-center justify-center h-14 w-full relative">
                                {/* Pointer Lines */}
                                <div className="absolute -left-4 top-1/2 -translate-y-1/2 -translate-x-full text-[10px] text-gray-400 font-mono text-right w-24">
                                    Our Model's<br />Win Probability
                                    <div className="h-[1px] w-8 bg-gray-600 absolute top-1/2 -right-2 translate-x-full"></div>
                                </div>

                                <div className="relative flex items-center justify-end h-full flex-1">
                                    <div
                                        className="h-full rounded-l-lg border-r border-black/50 overflow-hidden relative backdrop-blur-sm shadow-[0_0_20px_rgba(0,0,0,0.3)] w-[70%] flex items-center justify-start pl-3"
                                        style={{
                                            background: `rgba(0, 243, 255, 1)`, // Neon Blue solid
                                            boxShadow: `inset 0 0 20px rgba(0,0,0,0.2), 0 0 15px rgba(0, 243, 255, 0.4)`
                                        }}
                                    >
                                        <div className="absolute inset-0 bg-gradient-to-b from-white/20 to-transparent pointer-events-none"></div>
                                        <span className="text-xs font-bold text-white z-10 relative drop-shadow-md">Model %</span>
                                    </div>
                                </div>

                                <div className="relative flex items-center justify-start h-full flex-1">
                                    <div
                                        className="h-full rounded-r-lg border-l border-black/50 overflow-hidden relative backdrop-blur-sm shadow-[0_0_20px_rgba(0,0,0,0.3)] w-[60%] flex items-center justify-end pr-3"
                                        style={{
                                            background: `rgba(188, 19, 254, 1)`, // Neon Purple solid
                                            boxShadow: `inset 0 0 20px rgba(0,0,0,0.2), 0 0 15px rgba(188, 19, 254, 0.4)`
                                        }}
                                    >
                                        <div className="absolute inset-0 bg-gradient-to-b from-white/20 to-transparent pointer-events-none"></div>
                                        <span className="text-xs font-bold text-white z-10 relative drop-shadow-md">Model %</span>
                                    </div>
                                </div>
                            </div>

                            {/* Vegas Win % Explanation */}
                            <div className="flex items-center justify-center h-8 w-full relative">
                                {/* Pointer Lines */}
                                <div className="absolute -right-4 top-1/2 -translate-y-1/2 translate-x-full text-[10px] text-gray-400 font-mono text-left w-24">
                                    Implied Win %<br />from Odds
                                    <div className="h-[1px] w-8 bg-gray-600 absolute top-1/2 -left-2 -translate-x-full"></div>
                                </div>

                                <div className="flex items-center justify-end h-full flex-1">
                                    <div className="h-full rounded-l-sm bg-slate-800 border-r border-black/50 shadow-inner flex items-center justify-start pl-2 w-[50%]">
                                        <div className="flex items-baseline gap-2">
                                            <span className="text-[10px] font-mono text-gray-300">Vegas %</span>
                                            <span className="text-[10px] font-mono text-gray-500 font-bold">-110</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center justify-start h-full flex-1">
                                    <div className="h-full rounded-r-sm bg-slate-700 border-l border-black/50 shadow-inner flex items-center justify-end pr-2 w-[55%]">
                                        <div className="flex items-baseline gap-2 flex-row-reverse">
                                            <span className="text-[10px] font-mono text-gray-300">Vegas %</span>
                                            <span className="text-[10px] font-mono text-gray-500 font-bold">-110</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                        </div>
                    </div>

                    {/* RIGHT: Team Info */}
                    <div className="relative flex items-center justify-end md:justify-start h-full">
                        <div className="text-right md:text-left relative z-10 flex flex-col items-end md:items-start pl-0 pr-2 md:pl-4 md:pr-0 opacity-50">
                            {/* xG Display */}
                            <div className="flex flex-col items-end md:items-start -mt-1 mb-1">
                                <span className="text-4xl font-black text-white tabular-nums tracking-tighter drop-shadow-2xl leading-none">2.81</span>
                                <span className="text-[10px] text-gray-400 font-mono tracking-widest uppercase opacity-60 ml-1">Expected Goals</span>
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
};

export default Legend;
