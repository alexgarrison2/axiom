'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Papa from 'papaparse';
import Image from 'next/image';

// --- Interfaces ---

interface TeamInfo {
    name: string;
    commonName: string;
    logoUrl: string;
    color: string;
}

interface RawGameStat {
    game_id: string;
    game_date: string;
    team: string; // Common Name e.g. "Panthers"
    opponent: string; // Common Name
    home_away: 'Home' | 'Away';
    result: string; // RW, OTW, SOW, RL, OTL, SOL

    // Stats
    goals_for: string;
    goals_ag: string;
    sog_for: string;
    sog_ag: string;
    attempts_for: string; // Corsi For
    attempts_ag: string;  // Corsi Against

    pp_goals: string;
    pp_opportunities: string;
    pp_time: string; // seconds

    pp_goals_against: string; // PPGA (Goals we gave up while on PK? No, usually tracked as PP Goals Against us)
    // Wait, let's verify semantics. 
    // In gamestats.csv:
    // pp_goals = goals I scored on PP
    // pp_goals_against = goals opponent scored on PP (so my PK goals against)

    pk_opportunities: string; // Times I was shorthanded
    pk_time: string; // Time I was shorthanded

    xG_for: string;
    xG_against: string;
    xG_for_5v5: string;
    xG_against_5v5: string;

    emptynet_goalsfor: string;
    emptynet_goalsagainst: string;

    saves_for: string;
    saves_against: string;
}

interface AggregatedTeamStats {
    team: string;
    gp: number;
    wins: number;
    losses: number;
    otl: number;
    points: number;

    gf: number;
    ga: number;

    pp_goals: number;
    pp_opps: number;
    pp_time: number;
    pp_goals_against: number; // PPGA (Goals allowed on PK)

    pk_opps: number;
    pk_time: number; // Time shorthanded
    // PK Goals Allowed is pp_goals_against

    shots_for: number;
    shots_against: number;

    attempts_for: number;
    attempts_against: number;

    xg_for: number;
    xg_against: number;
    xg_for_5v5: number;
    xg_against_5v5: number;

    engf: number;
    enga: number;

    saves_for: number;
    saves_against: number; // Not really needed for team stats unless we want Opp Sv%
}

interface DisplayStats extends AggregatedTeamStats {
    logoUrl: string;
    color: string;

    // Derived
    pt_pct: number;
    gf_per_game: number;
    ga_per_game: number;
    pp_pct: number;
    pk_pct: number;
    sf_per_game: number;
    sa_per_game: number;
    cf_per_game: number; // Attempts
    ca_per_game: number;
    sh_pct: number;
    sv_pct: number;
    xg_for_pct: number;
    xg_for_pct_5v5: number;
    pp_time_per_game: string; // mm:ss
}

type SortKey = keyof DisplayStats;

// --- Helper Functions ---

const parseFloatSafe = (val: string) => {
    const f = parseFloat(val);
    return isNaN(f) ? 0 : f;
};

const parseIntSafe = (val: string) => {
    const i = parseInt(val, 10);
    return isNaN(i) ? 0 : i;
};

const formatPct = (val: number) => `${(val * 100).toFixed(1)}%`;
const formatDec = (val: number, digits = 2) => val.toFixed(digits);

