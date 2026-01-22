"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { useParams, useSearchParams, useRouter, usePathname } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import TeamChart from '@/components/TeamChart';
import { useTeamData } from '@/hooks/useTeamData';
import TeamHeader from '@/components/team/TeamHeader';
import FilterControls from '@/components/team/FilterControls';
import GamesLogTable from '@/components/team/GamesLogTable';
import { TeamInfo } from '@/types';
import { motion } from 'framer-motion';

export default function TeamDetailPage() {
    const params = useParams();
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();
    const teamAbbr = (params.teamAbbr as string).toUpperCase();

    const { data, loading } = useTeamData(teamAbbr);

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
    const [allTeamsList, setAllTeamsList] = useState<any[]>([]);

    useEffect(() => {
        const fetchTeams = async () => {
            try {
                const Papa = (await import('papaparse')).default;
                const res = await fetch('/data/nhl_teams.csv');
                const text = await res.text();
                const parsed = Papa.parse(text, { header: true, skipEmptyLines: true }).data as any[];
                setAllTeamsList(parsed);

                const logos: Record<string, string> = {};
                parsed.forEach((t: any) => {
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


    // -- Render --
    if (loading) return (
        <div className="min-h-screen bg-black text-white p-10 flex flex-col items-center justify-center animate-pulse">
            <div className="w-12 h-12 rounded-full border-4 border-white/20 border-t-white animate-spin mb-4"></div>
            <div className="h-4 w-32 bg-white/10 rounded"></div>
        </div>
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

                <Tabs value={activeTab} onValueChange={(val) => handleTabChange(val as any)} className="w-full">
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
                            <TeamChart games={displayedGames} primaryColor={primaryColor} />
                        </motion.div>
                    </TabsContent>

                    <TabsContent value="skaters" className="m-0 focus-visible:outline-none">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: 0.5 }}
                            className="p-8 text-center text-muted-foreground font-mono"
                        >
                            Skater stats coming soon...
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
