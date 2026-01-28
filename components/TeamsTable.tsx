"use client";

import React, { useState, useEffect, useMemo } from 'react';
import Papa from 'papaparse';
import Image from 'next/image';
import Link from 'next/link';

interface TeamInfo {
    name: string;
    commonName: string;
    logoUrl: string;
    color: string;
    tricode: string;
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
    attempts_for_5v5: string; // CF 5v5
    attempts_ag_5v5: string; // CA 5v5

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

    starting_goalie: string;
    starting_goalie_opp: string;
    saves_for: string;
    emptynet_goalsfor: string;
    emptynet_goalsagainst: string;
    en_attempts_for: string;
    en_attempts_against: string;
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
    goal_diff: number;

    true_gf_per_game: number;
    true_ga_per_game: number;
    total_goals_per_game: number;

    pp_goals: number;
    pp_opps: number;
    pp_pct: number;
    pp_lev: number;
    pp_time_per_game: string; // Formatted mm:ss
    pp_time_per_goal: string; // Formatted mm:ss (Time per PP Goal)

    pk_goals_allowed: number;
    pk_opps: number;
    pk_pct: number;
    pk_lev: number;
    pk_time_per_game: string; // Formatted mm:ss
    pk_time_per_goal_allowed: string; // Formatted mm:ss (Time per PK Goal Allowed)

    sf_per_game: number;
    sa_per_game: number;

    cf_per_game: number; // Attempts For
    ca_per_game: number; // Attempts Against

    sh_pct: number;
    sv_pct: number;

    engf: number;
    enga: number;
    en_attempts: number;
    ens_pct: number;

    xgf_per_game: number;
    xga_per_game: number;
    xgf_pct: number;

    gsax: number; // Goals Saved Above Expected (xGA - GA)
    otml: number; // Off the Mat Losses
    starterName?: string;
    starterStatus?: string;
}

interface Matchup {
    home: string;
    away: string;
    homeStarter?: string;
    homeStarterStatus?: string;
    awayStarter?: string;
    awayStarterStatus?: string;
}

type SortKey = keyof TeamStat;
type ViewMode = 'All' | 'PlayingToday' | 'PlayingTodayLocation' | 'PlayingTodayStarter' | 'PlayingTodayLocationStarter';

const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const getTimeSeconds = (timeStr: string) => {
    const [m, s] = timeStr.split(':').map(Number);
    return m * 60 + s;
};

const cleanName = (name: string) => {
    if (!name) return '';
    return name.replace(/\s*\(.*?\)\s*/g, '').trim();
};