const TeamsTable: React.FC = () => {
    const [loading, setLoading] = useState(true);
    const [teamsData, setTeamsData] = useState<DisplayStats[]>([]);
    const [filterHomeAway, setFilterHomeAway] = useState<'All' | 'Home' | 'Away'>('All');
    const [filterLastN, setFilterLastN] = useState<number | 'All'>('All');
    const [sortKey, setSortKey] = useState<SortKey>('pt_pct');
    const [sortDesc, setSortDesc] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
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
                    }
                });

                // Parse Game Stats
                const rawStats: RawGameStat[] = Papa.parse(statsText, { header: true, skipEmptyLines: true }).data as RawGameStat[];

                processData(rawStats, teamsMeta);

            } catch (err) {
                console.error("Failed to load data", err);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [filterHomeAway, filterLastN]); // Re-process when filters change? No, better to process once and filter in memory if possible. 
    // Actually, filtering by Last N requires sorting games by date first. 
    // Let's load RAW data once, then process in a separate effect or useMemo.

    // Refactor: Load once
    const [rawData, setRawData] = useState<RawGameStat[]>([]);
    const [teamsMeta, setTeamsMeta] = useState<Record<string, TeamInfo>>({});

    useEffect(() => {
        const initLoad = async () => {
            try {
                const [statsRes, teamsRes] = await Promise.all([
                    fetch('/data/gamestats.csv'),
                    fetch('/data/nhl_teams.csv')
                ]);
                const statsText = await statsRes.text();
                const teamsText = await teamsRes.text();

                const parsedTeams: Record<string, TeamInfo> = {};
                Papa.parse(teamsText, {
                    header: true,
                    skipEmptyLines: true,
                    complete: (results: any) => {
                        results.data.forEach((row: any) => {
                            parsedTeams[row['Common Name']] = {
                                name: row['Team Name'],
                                commonName: row['Common Name'],
                                logoUrl: row['Team Logo URL'],
                                color: row['Hex Color 1']
                            };
                        });
                    }
                });
                setTeamsMeta(parsedTeams);

                const parsedStats = Papa.parse(statsText, { header: true, skipEmptyLines: true }).data as RawGameStat[];
                // Sort by date descending for easier "Last N" processing
                parsedStats.sort((a, b) => new Date(b.game_date).getTime() - new Date(a.game_date).getTime());
                setRawData(parsedStats);
            } catch (e) {
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        initLoad();
    }, []);

    // Aggregation Logic
    useEffect(() => {
        if (rawData.length === 0) return;

        const aggregation: Record<string, AggregatedTeamStats> = {};

        // Initialize Teams
        Object.keys(teamsMeta).forEach(teamName => {
            aggregation[teamName] = {
                team: teamName,
                gp: 0, wins: 0, losses: 0, otl: 0, points: 0,
                gf: 0, ga: 0,
                pp_goals: 0, pp_opps: 0, pp_time: 0, pp_goals_against: 0,
                pk_opps: 0, pk_time: 0,
                shots_for: 0, shots_against: 0,
                attempts_for: 0, attempts_against: 0,
                xg_for: 0, xg_against: 0, xg_for_5v5: 0, xg_against_5v5: 0,
                engf: 0, enga: 0,
                saves_for: 0, saves_against: 0
            };
        });

        // We process per TEAM to handle "Last N" correctly.
        // For "Last N", we take the first N games for THAT team from the sorted list.

        Object.keys(teamsMeta).forEach(teamName => {
            let teamGames = rawData.filter(row => row.team === teamName);

            // Apply Filters
            if (filterHomeAway !== 'All') {
                teamGames = teamGames.filter(g => g.home_away === filterHomeAway);
            }

            if (filterLastN !== 'All') {
                teamGames = teamGames.slice(0, filterLastN);
            }

            const agg = aggregation[teamName];
            if (!agg) return; // Should allow 'Unknown' teams? No.

            teamGames.forEach(g => {
                agg.gp++;

                // Result
                if (g.result === 'RW' || g.result === 'OTW' || g.result === 'SOW') {
                    agg.wins++;
                    agg.points += 2;
                } else if (g.result === 'OTL' || g.result === 'SOL') {
                    agg.otl++;
                    agg.points += 1;
                } else {
                    agg.losses++;
                }

                agg.gf += parseIntSafe(g.goals_for);
                agg.ga += parseIntSafe(g.goals_ag);
                agg.pp_goals += parseIntSafe(g.pp_goals);
                agg.pp_opps += parseIntSafe(g.pp_opportunities);
                agg.pp_time += parseIntSafe(g.pp_time);

                // PPGA (Goals allowed by this team's PK)
                // In CSV, 'pp_goals_against' for Team A is effectively goals scored by Opponent on PP.
                agg.pp_goals_against += parseIntSafe(g.pp_goals_against);

                agg.pk_opps += parseIntSafe(g.pk_opportunities);
                agg.pk_time += parseIntSafe(g.pk_time); // This is my PK time

                agg.shots_for += parseIntSafe(g.sog_for);
                agg.shots_against += parseIntSafe(g.sog_ag);
                agg.attempts_for += parseIntSafe(g.attempts_for);
                agg.attempts_against += parseIntSafe(g.attempts_ag);

                agg.xg_for += parseFloatSafe(g.xG_for);
                agg.xg_against += parseFloatSafe(g.xG_against);
                agg.xg_for_5v5 += parseFloatSafe(g.xG_for_5v5);
                agg.xg_against_5v5 += parseFloatSafe(g.xG_against_5v5);

                agg.engf += parseIntSafe(g.emptynet_goalsfor);
                agg.enga += parseIntSafe(g.emptynet_goalsagainst);

                agg.saves_for += parseIntSafe(g.saves_for);
            });
        });

        // Convert to DisplayStats
        const display: DisplayStats[] = Object.values(aggregation).map(agg => {
            const gp = agg.gp || 1; // Avoid div by zero

            const pt_pct = agg.points / (agg.gp * 2);
            const pp_pct = agg.pp_opps > 0 ? agg.pp_goals / agg.pp_opps : 0;
            // PK% = 1 - (PP Goals Against / PK Opps)
            const pk_pct = agg.pk_opps > 0 ? 1 - (agg.pp_goals_against / agg.pk_opps) : 0;

            // Save %
            const sv_pct = agg.shots_against > 0 ? agg.saves_for / agg.shots_against : 0;
            // Shooting %
            const sh_pct = agg.shots_for > 0 ? agg.gf / agg.shots_for : 0;

            const xg_total = agg.xg_for + agg.xg_against;
            const xg_for_pct = xg_total > 0 ? agg.xg_for / xg_total : 0;

            const xg_5v5_total = agg.xg_for_5v5 + agg.xg_against_5v5;
            const xg_for_pct_5v5 = xg_5v5_total > 0 ? agg.xg_for_5v5 / xg_5v5_total : 0;

            // PP Time per Game
            const pp_seconds_pg = agg.pp_time / gp;
            const pp_min = Math.floor(pp_seconds_pg / 60);
            const pp_sec = Math.round(pp_seconds_pg % 60);
            const pp_time_fmt = `${pp_min}:${pp_sec.toString().padStart(2, '0')}`;

            return {
                ...agg,
                logoUrl: teamsMeta[agg.team]?.logoUrl || '',
                color: teamsMeta[agg.team]?.color || '#000',
                pt_pct,
                gf_per_game: agg.gf / gp,
                ga_per_game: agg.ga / gp,
                pp_pct,
                pk_pct,
                sf_per_game: agg.shots_for / gp,
                sa_per_game: agg.shots_against / gp,
                cf_per_game: agg.attempts_for / gp,
                ca_per_game: agg.attempts_against / gp,
                sh_pct,
                sv_pct,
                xg_for_pct,
                xg_for_pct_5v5,
                pp_time_per_game: pp_time_fmt
            };
        });

        setTeamsData(display);

    }, [rawData, teamsMeta, filterHomeAway, filterLastN]); // Dependencies

    // Sorting
    const sortedData = useMemo(() => {
        const data = [...teamsData];
        data.sort((a, b) => {
            // @ts-ignore
            const valA = a[sortKey];
            // @ts-ignore
            const valB = b[sortKey];

            if (valA < valB) return sortDesc ? 1 : -1;
            if (valA > valB) return sortDesc ? -1 : 1;
            return 0;
        });
        return data;
    }, [teamsData, sortKey, sortDesc]);

    const handleSort = (key: SortKey) => {
        if (sortKey === key) {
            setSortDesc(!sortDesc);
        } else {
            setSortKey(key);
            setSortDesc(true); // Default desc for stats
        }
    };

    if (loading) return <div className="text-white p-8">Loading stats...</div>;

    return (
        <div className="w-full bg-neutral-900 border border-neutral-800 rounded-xl overflow-hidden shadow-2xl">
            {/* Controls */}
            <div className="p-4 bg-neutral-900 border-b border-neutral-800 flex flex-wrap gap-4 items-center justify-between">
                <h2 className="text-2xl font-bold text-white tracking-widest uppercase">Team Statistics</h2>

                <div className="flex gap-4">
                    <select
                        className="bg-neutral-800 text-white text-sm p-2 rounded border border-neutral-700 focus:outline-none focus:border-cyan-500 transition-colors"
                        value={filterHomeAway}
                        onChange={(e) => setFilterHomeAway(e.target.value as any)}
                    >
                        <option value="All">All Games</option>
                        <option value="Home">Home</option>
                        <option value="Away">Away</option>
                    </select>

                    <select
                        className="bg-neutral-800 text-white text-sm p-2 rounded border border-neutral-700 focus:outline-none focus:border-cyan-500 transition-colors"
                        value={filterLastN}
                        onChange={(e) => setFilterLastN(e.target.value === 'All' ? 'All' : parseInt(e.target.value))}
                    >
                        <option value="All">Full Season</option>
                        <option value="5">Last 5</option>
                        <option value="10">Last 10</option>
                        <option value="20">Last 20</option>
                    </select>
                </div>
            </div>

            {/* Table Container */}
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-neutral-950 text-xs text-neutral-400 font-bold uppercase tracking-wider">
                            <th className="p-3 sticky left-0 bg-neutral-950 z-10 border-b border-neutral-800 min-w-[200px]">Team</th>
                            <SortHeader label="GP" id="gp" sortKey={sortKey} sortDesc={sortDesc} onSort={handleSort} />
                            <SortHeader label="W" id="wins" sortKey={sortKey} sortDesc={sortDesc} onSort={handleSort} />
                            <SortHeader label="L" id="losses" sortKey={sortKey} sortDesc={sortDesc} onSort={handleSort} />
                            <SortHeader label="OTL" id="otl" sortKey={sortKey} sortDesc={sortDesc} onSort={handleSort} />
                            <SortHeader label="PTS" id="points" sortKey={sortKey} sortDesc={sortDesc} onSort={handleSort} />
                            <SortHeader label="P%" id="pt_pct" sortKey={sortKey} sortDesc={sortDesc} onSort={handleSort} />

                            <SortHeader label="GF/G" id="gf_per_game" sortKey={sortKey} sortDesc={sortDesc} onSort={handleSort} />
                            <SortHeader label="GA/G" id="ga_per_game" sortKey={sortKey} sortDesc={sortDesc} onSort={handleSort} />

                            <SortHeader label="PP%" id="pp_pct" sortKey={sortKey} sortDesc={sortDesc} onSort={handleSort} />
                            <SortHeader label="PK%" id="pk_pct" sortKey={sortKey} sortDesc={sortDesc} onSort={handleSort} />
                            <SortHeader label="PP Time" id="pp_time_per_game" sortKey={sortKey} sortDesc={sortDesc} onSort={handleSort} />

                            <SortHeader label="SF/G" id="sf_per_game" sortKey={sortKey} sortDesc={sortDesc} onSort={handleSort} />
                            <SortHeader label="SA/G" id="sa_per_game" sortKey={sortKey} sortDesc={sortDesc} onSort={handleSort} />
                            <SortHeader label="CF/G" id="cf_per_game" sortKey={sortKey} sortDesc={sortDesc} onSort={handleSort} />

                            <SortHeader label="xGF" id="xg_for" sortKey={sortKey} sortDesc={sortDesc} onSort={handleSort} />
                            <SortHeader label="xGA" id="xg_against" sortKey={sortKey} sortDesc={sortDesc} onSort={handleSort} />
                            <SortHeader label="xGF%" id="xg_for_pct" sortKey={sortKey} sortDesc={sortDesc} onSort={handleSort} />

                            <SortHeader label="xGF% 5v5" id="xg_for_pct_5v5" sortKey={sortKey} sortDesc={sortDesc} onSort={handleSort} />
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-800 text-sm font-medium">
                        {sortedData.map((row, i) => (
                            <tr key={row.team} className="group hover:bg-neutral-800/50 transition-colors">
                                <td className="p-3 sticky left-0 bg-neutral-900 group-hover:bg-neutral-800 border-r border-neutral-800 flex items-center gap-3">
                                    <div className="w-8 h-8 relative flex-shrink-0">
                                        <Image src={row.logoUrl} alt={row.team} fill className="object-contain" />
                                    </div>
                                    <span className="text-white font-bold">{row.team}</span>
                                </td>
                                <td className="p-3 text-neutral-300">{row.gp}</td>
                                <td className="p-3 text-white">{row.wins}</td>
                                <td className="p-3 text-neutral-400">{row.losses}</td>
                                <td className="p-3 text-neutral-400">{row.otl}</td>
                                <td className="p-3 text-cyan-400 font-bold">{row.points}</td>
                                <td className="p-3 text-neutral-300">{formatPct(row.pt_pct)}</td>

                                <td className="p-3 text-neutral-300">{formatDec(row.gf_per_game, 2)}</td>
                                <td className="p-3 text-neutral-300">{formatDec(row.ga_per_game, 2)}</td>

                                <td className="p-3 text-blue-400">{formatPct(row.pp_pct)}</td>
                                <td className="p-3 text-red-400">{formatPct(row.pk_pct)}</td>
                                <td className="p-3 text-neutral-400 text-xs">{row.pp_time_per_game}</td>

                                <td className="p-3 text-neutral-300">{formatDec(row.sf_per_game, 1)}</td>
                                <td className="p-3 text-neutral-300">{formatDec(row.sa_per_game, 1)}</td>
                                <td className="p-3 text-neutral-400">{formatDec(row.cf_per_game, 1)}</td>

                                <td className="p-3 text-neutral-400">{formatDec(row.xg_for, 1)}</td>
                                <td className="p-3 text-neutral-400">{formatDec(row.xg_against, 1)}</td>
                                <td className={`p-3 font-bold ${row.xg_for_pct >= 0.5 ? 'text-green-400' : 'text-orange-400'}`}>
                                    {formatPct(row.xg_for_pct)}
                                </td>

                                <td className="p-3 text-neutral-300">{formatPct(row.xg_for_pct_5v5)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const SortHeader = ({ label, id, sortKey, sortDesc, onSort }: {
    label: string, id: SortKey, sortKey: SortKey, sortDesc: boolean, onSort: (k: SortKey) => void
}) => {
    const active = sortKey === id;
    return (
        <th
            className={`p-3 cursor-pointer hover:text-white transition-colors select-none whitespace-nowrap ${active ? 'text-cyan-400' : ''}`}
            onClick={() => onSort(id)}
        >
            <div className="flex items-center gap-1">
                {label}
                {active && (
                    <span className="text-[10px]">{sortDesc ? '▼' : '▲'}</span>
                )}
            </div>
        </th>
    );
};

export default TeamsTable;
