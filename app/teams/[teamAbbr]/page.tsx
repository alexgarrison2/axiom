"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { useParams, useSearchParams, useRouter, usePathname } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import TeamChart from '@/components/TeamChart';
import { useTeamData } from '@/hooks/useTeamData';
import TeamHeader from '@/components/team/TeamHeader';
import FilterControls from '@/components/team/FilterControls';
import GamesLogTable from '@/components/team/GamesLogTable';
import SkaterGrid from '@/components/team/SkaterGrid';
// import { TeamInfo } from '@/types';
import { motion } from 'framer-motion';

export default function TeamDetailPage() {
    const params = useParams();
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();
    const teamAbbr = (params.teamAbbr as string).toUpperCase();

    const { data, loading, error } = useTeamData(teamAbbr);

    const [expandedGameId, setExpandedGameId] = useState<string | null>(null);

    // Initialize activeTab
    const activeTab = searchParams.get('tab') as 'games' | 'charts' | 'skaters' | 'goalies' || 'games';

    const handleTabChange = (val: string) => {
        const newParams = new URLSearchParams(searchParams.toString());
        newParams.set('tab', val);
        router.replace(`${pathname}?${newParams.toString()}`, { scroll: false });
    };

    // Filters
    const [filters, setFilters] = useState({
        goalie: 'All',
        loc: 'All',
        period: 'All',
        last: 'All',
        result: 'All'
    });

    const [teamLogos, setTeamLogos] = useState<Record<string, string>>({});
    const [allTeamsList, setAllTeamsList] = useState<Record<string, string>[]>([]);

    useEffect(() => {
        const fetchTeams = async () => {
            try {
                const Papa = (await import('papaparse')).default;
                const res = await fetch('/data/nhl_teams.csv');
                const text = await res.text();
                const parsed = Papa.parse(text, { header: true, skipEmptyLines: true }).data as Record<string, string>[];
                setAllTeamsList(parsed);

                const logos: Record<string, string> = {};
                parsed.forEach((t) => {
                    if (t['Common Name']) {
                        logos[t['Common Name'].trim()] = t['Team Logo URL'];
                    }
                });
                setTeamLogos(logos);
            } catch (e) { console.error(e); }
        };
        fetchTeams();
    }, []);

    // -- Derived Data --
    const games = data?.games || [];
    const teamInfo = data?.teamInfo;
    const playerStats = data?.playerStats || [];

    const uniqueGoalies = useMemo(() => {
        const set = new Set(games.map(g => g.starting_goalie).filter(Boolean));
        return Array.from(set).sort();
    }, [games]);

    const filteredGames = useMemo(() => {
        let out = [...games];
        if (filters.goalie !== 'All') out = out.filter(g => g.starting_goalie === filters.goalie);
        if (filters.loc !== 'All') out = out.filter(g => filters.loc === 'Home' ? g.home_away === 'Home' : g.home_away === 'Away');
        if (filters.result !== 'All') {
            out = out.filter(g => {
                if (filters.result === 'W') return g.result.startsWith('W');
                if (filters.result === 'L') return g.result === 'L' || g.result === 'OTL' || g.result === 'SOL';
                return true;
            });
        }
        return out;
    }, [games, filters]);

    const displayedGames = useMemo(() => {
        let out = [...filteredGames];
        if (filters.last !== 'All') {
            if (filters.last !== 'Season') {
                const n = parseInt(filters.last);
                out = out.slice(0, n);
            }
        }
        return out;
    }, [filteredGames, filters.last]);


    // -- Skeleton Loader --
    if (loading) return (
        <main className="min-h-screen bg-black text-white font-sans pb-20 overflow-x-hidden">
            {/* Shimmer keyframes */}
            <style>{`
                @keyframes shimmer {
                    0% { background-position: -400px 0; }
                    100% { background-position: 400px 0; }
                }
                .skeleton-shimmer {
                    background: linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.03) 75%);
                    background-size: 800px 100%;
                    animation: shimmer 1.8s ease-in-out infinite;
                }
            `}</style>

            {/* Skeleton Header - Team Logo & Name */}
            <div className="flex flex-col items-center justify-center pt-16 pb-8 px-4">
                <div className="w-24 h-24 rounded-full skeleton-shimmer mb-4" />
                <div className="h-6 w-48 rounded-lg skeleton-shimmer mb-2" />
                <div className="h-4 w-32 rounded-lg skeleton-shimmer" />
            </div>

            {/* Skeleton Tab Bar */}
            <div className="w-full px-4 md:px-8 pt-4">
                <div className="flex gap-2 border-b border-white/5 pb-2 mb-6">
                    {['Games', 'Charts', 'Skaters', 'Goalies'].map((tab) => (
                        <div key={tab} className="h-8 w-20 rounded-md skeleton-shimmer" />
                    ))}
                </div>

                {/* Skeleton Filter Bar */}
                <div className="flex gap-3 mb-6">
                    {[80, 60, 70, 50].map((w, i) => (
                        <div key={i} className="h-8 rounded-md skeleton-shimmer" style={{ width: `${w}px` }} />
                    ))}
                </div>

                {/* Skeleton Table Header */}
                <div className="h-10 w-full rounded-lg skeleton-shimmer mb-2" />

                {/* Skeleton Table Rows */}
                {Array.from({ length: 10 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-4 py-2 border-b border-white/5">
                        <div className="w-8 h-8 rounded-full skeleton-shimmer shrink-0" />
                        <div className="h-4 rounded skeleton-shimmer" style={{ width: `${60 + (i % 3) * 20}%` }} />
                    </div>
                ))}
            </div>
        </main>
    );

    // -- Error State --
    if (error) return (
        <main className="min-h-screen bg-black text-white font-sans flex flex-col items-center justify-center gap-6">
            <div className="p-6 rounded-full bg-red-500/10 border border-red-500/20">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-red-400">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
            </div>
            <div className="text-center">
                <h3 className="text-xl font-bold text-white mb-2 uppercase tracking-widest">Data Unavailable</h3>
                <p className="text-neutral-500 font-mono text-sm mb-4">{error}</p>
                <button
                    onClick={() => window.location.reload()}
                    className="px-6 py-2 bg-white/10 hover:bg-white/20 border border-white/10 rounded-full text-sm font-bold tracking-wider transition-all"
                >
                    RETRY
                </button>
            </div>
        </main>
    );

    if (!teamInfo) return <div className="min-h-screen bg-black text-white p-10">Team Not Found</div>;

    const primaryColor = teamInfo.HexColor1;

    return (
        <main className="min-h-screen bg-black text-white font-sans pb-20 overflow-x-hidden selection:bg-white/20">

            <TeamHeader teamInfo={teamInfo} allTeamsList={allTeamsList} />

            {/* Main Content Area */}
            <motion.div
                className="w-full px-4 md:px-8 relative z-10 pt-4"
                initial={{ opacity: 0, y: 50 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: "easeOut", delay: 0.2 }}
            >

                <Tabs value={activeTab} onValueChange={(val) => handleTabChange(val)} className="w-full">
                    {/* Tabs */}
                    <div className="sticky top-0 bg-black/95 backdrop-blur-xl pt-4 pb-2 z-40 border-b border-border/10 mb-6">
                        <TabsList className="bg-muted/20">
                            <TabsTrigger value="games">Games</TabsTrigger>
                            <TabsTrigger value="charts">Charts</TabsTrigger>
                            <TabsTrigger value="skaters">Skaters</TabsTrigger>
                            <TabsTrigger value="goalies">Goalies</TabsTrigger>
                        </TabsList>
                    </div>

                    <TabsContent value="games" className="m-0 focus-visible:outline-none">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.98 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.4 }}
                        >
                            <FilterControls
                                filters={filters}
                                setFilters={setFilters}
                                uniqueGoalies={uniqueGoalies}
                            />
                            <GamesLogTable
                                games={displayedGames}
                                filters={filters}
                                expandedGameId={expandedGameId}
                                setExpandedGameId={setExpandedGameId}
                                teamAbbr={teamAbbr}
                                playerStats={playerStats}
                                teamLogos={teamLogos}
                                primaryColor={primaryColor}
                            />
                        </motion.div>
                    </TabsContent>

                    <TabsContent value="charts" className="m-0 focus-visible:outline-none">
                        <motion.div
                            className="w-full"
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5 }}
                        >
                            <TeamChart games={displayedGames} leagueGames={data?.leagueGames} primaryColor={primaryColor} />
                        </motion.div>
                    </TabsContent>

                    <TabsContent value="skaters" className="m-0 focus-visible:outline-none">
                        <motion.div
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.4 }}
                        >
                            <SkaterGrid
                                playerStats={playerStats.filter(p => !p.is_goalie)}
                                games={games}
                                teamAbbr={teamAbbr}
                                lineup={data?.lineup}
                            />
                        </motion.div>
                    </TabsContent>

                    <TabsContent value="goalies" className="m-0 focus-visible:outline-none">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: 0.5 }}
                            className="p-8 text-center text-muted-foreground font-mono"
                        >
                            Goalie stats coming soon...
                        </motion.div>
                    </TabsContent>
                </Tabs>
            </motion.div>
        </main>
    );
}