const getStarterStatus = (name: string) => {
    if (!name) return 'UNCONFIRMED';
    const match = name.match(/\((.*?)\)$/);
    return match ? match[1] : 'UNCONFIRMED';
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

const formatStarterName = (name?: string) => {
    if (!name) return '';
    const parts = name.trim().split(' ');
    if (parts.length < 2) return name;
    // Handle names like "Casey DeSmith" -> "C. DeSmith"
    return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
};

const calculateTeamStats = (teamName: string, teamGames: RawGameStat[]): TeamStat => {
    if (teamGames.length === 0) {
        // Return zeroed stats
        return {
            team: teamName, gp: 0, wins: 0, losses: 0, otl: 0, points: 0, pt_pct: 0,
            gf_per_game: 0, ga_per_game: 0, goal_diff: 0,
            true_gf_per_game: 0, true_ga_per_game: 0, total_goals_per_game: 0,
            pp_goals: 0, pp_opps: 0, pp_pct: 0, pp_lev: 0, pp_time_per_game: '0:00', pp_time_per_goal: '0:00',
            pk_goals_allowed: 0, pk_opps: 0, pk_pct: 0, pk_lev: 0, pk_time_per_game: '0:00', pk_time_per_goal_allowed: '0:00',
            sf_per_game: 0, sa_per_game: 0, cf_per_game: 0, ca_per_game: 0, sh_pct: 0, sv_pct: 0,

            engf: 0, enga: 0, en_attempts: 0, ens_pct: 0, xgf_per_game: 0, xga_per_game: 0, xgf_pct: 0, gsax: 0, otml: 0
        };
    }

    let gp = 0, wins = 0, losses = 0, otl = 0;
    let gf = 0, ga = 0;
    let pp_goals = 0, pp_opps = 0, pp_time = 0;
    let pk_goals_allowed = 0, pk_opps = 0, pk_time = 0;
    let sf = 0, sa = 0;
    let cf = 0, ca = 0;
    let saves = 0;
    let engf = 0, enga = 0;
    let en_attempts = 0;
    let xgf = 0, xga = 0;
    let otml = 0;

    teamGames.forEach(g => {
        gp++;
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

        cf += parseFloat(g.attempts_for_5v5 || '0');
        ca += parseFloat(g.attempts_ag_5v5 || '0');

        saves += parseFloat(g.saves_for || '0');

        engf += parseFloat(g.emptynet_goalsfor || '0');
        enga += parseFloat(g.emptynet_goalsagainst || '0');
        en_attempts += parseFloat(g.en_attempts_for || '0');

        xgf += parseFloat(g.xG_for || '0');
        xga += parseFloat(g.xG_against || '0');

        // OtmL Logic: EN Att > 0 AND EN GF < 1 AND Result is Loss (RL, OTL, SOL)
        const g_en_attempts = parseFloat(g.en_attempts_for || '0');
        const g_en_goals = parseFloat(g.emptynet_goalsfor || '0');
        if (g_en_attempts > 0 && g_en_goals < 1 && (g.result === 'RL' || g.result === 'OTL' || g.result === 'SOL')) {
            otml++;
        }
    });

    const points = wins * 2 + otl;

    // Calculations for new stats
    const true_gf = gf - pp_goals - engf;
    const true_ga = ga - pk_goals_allowed - enga;

    // PP Time Per Goal (Lower is Better)
    const pp_sec_per_goal = pp_goals > 0 ? (pp_time / pp_goals) : 0;

    // PK Time Per Goal Allowed (Higher is Better)
    const pk_sec_per_ga = pk_goals_allowed > 0 ? (pk_time / pk_goals_allowed) : 0;

    return {
        team: teamName,
        gp,
        wins,
        losses,
        otl,
        points,
        pt_pct: points / (gp * 2),

        gf_per_game: gf / gp,
        ga_per_game: ga / gp,
        goal_diff: gf - ga,

        true_gf_per_game: true_gf / gp,
        true_ga_per_game: true_ga / gp,
        total_goals_per_game: (gf + ga) / gp,

        pp_goals,
        pp_opps,
        pp_pct: pp_opps > 0 ? (pp_goals / pp_opps) * 100 : 0,
        pp_lev: gf > 0 ? (pp_goals / gf) * 100 : 0,
        pp_time_per_game: formatTime(pp_time / gp),
        pp_time_per_goal: pp_goals > 0 ? formatTime(pp_sec_per_goal) : (pp_opps > 0 ? 'Inf' : '-'),

        pk_goals_allowed,
        pk_opps,
        pk_pct: pk_opps > 0 ? ((pk_opps - pk_goals_allowed) / pk_opps) * 100 : 0,
        pk_lev: ga > 0 ? (pk_goals_allowed / ga) * 100 : 0,
        pk_time_per_game: formatTime(pk_time / gp),
        pk_time_per_goal_allowed: pk_goals_allowed > 0 ? formatTime(pk_sec_per_ga) : (pk_opps > 0 ? 'Perfect' : '-'),

        sf_per_game: sf / gp,
        sa_per_game: sa / gp,

        cf_per_game: cf / gp,
        ca_per_game: ca / gp,

        sh_pct: sf > 0 ? (gf / sf) * 100 : 0,
        sv_pct: (sa - enga) > 0 ? (saves / (sa - enga)) * 100 : 0,

        engf,

        enga,
        en_attempts,
        ens_pct: en_attempts > 0 ? (engf / en_attempts) * 100 : 0,

        xgf_per_game: xgf / gp,
        xga_per_game: xga / gp,
        xgf_pct: (xgf + xga) > 0 ? (xgf / (xgf + xga)) * 100 : 0,
        otml,
        gsax: xga - (ga - enga) // Cumulative GSAx (Excluding EN Goals)
    };
};

const TeamsTable = () => {
    const [stats, setStats] = useState<TeamStat[]>([]);
    const [leagueStats, setLeagueStats] = useState<TeamStat[]>([]); // For consistent ranges
    const [loading, setLoading] = useState(true);
    const [teams, setTeams] = useState<Record<string, TeamInfo>>({});

    // Filters
    const [viewMode, setViewMode] = useState<ViewMode>('All');
    const [filterHomeAway, setFilterHomeAway] = useState<'All' | 'Home' | 'Away'>('All');
    const [filterLastN, setFilterLastN] = useState<number | 'All'>('All');

    // Sorting
    const [sortKey, setSortKey] = useState<SortKey>('pt_pct');
    const [sortDesc, setSortDesc] = useState(true);

    const [rawData, setRawData] = useState<RawGameStat[]>([]);
    const [todayMatchups, setTodayMatchups] = useState<Matchup[]>([]);

    // Groups for Desktop headers and Mobile filtering
    const STAT_GROUPS = useMemo(() => [
        { name: 'Record', columns: ['gp', 'wins', 'losses', 'otl', 'points', 'pt_pct'] },
        { name: 'Goals', columns: ['gf_per_game', 'ga_per_game', 'goal_diff', 'true_gf_per_game', 'true_ga_per_game', 'total_goals_per_game'] },
        { name: 'PP', columns: ['pp_goals', 'pp_opps', 'pp_pct', 'pp_lev', 'pp_time_per_game', 'pp_time_per_goal'] },
        { name: 'PK', columns: ['pk_goals_allowed', 'pk_opps', 'pk_pct', 'pk_lev', 'pk_time_per_game', 'pk_time_per_goal_allowed'] },
        { name: 'Shots', columns: ['sf_per_game', 'sa_per_game', 'cf_per_game', 'ca_per_game', 'sh_pct'] },
        { name: 'Saves', columns: ['sv_pct', 'gsax'] },
        { name: 'xGoals', columns: ['xgf_per_game', 'xga_per_game', 'xgf_pct'] },
        { name: 'Empty Net', columns: ['engf', 'en_attempts', 'ens_pct', 'otml', 'enga'] },
    ], []);

    const [activeCategory, setActiveCategory] = useState(STAT_GROUPS[0].name);

    const COLUMNS = useMemo(() => [
        { k: 'gp', l: 'GP' },
        { k: 'wins', l: 'W' },
        { k: 'losses', l: 'L' },
        { k: 'otl', l: 'OT' },
        { k: 'points', l: 'PTS' },
        { k: 'pt_pct', l: 'P%' },
        { k: 'gf_per_game', l: 'GF/G' },
        { k: 'ga_per_game', l: 'GA/G', inv: true },
        { k: 'goal_diff', l: 'GΔ' },
        { k: 'true_gf_per_game', l: 'TruGF' },
        { k: 'true_ga_per_game', l: 'TruGA', inv: true },
        { k: 'total_goals_per_game', l: 'TotG/G' },
        { k: 'pp_goals', l: 'PPG' },
        { k: 'pp_opps', l: 'PP Opp' },
        { k: 'pp_pct', l: 'PP%' },
        { k: 'pp_lev', l: 'PPLev' },
        { k: 'pp_time_per_game', l: 'PP T/GP', isTime: true },
        { k: 'pp_time_per_goal', l: 'PP T/G', isTime: true, inv: true },
        { k: 'pk_goals_allowed', l: 'PPGA', inv: true },
        { k: 'pk_opps', l: 'PK Opp' },
        { k: 'pk_pct', l: 'PK%' },
        { k: 'pk_lev', l: 'PKLev', inv: true },
        { k: 'pk_time_per_game', l: 'PK T/GP', isTime: true, inv: true },
        { k: 'pk_time_per_goal_allowed', l: 'PK T/GA', isTime: true },
        { k: 'sf_per_game', l: 'SF/G' },
        { k: 'sa_per_game', l: 'SA/G', inv: true },
        { k: 'cf_per_game', l: 'CF/G' },
        { k: 'ca_per_game', l: 'CA/G', inv: true },
        { k: 'sh_pct', l: 'Sh%' },
        { k: 'sv_pct', l: 'Sv%' },
        { k: 'gsax', l: 'GSAx' },
        { k: 'xgf_per_game', l: 'xGF/G' },
        { k: 'xga_per_game', l: 'xGA/G', inv: true },
        { k: 'xgf_pct', l: 'xGF%' },
        { k: 'engf', l: 'EN GF' },
        { k: 'en_attempts', l: 'EN Att' },
        { k: 'ens_pct', l: 'ENS%' },
        { k: 'otml', l: 'OtmL', inv: true },
        { k: 'enga', l: 'EN GA', inv: true }
    ], []);



    useEffect(() => {
        const initLoad = async () => {
            try {
                const t = new Date().getTime();
                const [statsRes, teamsRes, predsRes] = await Promise.all([
                    fetch(`/data/gamestats.csv?t=${t}`),
                    fetch(`/data/nhl_teams.csv?t=${t}`),
                    fetch(`/data/predictions_detailed.csv?t=${t}`)
                ]);

                const statsText = await statsRes.text();
                const teamsText = await teamsRes.text();

                // Parse Teams Meta
                const teamsMeta: Record<string, TeamInfo> = {};
                Papa.parse(teamsText, {
                    header: true,
                    skipEmptyLines: true,
                    transformHeader: (h) => h.trim(),
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    complete: (results: Papa.ParseResult<any>) => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        results.data.forEach((row: any) => {
                            if (row['Common Name']) {
                                teamsMeta[row['Common Name'].trim()] = {
                                    name: row['Team Name'],
                                    commonName: row['Common Name'].trim(),
                                    logoUrl: row['Team Logo URL'],
                                    color: row['Hex Color 1'],
                                    tricode: row['Team Tricode']
                                };
                            }
                        });
                        setTeams(teamsMeta);
                    }
                });

                // Parse Game Stats
                const parsedStats = Papa.parse(statsText, {
                    header: true,
                    skipEmptyLines: true,
                    transformHeader: (h) => h.trim()
                }).data as RawGameStat[];
                setRawData(parsedStats);

                // Parse Predictions (Today's Games) - Only if file exists/loads
                if (predsRes.ok) {
                    const predsText = await predsRes.text();
                    console.log("Predictions CSV loaded, length:", predsText.length);
                    const parsedPreds = Papa.parse(predsText, {
                        header: true,
                        skipEmptyLines: true,
                        transformHeader: (h) => h.trim()
                    }).data as Record<string, string>[];

                    console.log("Parsed Predictions Rows:", parsedPreds.length);

                    // Get today's date in YYYY-MM-DD (US/Central Time to match backend)
                    const today = new Date();
                    const formatter = new Intl.DateTimeFormat('en-CA', {
                        timeZone: 'America/Chicago',
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit'
                    });
                    const todayStr = formatter.format(today);

                    console.log("Filtering for today (America/Chicago):", todayStr);

                    const matchups: Matchup[] = parsedPreds
                        .filter((row: Record<string, string>) => row.game_date === todayStr)
                        .map((row: Record<string, string>) => ({
                            home: row.home_team?.trim(),
                            away: row.away_team?.trim(),
                            homeStarter: cleanName(row.home_starter),
                            homeStarterStatus: getStarterStatus(row.home_starter),
                            awayStarter: cleanName(row.away_starter),
                            awayStarterStatus: getStarterStatus(row.away_starter)
                        }))
                        .filter(m => m.home && m.away);

                    console.log("Valid Matchups:", matchups);
                    setTodayMatchups(matchups);
                } else {
                    console.error("Could not load predictions_detailed.csv", predsRes.status, predsRes.statusText);
                }

            } catch (err) {
                console.error("Failed to load data", err);
            } finally {
                setLoading(false);
            }
        };

        initLoad();
    }, []);


    // Process data when filters/mode change
    useEffect(() => {
        if (rawData.length === 0) return;

        // Helper to get filtered games for a team
        const getGames = (teamName: string, locationFilter: 'All' | 'Home' | 'Away', targetStarter?: string) => {
            let games = rawData.filter(g => g.team === teamName);

            // Apply Date Sort (descending) first so "Last N" takes most recent
            games.sort((a, b) => new Date(b.game_date).getTime() - new Date(a.game_date).getTime());

            // Apply Location
            if (locationFilter === 'Home') games = games.filter(g => g.home_away === 'Home');
            if (locationFilter === 'Away') games = games.filter(g => g.home_away === 'Away');

            // Apply Starter Filter (if provided)
            if (targetStarter) {
                games = games.filter(g => {
                    // Fuzzy match or exact match? Exact match after cleaning should be fine.
                    // But names in gamestats might be "J. Oettinger" or "Jake Oettinger".
                    // Let's assume gamestats has full names as seen in checking (e.g. "Sergei Bobrovsky").
                    return g.starting_goalie === targetStarter;
                });
            }

            // Apply Last N (Always applies unless 'All')
            if (filterLastN !== 'All') {
                games = games.slice(0, filterLastN);
            }
            return games;
        };

        const processedTeams: TeamStat[] = [];

        // ALWAYS calculate league-wide stats for consistent ranges
        const allTeamsList = Array.from(new Set(rawData.map(g => g.team)));
        const leagueBaseline: TeamStat[] = [];
        allTeamsList.forEach(teamName => {
            const games = getGames(teamName, filterHomeAway); // Use current filters but for ALL teams
            if (games.length > 0) {
                leagueBaseline.push(calculateTeamStats(teamName, games));
            }
        });
        setLeagueStats(leagueBaseline);

        if (viewMode === 'All') {
            // Standard View - matches leagueBaseline 
            // (duplicate work technically but keeps logic clean if filters for baseline diverge later)
            processedTeams.push(...leagueBaseline);
        } else {
            // Playing Today Views (Force specific order: Away, Home, Away, Home...)
            todayMatchups.forEach(matchup => {
                const { home, away, homeStarter, awayStarter, homeStarterStatus, awayStarterStatus } = matchup;

                // Determine Location Filter based on Mode
                // If PlayingTodayLocation OR PlayingTodayLocationStarter, FORCE Home/Away.
                // Otherwise (PlayingToday, PlayingTodayStarter), use the user's manual filter (filterHomeAway).
                const isForcedLocation = viewMode === 'PlayingTodayLocation' || viewMode === 'PlayingTodayLocationStarter';

                const awayLoc = isForcedLocation ? 'Away' : filterHomeAway;
                const homeLoc = isForcedLocation ? 'Home' : filterHomeAway;

                // Determine Starter Filter
                const useStarter = viewMode === 'PlayingTodayStarter' || viewMode === 'PlayingTodayLocationStarter';

                const starterHome = useStarter ? homeStarter : undefined;
                const starterAway = useStarter ? awayStarter : undefined;

                // We still respect filterLastN if set by user
                const awayGames = getGames(away, awayLoc, starterAway);
                const homeGames = getGames(home, homeLoc, starterHome);

                // Calculate stats and attach starter name if applicable
                const awayStats = calculateTeamStats(away, awayGames);
                if (starterAway) {
                    awayStats.starterName = starterAway;
                    awayStats.starterStatus = awayStarterStatus;
                }
                processedTeams.push(awayStats);

                const homeStats = calculateTeamStats(home, homeGames);
                if (starterHome) {
                    homeStats.starterName = starterHome;
                    homeStats.starterStatus = homeStarterStatus;
                }
                processedTeams.push(homeStats);
            });
        }

        setStats(processedTeams);

    }, [rawData, viewMode, filterHomeAway, filterLastN, todayMatchups]);


    const handleSort = (key: SortKey) => {
        // Disable sorting in Matchup Filter modes to preserve pairing
        if (viewMode !== 'All') return;

        if (sortKey === key) {
            setSortDesc(!sortDesc);
        } else {
            setSortKey(key);
            setSortDesc(true); // Default to desc
        }
    };

    const sortedStats = useMemo(() => {
        // If in Playing Today modes, PRESERVE ORDER created in useEffect
        if (viewMode !== 'All') return stats;

        const sorted = [...stats];
        sorted.sort((a, b) => {
            const valA = a[sortKey];
            const valB = b[sortKey];

            // Special handling for time columns
            if (['pp_time_per_game', 'pk_time_per_game', 'pp_time_per_goal', 'pk_time_per_goal_allowed'].includes(sortKey)) {
                const getSeconds = (v: string | number) => {
                    if (v === 'Inf' || v === 'Perfect') return 999999;
                    if (v === '-') return -999999; // Always force '-' to bottom in Desc sort? 
                    // Actually, usually '-' means N/A. 
                    // If Desc (High to Low): Inf (Best/Worst) -> High Times -> Low Times -> - (N/A)
                    // If Asc (Low to High): - (N/A) -> Low Times -> High Times -> Inf
                    // Let's stick with -1 or a very low number to keep it consistent.
                    if (v === '-') return -1;
                    if (typeof v === 'string') return getTimeSeconds(v);
                    return 0;
                };

                const secA = getSeconds(valA as string);
                const secB = getSeconds(valB as string);
                return sortDesc ? secB - secA : secA - secB;
            }

            if (typeof valA === 'string' && typeof valB === 'string') {
                return sortDesc ? valB.localeCompare(valA) : valA.localeCompare(valB);
            }

            // Assume numbers
            return sortDesc
                ? (valB as number) - (valA as number)
                : (valA as number) - (valB as number);
        });
        return sorted;
    }, [stats, sortKey, sortDesc, viewMode]);

    // Calculate min/max for gradients (ALWAYS based on leagueStats for consistency)
    const ranges = useMemo(() => {
        const sourceStats = leagueStats.length > 0 ? leagueStats : stats;
        const calculateRange = (key: keyof TeamStat) => {
            if (sourceStats.length === 0) return { min: 0, max: 0 };
            const values = sourceStats.map(s => {
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
            goal_diff: calculateRange('goal_diff'),
            pp_goals: calculateRange('pp_goals'),
            pp_opps: calculateRange('pp_opps'),
            pk_goals_allowed: calculateRange('pk_goals_allowed'),
            pk_opps: calculateRange('pk_opps'),
            pp_pct: calculateRange('pp_pct'),
            pp_lev: calculateRange('pp_lev'),
            pk_pct: calculateRange('pk_pct'),
            pk_lev: calculateRange('pk_lev'),
            sf_per_game: calculateRange('sf_per_game'),
            sa_per_game: calculateRange('sa_per_game'),
            cf_per_game: calculateRange('cf_per_game'),
            ca_per_game: calculateRange('ca_per_game'),
            sh_pct: calculateRange('sh_pct'),
            sv_pct: calculateRange('sv_pct'),
            xgf_per_game: calculateRange('xgf_per_game'),
            xga_per_game: calculateRange('xga_per_game'),
            xgf_pct: calculateRange('xgf_pct'),

            true_gf_per_game: calculateRange('true_gf_per_game'),
            true_ga_per_game: calculateRange('true_ga_per_game'),
            total_goals_per_game: calculateRange('total_goals_per_game'),
            gsax: calculateRange('gsax'),
            otml: calculateRange('otml'),
            en_attempts: calculateRange('en_attempts'),
            ens_pct: calculateRange('ens_pct'),
        };
    }, [stats, leagueStats]);



    const timeRanges = useMemo(() => {
        const sourceStats = leagueStats.length > 0 ? leagueStats : stats;
        const zeroRange = { min: 0, max: 0 };
        if (sourceStats.length === 0) return { pp: zeroRange, pk: zeroRange, pp_goal: zeroRange, pk_goal: zeroRange };

        const ppTimes = sourceStats.map(s => getTimeSeconds(s.pp_time_per_game));
        const pkTimes = sourceStats.map(s => getTimeSeconds(s.pk_time_per_game));

        // Filter out Inf/Perfect/- for calculations
        const ppGoalTimes = sourceStats
            .map(s => s.pp_time_per_goal)
            .filter(t => t && t !== 'Inf' && t !== '-' && t !== 'Perfect')
            .map(t => getTimeSeconds(t as string));

        const pkGoalTimes = sourceStats
            .map(s => s.pk_time_per_goal_allowed)
            .filter(t => t && t !== 'Inf' && t !== '-' && t !== 'Perfect')
            .map(t => getTimeSeconds(t as string));

        return {
            pp: { min: Math.min(...ppTimes), max: Math.max(...ppTimes) },
            pk: { min: Math.min(...pkTimes), max: Math.max(...pkTimes) },
            pp_goal: ppGoalTimes.length ? { min: Math.min(...ppGoalTimes), max: Math.max(...ppGoalTimes) } : zeroRange,
            pk_goal: pkGoalTimes.length ? { min: Math.min(...pkGoalTimes), max: Math.max(...pkGoalTimes) } : zeroRange
        };
    }, [stats, leagueStats]);


    if (loading) return <div className="p-8 text-center bg-gray-900 border border-gray-800 rounded-xl text-gray-400">Loading Stats...</div>;

    // Helper for columns
    const renderCell = (team: TeamStat, key: keyof TeamStat, label?: string, isInverse: boolean = false, isTime: boolean = false, isGroupEnd: boolean = false, isHidden: boolean = false) => {
        // Handle 0 GP (First Start) -> Show Blank
        if (team.gp === 0) {
            return (
                <td className={`px-2 py-3 text-sm font-medium whitespace-nowrap text-center text-gray-600 ${isGroupEnd ? 'md:border-r md:border-gray-700/50' : ''} ${isHidden ? 'hidden md:table-cell' : 'table-cell'}`}>
                    —
                </td>
            );
        }

        let value = team[key];
        let color = '#DADADA'; // Default grey

        if (typeof value === 'number') {
            // Numbers
            const r = ranges[key as keyof typeof ranges];
            // Exclude specific columns from gradient coloring
            const noColorKeys = ['pp_goals', 'pp_opps', 'pk_goals_allowed', 'pk_opps'];

            if (r && !noColorKeys.includes(key)) {
                color = getGradientColor(value, r.min, r.max, isInverse);
            }
            // Format
            if (key === 'pt_pct') {
                value = (value as number).toFixed(3).replace(/^0+/, ''); // .650
            } else if (key === 'sv_pct') {
                value = ((value as number) / 100).toFixed(3).replace(/^0+/, ''); // .925
            } else if (key === 'pp_lev' || key === 'pk_lev') {
                value = (value as number).toFixed(1) + '%';
            } else if (key.toString().includes('pct')) {
                value = value.toFixed(1) + '%';
            } else if (['sf_per_game', 'sa_per_game', 'cf_per_game', 'ca_per_game'].includes(key)) {
                value = value.toFixed(1);
            } else if (key.toString().includes('per_game')) {
                value = value.toFixed(2);
            } else if (key === 'gsax') {
                // +#,##0.00;(#,##0.00);"E"
                const paramVal = value as number;
                if (Math.abs(paramVal) < 0.01) value = 'E';
                else if (paramVal > 0) value = '+' + paramVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                else value = '(' + Math.abs(paramVal).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ')';
            } else if (key === 'goal_diff') {
                // +#,##0;(#,##0);"E"
                const paramVal = value as number;
                if (Math.abs(paramVal) < 0.1) value = 'E'; // Treat 0 or near 0 as Even
                else if (paramVal > 0) value = '+' + Math.round(paramVal).toLocaleString();
                else value = '(' + Math.round(Math.abs(paramVal)).toLocaleString() + ')';
            }
        } else if (isTime) {
            // Time strings
            // Handle edge cases first!
            if (value === 'Inf' || value === 'Perfect' || value === '-') {
                color = value === 'Perfect' ? '#0083E7' : (value === 'Inf' ? '#FF44A5' : '#DADADA');
            } else {
                const seconds = getTimeSeconds(value as string);

                let r;
                if (key === 'pp_time_per_game') r = timeRanges.pp;
                else if (key === 'pk_time_per_game') r = timeRanges.pk;
                else if (key === 'pp_time_per_goal') r = timeRanges.pp_goal;
                else if (key === 'pk_time_per_goal_allowed') r = timeRanges.pk_goal;

                if (r) color = getGradientColor(seconds, r.min, r.max, isInverse);
            }
        }

        return (
            <td className={`px-2 py-3 text-sm font-medium whitespace-nowrap text-center ${isGroupEnd ? 'md:border-r md:border-gray-700/50' : ''} ${isHidden ? 'hidden md:table-cell' : 'table-cell'}`} style={{ color }}>
                {value}
            </td>
        );
    };

    const ButtonGroup = ({ options, current, onChange, labels }: { options: (string | number)[], current: string | number, onChange: (val: string | number) => void, labels?: string[] }) => (
        <div className="flex bg-gray-800 rounded-lg p-1 gap-1">
            {options.map((opt, idx) => (
                <button
                    key={opt}
                    onClick={() => onChange(opt)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${current === opt
                        ? 'bg-blue-600 text-white shadow-lg'
                        : 'text-gray-400 hover:text-white hover:bg-gray-700'
                        }`}
                >
                    {labels ? labels[idx] : (opt === 'All' ? 'All' : (typeof opt === 'number' ? `Last ${opt}` : opt))}
                </button>
            ))}
        </div>
    );

    return (
        <div className="w-full">
            {/* View Mode & Filters */}
            <div className="flex flex-col gap-4 mb-6">

                {/* Top Row: View Mode */}
                <div className="flex flex-col gap-2">
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">View Mode</label>
                    <ButtonGroup
                        options={['All', 'PlayingToday', 'PlayingTodayLocation', 'PlayingTodayStarter', 'PlayingTodayLocationStarter']}
                        labels={['All Teams', 'Playing Today', 'Playing Today w/ Location', 'Playing Today w/ Starter', 'Playing Today w/ Loc & Starter']}
                        current={viewMode}
                        onChange={(v) => setViewMode(v as ViewMode)}
                    />
                </div>

                {/* Bottom Row: Filters (Only manual filters) */}
                <div className="flex flex-row gap-4 items-center">
                    {/* Location Filter: Only show if NOT in PlayingTodayLocation/Starter(Location) mode (since those enforce location) */}
                    {viewMode !== 'PlayingTodayLocation' && viewMode !== 'PlayingTodayLocationStarter' && (
                        <div className="flex flex-col gap-2">
                            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Location</label>
                            <ButtonGroup
                                options={['All', 'Home', 'Away']}
                                current={filterHomeAway}
                                onChange={(v) => setFilterHomeAway(v as 'All' | 'Home' | 'Away')}
                            />
                        </div>
                    )}

                    <div className="flex flex-col gap-2">
                        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Recent</label>
                        <ButtonGroup
                            options={['All', 5, 10, 20]}
                            current={filterLastN}
                            onChange={(v) => setFilterLastN(v as number | 'All')}
                        />
                    </div>
                </div>
            </div>

            {/* Table */}
            <div className="flex flex-col gap-2 md:hidden mb-4">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Stat Category</label>
                <div className="flex flex-wrap gap-2">
                    {STAT_GROUPS.map(group => (
                        <button
                            key={group.name}
                            onClick={() => setActiveCategory(group.name)}
                            className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-tight rounded-full transition-all border ${activeCategory === group.name
                                ? 'bg-blue-600 border-blue-500 text-white shadow-lg'
                                : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
                                }`}
                        >
                            {group.name}
                        </button>
                    ))}
                </div>
            </div>

            <div className="overflow-x-auto bg-gray-900 border border-gray-800 rounded-xl shadow-2xl relative">
                <table className="w-full text-left border-collapse">
                    <thead>
                        {/* Desktop Group Headers */}
                        <tr className="hidden md:table-row bg-gray-950/50 border-b border-gray-800">
                            <th className="sticky left-0 bg-gray-950/50 z-40 border-r border-gray-800"></th>
                            {STAT_GROUPS.map(group => (
                                <th
                                    key={group.name}
                                    colSpan={group.columns.length}
                                    className="px-2 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-center text-blue-500/80 border-r border-gray-800/50"
                                >
                                    <span className="bg-blue-500/10 px-3 py-1 rounded-full border border-blue-500/20">
                                        {group.name}
                                    </span>
                                </th>
                            ))}
                        </tr>

                        <tr className="border-b border-gray-800 bg-gray-900/95 sticky top-0 z-30 backdrop-blur-sm shadow-sm text-xs uppercase tracking-wider text-gray-400">
                            <th className="px-2 py-3 font-semibold sticky left-0 bg-gray-900 z-40 shadow-[1px_0_0_0_rgba(255,255,255,0.1)]">Team</th>
                            {COLUMNS.map(({ k, l }) => {
                                // Determine if this is the last column in any group for vertical grid lines
                                const isGroupEnd = STAT_GROUPS.some(g => g.columns[g.columns.length - 1] === k);
                                const isInActiveCategory = STAT_GROUPS.find(g => g.name === activeCategory)?.columns.includes(k);

                                return (
                                    <th
                                        key={k}
                                        className={`px-2 py-3 font-semibold transition-colors text-center whitespace-nowrap ${viewMode === 'All' ? 'cursor-pointer hover:text-white' : 'cursor-default opacity-80'
                                            } ${isGroupEnd ? 'md:border-r md:border-gray-700/50' : ''} ${!isInActiveCategory ? 'hidden md:table-cell' : 'table-cell'}`}
                                        onClick={() => handleSort(k as SortKey)}
                                    >
                                        <div className="flex items-center justify-center gap-1">
                                            {l}
                                            {viewMode === 'All' && sortKey === k && (
                                                <span className="text-[10px] text-blue-400">{sortDesc ? '▼' : '▲'}</span>
                                            )}
                                        </div>
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800 text-sm">
                        {sortedStats.map((team, idx) => {
                            const meta = teams[team.team] || {};

                            // Determine row styling for Matchup Mode
                            let rowStyle = "hover:bg-gray-800/50 transition-colors";
                            if (viewMode !== 'All') {
                                // Add distinct separation after every 2nd row (end of matchup)
                                // except the last one
                                if ((idx + 1) % 2 === 0 && idx !== sortedStats.length - 1) {
                                    rowStyle += " border-b-[12px] border-black";
                                }
                            }

                            return (
                                <React.Fragment key={`${team.team}-${idx}`}>
                                    <tr className={rowStyle}>
                                        <td className="px-2 py-3 font-medium text-white sticky left-0 bg-gray-900 border-r border-gray-800 z-20">
                                            <div className="flex items-center justify-center md:justify-start gap-3">
                                                {viewMode === 'All' && <span className="text-gray-600 text-xs w-4 text-center md:text-left">{idx + 1}</span>}

                                                <Link href={`/teams/${meta.tricode || ''}`} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
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
                                                    <span
                                                        className={`truncate max-w-[120px] hidden md:block ${(viewMode === 'PlayingTodayStarter' || viewMode === 'PlayingTodayLocationStarter') && team.starterStatus
                                                            ? (team.starterStatus?.toUpperCase()?.includes('UNCONFIRMED') ? 'text-gray-500 font-bold'
                                                                : team.starterStatus?.toUpperCase()?.includes('CONFIRMED') ? 'text-neon-green font-bold'
                                                                    : team.starterStatus?.toUpperCase()?.includes('LIKELY') ? 'text-yellow-400 font-bold'
                                                                        : 'text-gray-500 font-bold')
                                                            : ''
                                                            }`}
                                                        title={meta.commonName || team.team}
                                                    >
                                                        {(viewMode === 'PlayingTodayStarter' || viewMode === 'PlayingTodayLocationStarter') && team.starterName
                                                            ? formatStarterName(team.starterName)
                                                            : (meta.commonName || team.team)}
                                                    </span>
                                                </Link>

                                                {/* Matchup visual indicator for Location Mode */}
                                                {(viewMode === 'PlayingTodayLocation' || viewMode === 'PlayingTodayLocationStarter') && (
                                                    <span className="text-[10px] font-bold text-gray-500 uppercase ml-2 bg-gray-800 px-1 rounded">
                                                        {idx % 2 === 0 ? 'AWAY' : 'HOME'}
                                                    </span>
                                                )}
                                            </div>
                                        </td>

                                        {COLUMNS.map(col => {
                                            const isGroupEnd = STAT_GROUPS.some(g => g.columns[g.columns.length - 1] === col.k);
                                            const isInActiveCategory = STAT_GROUPS.find(g => g.name === activeCategory)?.columns.includes(col.k);

                                            return (
                                                <React.Fragment key={col.k}>
                                                    {renderCell(team, col.k as keyof TeamStat, undefined, !!col.inv, !!col.isTime, isGroupEnd, !isInActiveCategory)}
                                                </React.Fragment>
                                            );
                                        })}
                                    </tr>

                                    {/* Spacer Row for Matchups */}
                                    {viewMode !== 'All' && (idx + 1) % 2 === 0 && idx !== sortedStats.length - 1 && (
                                        <tr>
                                            <td colSpan={100} className="h-4 bg-black border-none"></td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default TeamsTable;
