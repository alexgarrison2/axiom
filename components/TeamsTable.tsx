"use client";

import React, { useState, useEffect, useMemo } from 'react';
import Papa from 'papaparse';
import Image from 'next/image';

interface TeamInfo {
    name: string;
    commonName: string;
    logoUrl: string;
    color: string;
}

interface RawGameStat {
    game_id: string;
    game_date: string;
    team: string; // Common name e.g. "Panthers"
    opponent: string;
    home_away: 'Home' | 'Away';
    result: string; // "RW", "RL", "OTW", "OTL", "SOW", "SOL"

    // Stats
    goals_for: string;
    goals_ag: string;
    sog_for: string;
    sog_ag: string;
    attempts_for: string; // CF
    attempts_ag: string;  // CA

    pp_opportunities: string;
    pp_goals: string;
    pk_opportunities: string; // Times shorthanded
    pp_goals_against: string; // PP goals against (PK goals allowed)

    pp_time: string; // seconds
    pk_time: string; // seconds

    xG_for: string;
    xG_against: string;
    xG_for_5v5: string;
    xG_against_5v5: string;

    saves_for: string;
    emptynet_goalsfor: string;
    emptynet_goalsagainst: string;
}

interface TeamStat {
    team: string;
    gp: number;
    wins: number;
    losses: number;
    otl: number;
    points: number;
    pt_pct: number;

    gf_per_game: number;
    ga_per_game: number;

    pp_goals: number;
    pp_opps: number;
    pp_pct: number;
    pp_time_per_game: string; // Formatted mm:ss

    pk_goals_allowed: number;
    pk_opps: number;
    pk_pct: number;
    pk_time_per_game: string; // Formatted mm:ss

    sf_per_game: number;
    sa_per_game: number;

    cf_per_game: number; // Attempts For
    ca_per_game: number; // Attempts Against

    sh_pct: number;
    sv_pct: number;

    engf: number;
    enga: number;

    xgf_per_game: number;
    xga_per_game: number;
    xgf_pct: number;

    xgf_5v5_per_game: number;
    xga_5v5_per_game: number;
    xgf_pct_5v5: number;

    gsax: number; // Goals Saved Above Expected (xGA - GA)
}

type SortKey = keyof TeamStat;

interface SortConfig {
    key: SortKey;
    direction: 'asc' | 'desc';
}

const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const getGradientColor = (value: number, min: number, max: number, inverse: boolean = false) => {
    if (value === null || value === undefined || isNaN(value)) return 'inherit';

    if (max === min) return '#DADADA';

    let ratio = (value - min) / (max - min);
    if (ratio < 0) ratio = 0;
    if (ratio > 1) ratio = 1;

    if (inverse) ratio = 1 - ratio;

    // Pink (#FF44A5) -> Grey (#DADADA) -> Blue (#0083E7)
    const pink = { r: 255, g: 68, b: 165 };
    const grey = { r: 218, g: 218, b: 218 };
    const blue = { r: 0, g: 131, b: 231 };

    let r, g, b;

    if (ratio < 0.5) {
        // 0 to 0.5 -> Pink to Grey
        const subRatio = ratio * 2;
        r = Math.round(pink.r + (grey.r - pink.r) * subRatio);
        g = Math.round(pink.g + (grey.g - pink.g) * subRatio);
        b = Math.round(pink.b + (grey.b - pink.b) * subRatio);
    } else {
        // 0.5 to 1.0 -> Grey to Blue
        const subRatio = (ratio - 0.5) * 2;
        r = Math.round(grey.r + (blue.r - grey.r) * subRatio);
        g = Math.round(grey.g + (blue.g - grey.g) * subRatio);
        b = Math.round(grey.b + (blue.b - grey.b) * subRatio);
    }

    return `rgb(${r}, ${g}, ${b})`;
};

