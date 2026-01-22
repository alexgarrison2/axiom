"use client";

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Search, X, Home } from 'lucide-react';
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface TeamSelectorProps {
    teams: any[];
    currentTeam?: {
        CommonName: string;
        TeamTricode: string;
        TeamLogoURL: string;
        HexColor1: string;
    } | null;
}

const DIVISIONS: Record<string, string[]> = {
    "Atlantic": ["BOS", "BUF", "DET", "FLA", "MTL", "OTT", "TBL", "TOR"],
    "Metropolitan": ["CAR", "CBJ", "NJD", "NYI", "NYR", "PHI", "PIT", "WSH"],
    "Central": ["CHI", "COL", "DAL", "MIN", "NSH", "STL", "UTA", "WPG"],
    "Pacific": ["ANA", "CGY", "EDM", "LAK", "SJS", "SEA", "VAN", "VGK"]
};

// Flatten for quick lookup
const TEAM_TO_DIVISION: Record<string, string> = {};
Object.entries(DIVISIONS).forEach(([div, teams]) => {
    teams.forEach(t => TEAM_TO_DIVISION[t] = div);
});

export default function TeamSelector({ teams, currentTeam }: TeamSelectorProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState("");

    // Enrich teams with Division
    const enrichedTeams = useMemo(() => {
        if (!teams) return [];
        return teams
            .filter(t => t['Common Name'])
            .map(t => ({
                ...t,
                division: TEAM_TO_DIVISION[t['Team Tricode']] || 'Unknown'
            }));
    }, [teams]);

    const filteredTeams = useMemo(() => {
        if (!search) return enrichedTeams;
        const q = search.toLowerCase();
        return enrichedTeams.filter(t =>
            t['Common Name'].toLowerCase().includes(q) ||
            t['Team Name'].toLowerCase().includes(q) ||
            t['Team Tricode'].toLowerCase().includes(q)
        );
    }, [enrichedTeams, search]);

    const groupedTeams = useMemo(() => {
        const groups: Record<string, any[]> = {};
        filteredTeams.forEach(t => {
            const div = t.division;
            if (!groups[div]) groups[div] = [];
            groups[div].push(t);
        });
        return groups;
    }, [filteredTeams]);

    // Color Overrides (Shared logic from page, ideally in a util)
    const getColor = (t: any) => {
        const tricode = t['Team Tricode'];
        const overrides: Record<string, string> = {
            'EDM': '#FF4C00',
            'LAK': '#C0C0C0',
            'UTA': '#69B3E7',
        };
        if (overrides[tricode]) return overrides[tricode];

        const c1 = t['Hex Color 1'] || '#FFF';
        // If black, use secondary
        if (c1.toLowerCase().includes('#000000') || c1.toLowerCase() === 'black') {
            return t['Hex Color 2'] || '#FFF';
        }
        return c1;
    };

    return (
        <div className="relative z-50">
            {/* Trigger Button */}
            <div className="flex items-center gap-2">
                <Button
                    variant="ghost"
                    onClick={() => setIsOpen(!isOpen)}
                    className="flex items-center gap-3 px-3 py-6 hover:bg-white/5 border border-transparent hover:border-white/10 transition-all rounded-xl group"
                >
                    {currentTeam ? (
                        <>
                            <div className="relative">
                                <img
                                    src={currentTeam.TeamLogoURL}
                                    alt={currentTeam.CommonName}
                                    className="w-8 h-8 object-contain group-hover:scale-110 transition-transform duration-300"
                                />
                                <div
                                    className="absolute inset-0 blur-lg opacity-40 rounded-full"
                                    style={{ backgroundColor: currentTeam.HexColor1 }}
                                ></div>
                            </div>
                            <div className="flex flex-col items-start">
                                <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest leading-none mb-0.5">Selected Team</span>
                                <div className="flex items-center gap-2">
                                    <span className="text-xl font-bold font-mono tracking-tighter text-white group-hover:text-primary transition-colors">
                                        {currentTeam.CommonName.toUpperCase()}
                                    </span>
                                    <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
                                </div>
                            </div>
                        </>
                    ) : (
                        <span className="text-white font-bold">Select Team</span>
                    )}
                </Button>
            </div>

            {/* Mega Menu / Drawer */}
            <AnimatePresence>
                {isOpen && (
                    <>
                        {/* Backdrop */}
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setIsOpen(false)}
                            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
                        />

                        {/* Menu */}
                        <motion.div
                            initial={{ opacity: 0, y: -20, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -20, scale: 0.95 }}
                            transition={{ type: "spring", duration: 0.4, bounce: 0.2 }}
                            className="absolute top-full left-0 mt-4 w-[90vw] md:w-[800px] max-h-[80vh] overflow-y-auto bg-[#0f1115] border border-white/10 rounded-2xl shadow-2xl p-6 z-50 grid gap-6"
                        >
                            {/* Search Header */}
                            <div className="flex items-center gap-4 border-b border-white/5 pb-4 sticky top-0 bg-[#0f1115] z-10">
                                <Search className="w-5 h-5 text-gray-500" />
                                <Input
                                    placeholder="Search teams..."
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    autoFocus
                                    className="bg-transparent border-none text-lg font-mono placeholder:text-gray-600 focus-visible:ring-0 px-0 h-auto"
                                />
                                <Button size="icon" variant="ghost" onClick={() => setIsOpen(false)} className="hover:bg-white/10 rounded-full">
                                    <X className="w-5 h-5 text-gray-400" />
                                </Button>
                            </div>

                            {/* Grid by Division */}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                                {Object.keys(DIVISIONS).map(division => {
                                    // Only show division if it has filtered teams
                                    const teamsInDiv = groupedTeams[division] || [];
                                    if (teamsInDiv.length === 0) return null;

                                    return (
                                        <div key={division} className="flex flex-col gap-4">
                                            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest border-l-2 border-white/10 pl-3">{division}</h3>
                                            <div className="flex flex-col gap-1">
                                                {teamsInDiv
                                                    .sort((a, b) => a['Common Name'].localeCompare(b['Common Name']))
                                                    .map(t => {
                                                        const isSelected = currentTeam?.TeamTricode === t['Team Tricode'];
                                                        const glow = getColor(t);

                                                        return (
                                                            <Link
                                                                href={`/teams/${t['Team Tricode']}`}
                                                                key={t['Team Tricode']}
                                                                onClick={() => setIsOpen(false)}
                                                                className={`flex items-center gap-3 p-2 rounded-lg transition-all group/item ${isSelected ? 'bg-white/10' : 'hover:bg-white/5'}`}
                                                            >
                                                                <img
                                                                    src={t['Team Logo URL']}
                                                                    alt={t['Common Name']}
                                                                    className="w-6 h-6 object-contain opacity-70 group-hover/item:opacity-100 transition-opacity"
                                                                />
                                                                <span
                                                                    className={`text-sm font-bold font-mono transition-colors ${isSelected ? 'text-white' : 'text-gray-400 group-hover/item:text-white'}`}
                                                                    style={isSelected ? { color: glow, textShadow: `0 0 10px ${glow}40` } : {}}
                                                                >
                                                                    {t['Common Name']}
                                                                </span>
                                                            </Link>
                                                        )
                                                    })}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>

                            {/* Fallback for 'Unknown' Division (e.g. older teams if csv has them) */}
                            {groupedTeams['Unknown'] && groupedTeams['Unknown'].length > 0 && (
                                <div>
                                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Other</h3>
                                    <div className="flex flex-wrap gap-2">
                                        {groupedTeams['Unknown'].map(t => (
                                            <Link
                                                href={`/teams/${t['Team Tricode']}`}
                                                key={t['Team Tricode']}
                                                className="text-xs text-gray-400 hover:text-white"
                                            >
                                                {t['Common Name']}
                                            </Link>
                                        ))}
                                    </div>
                                </div>
                            )}

                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </div>
    );
}