const TeamsTable = () => {
    const [stats, setStats] = useState<TeamStat[]>([]);
    const [loading, setLoading] = useState(true);
    const [teams, setTeams] = useState<Record<string, TeamInfo>>({});

    // Filters
    const [filterHomeAway, setFilterHomeAway] = useState<'All' | 'Home' | 'Away'>('All');
    const [filterLastN, setFilterLastN] = useState<number | 'All'>('All');

    // Sorting
    const [sortKey, setSortKey] = useState<SortKey>('pt_pct');
    const [sortDesc, setSortDesc] = useState(true);

    const [rawData, setRawData] = useState<RawGameStat[]>([]);

    useEffect(() => {
        const initLoad = async () => {
            try {
                const [statsRes, teamsRes] = await Promise.all([
                    fetch('/data/gamestats.csv'),
                    fetch('/data/nhl_teams.csv')
                ]);

                const statsText = await statsRes.text();
                const teamsText = await teamsRes.text();

                // Parse Teams Meta
                const teamsMeta: Record<string, TeamInfo> = {};
                Papa.parse(teamsText, {
                    header: true,
                    skipEmptyLines: true,
                    complete: (results: any) => {
                        results.data.forEach((row: any) => {
                            teamsMeta[row['Common Name']] = {
                                name: row['Team Name'],
                                commonName: row['Common Name'],
                                logoUrl: row['Team Logo URL'],
                                color: row['Hex Color 1']
                            };
                        });
                        setTeams(teamsMeta);
                    }
                });

                // Parse Game Stats
                const parsedStats = Papa.parse(statsText, { header: true, skipEmptyLines: true }).data as RawGameStat[];
                setRawData(parsedStats);

            } catch (err) {
                console.error("Failed to load data", err);
            } finally {
                setLoading(false);
            }
        };

        initLoad();
    }, []);

    // Process data when filters change
    useEffect(() => {
        if (rawData.length === 0) return;

        // 1. Filter Raw Data
        let filteredGames = [...rawData];

        // Sort by date desc for "Last N"
        filteredGames.sort((a, b) => new Date(b.game_date).getTime() - new Date(a.game_date).getTime());

        // Group by Team to apply "Last N" per team
        const gamesByTeam: Record<string, RawGameStat[]> = {};
        filteredGames.forEach(game => {
            if (!gamesByTeam[game.team]) gamesByTeam[game.team] = [];
            gamesByTeam[game.team].push(game);
        });

        const processedTeams: TeamStat[] = [];

        Object.keys(gamesByTeam).forEach(teamName => {
            let teamGames = gamesByTeam[teamName];

            // Filter Home/Away
            if (filterHomeAway === 'Home') {
                teamGames = teamGames.filter(g => g.home_away === 'Home');
            } else if (filterHomeAway === 'Away') {
                teamGames = teamGames.filter(g => g.home_away === 'Away');
            }

            // Filter Last N
            if (filterLastN !== 'All') {
                teamGames = teamGames.slice(0, filterLastN);
            }

            if (teamGames.length === 0) return;

            // Aggregation
            let gp = 0, wins = 0, losses = 0, otl = 0;
            let gf = 0, ga = 0;
            let pp_goals = 0, pp_opps = 0, pp_time = 0;
            let pk_goals_allowed = 0, pk_opps = 0, pk_time = 0;
            let sf = 0, sa = 0;
            let cf = 0, ca = 0;
            let saves = 0;
            let engf = 0, enga = 0;
            let xgf = 0, xga = 0, xgf_5v5 = 0, xga_5v5 = 0;

            teamGames.forEach(g => {
                gp++;
                // Result
                if (g.result === 'RW' || g.result === 'OTW' || g.result === 'SOW') wins++;
                else if (g.result === 'RL') losses++;
                else otl++;

                gf += parseFloat(g.goals_for || '0');
                ga += parseFloat(g.goals_ag || '0');

                pp_goals += parseFloat(g.pp_goals || '0');
                pp_opps += parseFloat(g.pp_opportunities || '0');
                pp_time += parseFloat(g.pp_time || '0');

                pk_goals_allowed += parseFloat(g.pp_goals_against || '0');
                pk_opps += parseFloat(g.pk_opportunities || '0');
                pk_time += parseFloat(g.pk_time || '0');

                sf += parseFloat(g.sog_for || '0');
                sa += parseFloat(g.sog_ag || '0');

                cf += parseFloat(g.attempts_for || '0');
                ca += parseFloat(g.attempts_ag || '0');

                saves += parseFloat(g.saves_for || '0');

                engf += parseFloat(g.emptynet_goalsfor || '0');
                enga += parseFloat(g.emptynet_goalsagainst || '0');

                xgf += parseFloat(g.xG_for || '0');
                xga += parseFloat(g.xG_against || '0');
                xgf_5v5 += parseFloat(g.xG_for_5v5 || '0');
                xga_5v5 += parseFloat(g.xG_against_5v5 || '0');
            });

            const points = wins * 2 + otl;

            processedTeams.push({
                team: teamName,
                gp,
                wins,
                losses,
                otl,
                points,
                pt_pct: points / (gp * 2),

                gf_per_game: gf / gp,
                ga_per_game: ga / gp,

                pp_goals,
                pp_opps,
                pp_pct: pp_opps > 0 ? (pp_goals / pp_opps) * 100 : 0,
                pp_time_per_game: formatTime(pp_time / gp),

                pk_goals_allowed,
                pk_opps,
                pk_pct: pk_opps > 0 ? ((pk_opps - pk_goals_allowed) / pk_opps) * 100 : 0,
                pk_time_per_game: formatTime(pk_time / gp),

                sf_per_game: sf / gp,
                sa_per_game: sa / gp,

                cf_per_game: cf / gp,
                ca_per_game: ca / gp,

                sh_pct: sf > 0 ? (gf / sf) * 100 : 0,
                sv_pct: sa > 0 ? (saves / sa) * 100 : 0,

                engf,
                enga,

                xgf_per_game: xgf / gp,
                xga_per_game: xga / gp,
                xgf_pct: (xgf + xga) > 0 ? (xgf / (xgf + xga)) * 100 : 0,

                xgf_5v5_per_game: xgf_5v5 / gp,
                xga_5v5_per_game: xga_5v5 / gp,
                xgf_pct_5v5: (xgf_5v5 + xga_5v5) > 0 ? (xgf_5v5 / (xgf_5v5 + xga_5v5)) * 100 : 0,

                gsax: xga - ga // Cumulative GSAx
            });
        });

        setStats(processedTeams);

    }, [rawData, filterHomeAway, filterLastN]);

    const handleSort = (key: SortKey) => {
        if (sortKey === key) {
            setSortDesc(!sortDesc);
        } else {
            setSortKey(key);
            setSortDesc(true); // Default to desc for most stats
        }
    };

    const sortedStats = useMemo(() => {
        const sorted = [...stats];
        sorted.sort((a, b) => {
            const valA = a[sortKey];
            const valB = b[sortKey];

            if (typeof valA === 'string' && typeof valB === 'string') {
                return sortDesc ? valB.localeCompare(valA) : valA.localeCompare(valB);
            }

            // Assume numbers
            return sortDesc
                ? (valB as number) - (valA as number)
                : (valA as number) - (valB as number);
        });
        return sorted;
    }, [stats, sortKey, sortDesc]);

    // Calculate min/max for gradients
    const ranges = useMemo(() => {
        const calculateRange = (key: keyof TeamStat) => {
            if (stats.length === 0) return { min: 0, max: 0 };
            const values = stats.map(s => {
                const val = s[key];
                return typeof val === 'number' ? val : 0;
            });
            return { min: Math.min(...values), max: Math.max(...values) };
        };

        return {
            points: calculateRange('points'),
            pt_pct: calculateRange('pt_pct'),
            gf_per_game: calculateRange('gf_per_game'),
            ga_per_game: calculateRange('ga_per_game'),
            pp_pct: calculateRange('pp_pct'),
            pk_pct: calculateRange('pk_pct'),
            sf_per_game: calculateRange('sf_per_game'),
            sa_per_game: calculateRange('sa_per_game'),
            cf_per_game: calculateRange('cf_per_game'),
            ca_per_game: calculateRange('ca_per_game'),
            sh_pct: calculateRange('sh_pct'),
            sv_pct: calculateRange('sv_pct'),
            xgf_per_game: calculateRange('xgf_per_game'),
            xga_per_game: calculateRange('xga_per_game'),
            xgf_pct: calculateRange('xgf_pct'),
            xgf_pct_5v5: calculateRange('xgf_pct_5v5'),
            gsax: calculateRange('gsax'),
        };
    }, [stats]);

    const getTimeSeconds = (timeStr: string) => {
        const [m, s] = timeStr.split(':').map(Number);
        return m * 60 + s;
    };

    const timeRanges = useMemo(() => {
        if (stats.length === 0) return { pp: { min: 0, max: 0 }, pk: { min: 0, max: 0 } };
        const ppTimes = stats.map(s => getTimeSeconds(s.pp_time_per_game));
        const pkTimes = stats.map(s => getTimeSeconds(s.pk_time_per_game));
        return {
            pp: { min: Math.min(...ppTimes), max: Math.max(...ppTimes) },
            pk: { min: Math.min(...pkTimes), max: Math.max(...pkTimes) }
        };
    }, [stats]);


    if (loading) return <div className="p-8 text-center bg-gray-900 border border-gray-800 rounded-xl text-gray-400">Loading Stats...</div>;

    // Helper for columns
    const renderCell = (team: TeamStat, key: keyof TeamStat, label?: string, isInverse: boolean = false, isTime: boolean = false) => {
        let value = team[key];
        let color = '#DADADA'; // Default grey

        if (typeof value === 'number') {
            // Numbers
            const r = ranges[key as keyof typeof ranges];
            if (r) {
                color = getGradientColor(value, r.min, r.max, isInverse);
            }
            // Format
            if (key === 'pt_pct') {
                value = (value as number).toFixed(3).replace(/^0+/, ''); // .650
            } else if (key.toString().includes('pct')) {
                value = value.toFixed(1) + '%';
            } else if (['sf_per_game', 'sa_per_game', 'cf_per_game', 'ca_per_game'].includes(key)) {
                value = value.toFixed(1);
            } else if (key.toString().includes('per_game') || key.toString() === 'gsax') {
                value = value.toFixed(2);
            }
        } else if (isTime) {
            // Time strings
            const seconds = getTimeSeconds(value as string);
            const r = key === 'pp_time_per_game' ? timeRanges.pp : timeRanges.pk;
            color = getGradientColor(seconds, r.min, r.max, isInverse);
        }

        return (
            <td className="px-4 py-3 text-sm font-medium whitespace-nowrap text-center" style={{ color }}>
                {value}
            </td>
        );
    };

    const ButtonGroup = ({ options, current, onChange }: { options: (number | string)[], current: string | number, onChange: (val: any) => void }) => (
        <div className="flex bg-gray-800 rounded-lg p-1 gap-1">
            {options.map(opt => (
                <button
                    key={opt}
                    onClick={() => onChange(opt)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${current === opt
                        ? 'bg-blue-600 text-white shadow-lg'
                        : 'text-gray-400 hover:text-white hover:bg-gray-700'
                        }`}
                >
                    {opt === 'All' ? 'All Games' : (typeof opt === 'number' ? `Last ${opt}` : opt)}
                </button>
            ))}
        </div>
    );

    return (
        <div className="w-full">
            {/* Filters */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                <div className="flex flex-col gap-2">
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Location</label>
                    <ButtonGroup
                        options={['All', 'Home', 'Away']}
                        current={filterHomeAway}
                        onChange={setFilterHomeAway}
                    />
                </div>
                <div className="flex flex-col gap-2">
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Recent</label>
                    <ButtonGroup
                        options={['All', 5, 10, 20]}
                        current={filterLastN}
                        onChange={setFilterLastN}
                    />
                </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto bg-gray-900 border border-gray-800 rounded-xl shadow-2xl relative">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="border-b border-gray-800 bg-gray-900/95 sticky top-0 z-10 backdrop-blur-sm shadow-sm text-xs uppercase tracking-wider text-gray-400">
                            <th className="px-4 py-3 font-semibold sticky left-0 bg-gray-900 z-20 shadow-[1px_0_0_0_rgba(255,255,255,0.1)]">Team</th>
                            {[
                                { k: 'gp', l: 'GP' },
                                { k: 'wins', l: 'W' },
                                { k: 'losses', l: 'L' },
                                { k: 'otl', l: 'OT' },
                                { k: 'points', l: 'PTS' },
                                { k: 'pt_pct', l: 'P%' },
                                { k: 'gf_per_game', l: 'GF/G' },
                                { k: 'ga_per_game', l: 'GA/G', inv: true },
                                { k: 'pp_pct', l: 'PP%' },
                                { k: 'pp_time_per_game', l: 'PP T/GP', isTime: true },
                                { k: 'pk_pct', l: 'PK%' },
                                { k: 'pk_time_per_game', l: 'PK T/GP', isTime: true, inv: true },
                                { k: 'sf_per_game', l: 'SF/G' },
                                { k: 'sa_per_game', l: 'SA/G', inv: true },
                                { k: 'cf_per_game', l: 'CF/G' },
                                { k: 'ca_per_game', l: 'CA/G', inv: true },
                                { k: 'sh_pct', l: 'Sh%' },
                                { k: 'sv_pct', l: 'Sv%' },
                                { k: 'engf', l: 'EN GF' },
                                { k: 'enga', l: 'EN GA', inv: true },
                                { k: 'xgf_per_game', l: 'xGF/G' },
                                { k: 'xga_per_game', l: 'xGA/G', inv: true },
                                { k: 'xgf_pct', l: 'xGF%' },
                                { k: 'gsax', l: 'GSAx' }
                            ].map(({ k, l }) => (
                                <th
                                    key={k}
                                    className="px-4 py-3 font-semibold cursor-pointer hover:text-white transition-colors text-center whitespace-nowrap"
                                    onClick={() => handleSort(k as SortKey)}
                                >
                                    <div className="flex items-center justify-center gap-1">
                                        {l}
                                        {sortKey === k && (
                                            <span className="text-[10px] text-blue-400">{sortDesc ? '▼' : '▲'}</span>
                                        )}
                                    </div>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800 text-sm">
                        {sortedStats.map((team, idx) => {
                            const meta = teams[team.team] || {};
                            return (
                                <tr key={team.team} className="hover:bg-gray-800/50 transition-colors">
                                    <td className="px-4 py-3 font-medium text-white sticky left-0 bg-gray-900 border-r border-gray-800 z-10">
                                        <div className="flex items-center justify-center md:justify-start gap-3">
                                            <span className="text-gray-600 text-xs w-4 text-center md:text-left">{idx + 1}</span>
                                            {meta.logoUrl && (
                                                <div className="w-10 h-10 md:w-8 md:h-8 relative shrink-0">
                                                    <Image
                                                        src={meta.logoUrl}
                                                        alt={team.team}
                                                        fill
                                                        className="object-contain"
                                                    />
                                                </div>
                                            )}
                                            <span className="truncate max-w-[120px] hidden md:block" title={meta.commonName || team.team}>
                                                {meta.commonName || team.team}
                                            </span>
                                        </div>
                                    </td>

                                    {/* Basic Stats - No Gradient */}
                                    <td className="px-4 py-3 text-gray-300 text-center">{team.gp}</td>
                                    <td className="px-4 py-3 text-gray-300 text-center">{team.wins}</td>
                                    <td className="px-4 py-3 text-gray-300 text-center">{team.losses}</td>
                                    <td className="px-4 py-3 text-gray-300 text-center">{team.otl}</td>

                                    {/* Advanced Stats - With Gradient */}
                                    {renderCell(team, 'points')}
                                    {renderCell(team, 'pt_pct')}
                                    {renderCell(team, 'gf_per_game')}
                                    {renderCell(team, 'ga_per_game', undefined, true)}
                                    {renderCell(team, 'pp_pct')}
                                    {renderCell(team, 'pp_time_per_game', undefined, false, true)}
                                    {renderCell(team, 'pk_pct')}
                                    {renderCell(team, 'pk_time_per_game', undefined, true, true)}
                                    {renderCell(team, 'sf_per_game')}
                                    {renderCell(team, 'sa_per_game', undefined, true)}
                                    {renderCell(team, 'cf_per_game')}
                                    {renderCell(team, 'ca_per_game', undefined, true)}
                                    {renderCell(team, 'sh_pct')}
                                    {renderCell(team, 'sv_pct')}
                                    {renderCell(team, 'engf')}
                                    {renderCell(team, 'enga', undefined, true)}
                                    {renderCell(team, 'xgf_per_game')}
                                    {renderCell(team, 'xga_per_game', undefined, true)}
                                    {renderCell(team, 'xgf_pct')}
                                    {renderCell(team, 'gsax')}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default TeamsTable;
