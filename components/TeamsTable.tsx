"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Papa from 'papaparse';
import Image from 'next/image';
import Link from 'next/link';

const DIVISION_MAPPING: Record<string, string> = {
    'BOS': 'Atlantic', 'BUF': 'Atlantic', 'DET': 'Atlantic', 'FLA': 'Atlantic',
    'MTL': 'Atlantic', 'OTT': 'Atlantic', 'TBL': 'Atlantic', 'TOR': 'Atlantic',
    'CAR': 'Metro', 'CBJ': 'Metro', 'NJD': 'Metro', 'NYI': 'Metro',
    'NYR': 'Metro', 'PHI': 'Metro', 'PIT': 'Metro', 'WSH': 'Metro',
    'CHI': 'Central', 'COL': 'Central', 'DAL': 'Central', 'MIN': 'Central',
    'NSH': 'Central', 'STL': 'Central', 'UTA': 'Central', 'WPG': 'Central',
    'ANA': 'Pacific', 'CGY': 'Pacific', 'EDM': 'Pacific', 'LAK': 'Pacific',
    'SEA': 'Pacific', 'SJS': 'Pacific', 'VAN': 'Pacific', 'VGK': 'Pacific'
};

interface TeamInfo {
    name: string;
    commonName: string;
    logoUrl: string;
    color: string;
    tricode: string;
    division?: string;
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
    hdf: string;
    hda: string;

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
    en_pp_goalsfor: string;
    en_pp_goalsagainst: string;
    en_attempts_for: string;
    en_attempts_against: string;

    time_leading: string;
    time_trailing: string;
    time_tied: string;
    control_score: string;
    scored_first?: string; // "1" or "0"
}

interface TeamStat {
    team: string;
    gp: number;
    wins: number;
    losses: number;
    otl: number;
    points: number;
    pt_pct: number;
    rw: number; // Regulation Wins (Tie breaker 1)
    row: number; // Regulation + OT Wins (Tie breaker 2)
    ranking?: string; // e.g. "A1", "WC1"
    isPlayoff?: boolean;

    gf_per_game: number;
    ga_per_game: number;
    goal_diff: number;
    true_goal_diff: number; // Total True Goal Diff

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

    hdf_per_game: number;
    hda_per_game: number;

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

    time_leading_per_game: number; // Avg seconds leading per game
    time_trailing_per_game: number; // Avg seconds trailing per game
    time_tied_per_game: number; // Avg seconds tied per game
    control_score: number; // Weighted game control score (avg over games)

    nlw: number; // No-Lead Wins: won with 0 seconds of time leading (never led)
    ntw: number; // No-Trail Wins: won with 0 seconds of time trailing (never trailed)
    ntl: number; // No-Trail Losses: lost with 0 seconds of time trailing (never trailed but lost)

    bl: number;       // Blown Leads (had any lead and lost)
    bl_3p: number;    // Blown 3rd Period Lead (leading after 2P and lost)
    bl_2plus: number; // Blown 2+ goal lead
    bl_3plus: number; // Blown 3+ goal lead
    cw: number;       // Comeback Wins (opponent had any lead and we won)
    cw_3p: number;    // 3rd Period Comeback (trailing after 2P and won)
    cw_2plus: number; // Comeback from 2+ goal deficit
    cw_3plus: number; // Comeback from 3+ goal deficit

    // Clinch / elimination tracking (set after standings are computed, optional)
    magic_number?: number;  // M#: playoff teams only. 0 = clinched.
    tragic_number?: number; // E#: non-playoff teams only. 0 = eliminated.
}

interface Matchup {
    home: string;
    away: string;
    homeStarter?: string;
    homeStarterStatus?: string;
    awayStarter?: string;
    awayStarterStatus?: string;
    homeVegasOdds?: number;
    awayVegasOdds?: number;
    homeModelOdds?: string;
    awayModelOdds?: string;
    homeEV?: number;
    awayEV?: number;
    homeXg?: number;
    awayXg?: number;
    recommendation?: string;
}

interface TeamOdds {
    vegasOdds?: number;
    modelOdds?: string;
    ev?: number;
    xg?: number;
    recommendation?: string;
    isRecommended?: boolean; // true only for the side the rec applies to
    logoUrl?: string;        // carried for tooltip rendering
    tricode?: string;        // carried for local SVG logo path
}

interface TeamRating {
    xgf_rating: number;
    xga_rating: number;
    xgf_rolling: number;
    xga_rolling: number;
    xgf_5v5_rating: number;
    xga_5v5_rating: number;
    pp_rating: number;
    pk_rating: number;
    penalties_drawn_per_60: number;
    penalties_taken_per_60: number;
    games_played: number;
}

interface LineupPlayer {
    id: string;
    name: string;
    number: string;
    pos: string;
    ppUnit: number;
    movement?: string;
}

interface TeamLineup {
    f1: LineupPlayer[];
    f2: LineupPlayer[];
    f3: LineupPlayer[];
    f4: LineupPlayer[];
    d1: LineupPlayer[];
    d2: LineupPlayer[];
    d3: LineupPlayer[];
}

interface PlayerImpactData {
    name: string;
    team: string;
    position: string;
    is_forward: boolean;
    ev_net_per60: number;
    ev_toi_per_game?: number;
    impact_score?: number;
    games_played?: number;
    rapm_off?: number;
    rapm_def?: number;
    rapm_net?: number;
}

interface GoalieRating {
    gsax_total: number;
    gsax_per_game: number;
    games_played: number;
}

type SortKey = keyof TeamStat;
type ViewBase = 'All' | 'PlayingToday' | 'PlayingTomorrow' | 'PlayoffMatchup';
type WithOption = 'Location' | 'Starter' | 'DayOfWeek';
type ViewMode = 'All' | 'PlayingToday' | 'PlayingTodayLocation' | 'PlayingTodayStarter' | 'PlayingTodayLocationStarter' | 'PlayingTomorrow' | 'PlayingTomorrowLocation' | 'PlayingTomorrowStarter' | 'PlayingTomorrowLocationStarter' | 'PlayoffMatchup' | 'PlayoffMatchupLocation' | 'PlayoffMatchupStarter' | 'PlayoffMatchupLocationStarter';

interface PlayoffConferenceBracket {
    conf: string;
    matchups: [TeamStat, TeamStat][]; // [higher seed, lower seed]
}
type ValuesMode = 'Stats' | 'Ratings';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const CONFERENCE_MAPPING: Record<string, string> = {
    'Atlantic': 'Eastern', 'Metro': 'Eastern',
    'Central': 'Western', 'Pacific': 'Western'
};

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

// Strip Unicode diacritics so "Tim Stützle" === "Tim Stutzle" (matches LineupGrid.normName)
const normName = (s: string) =>
    s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// Normalize to "LAST, F." for fuzzy goalie matching.
// Handles "Sam Montembeault" === "Samuel Montembeault" by comparing
// last name + first initial only.
const normalizeGoalieName = (name: string) => {
    const clean = cleanName(name).trim();
    const parts = clean.split(/\s+/);
    if (parts.length < 2) return clean.toLowerCase();
    const last = parts[parts.length - 1].toLowerCase();
    const firstInit = parts[0][0]?.toLowerCase() ?? '';
    return `${last},${firstInit}`;
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

const getLeverageGradientColor = (value: number, min: number, max: number) => {
    if (value === null || value === undefined || isNaN(value)) return 'inherit';
    if (max === min) return '#FFFFFF';

    let ratio = (value - min) / (max - min);
    if (ratio < 0) ratio = 0;
    if (ratio > 1) ratio = 1;

    // Low (#15DBE9) -> Mid (#FFFFFF) -> High (#FFF990)
    const low = { r: 21, g: 219, b: 233 };   // #15DBE9
    const mid = { r: 255, g: 255, b: 255 };  // #FFFFFF
    const high = { r: 255, g: 249, b: 144 }; // #FFF990

    let r, g, b;

    if (ratio < 0.5) {
        // 0 to 0.5 -> Low to Mid
        const subRatio = ratio * 2;
        r = Math.round(low.r + (mid.r - low.r) * subRatio);
        g = Math.round(low.g + (mid.g - low.g) * subRatio);
        b = Math.round(low.b + (mid.b - low.b) * subRatio);
    } else {
        // 0.5 to 1.0 -> Mid to High
        const subRatio = (ratio - 0.5) * 2;
        r = Math.round(mid.r + (high.r - mid.r) * subRatio);
        g = Math.round(mid.g + (high.g - mid.g) * subRatio);
        b = Math.round(mid.b + (high.b - mid.b) * subRatio);
    }

    return `rgb(${r}, ${g}, ${b})`;
};

// ── Clinch / Elimination Badge ─────────────────────────────────────────────
// Indicators from the NHL Standings API (clinchIndicator field):
//   p = Presidents' Trophy (best record in league)
//   z = Clinched Division
//   y = Clinched Conference
//   x = Clinched Playoff Spot
//   e = Eliminated
const CLINCH_BADGE_CONFIG: Record<string, { label: string; bg: string; text: string; title: string }> = {
    p: { label: 'P', bg: 'rgba(234,179,8,0.20)',   text: '#facc15', title: "Presidents' Trophy" },
    z: { label: 'Z', bg: 'rgba(16,185,129,0.22)',  text: '#34d399', title: 'Clinched Division' },
    y: { label: 'Y', bg: 'rgba(16,185,129,0.15)',  text: '#10b981', title: 'Clinched Conference' },
    x: { label: 'X', bg: 'rgba(59,130,246,0.20)',  text: '#60a5fa', title: 'Clinched Playoff Spot' },
    e: { label: 'E', bg: 'rgba(239,68,68,0.15)',   text: '#f87171', title: 'Eliminated' },
};

function ClinchBadge({ indicator }: { indicator: string }) {
    const cfg = CLINCH_BADGE_CONFIG[indicator.toLowerCase()];
    if (!cfg) return null;
    return (
        <span
            title={cfg.title}
            style={{ background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.text}40` }}
            className="inline-flex items-center justify-center w-4 h-4 rounded text-[9px] font-black shrink-0 leading-none"
        >
            {cfg.label}
        </span>
    );
}

const formatStarterName = (name?: string) => {
    if (!name) return '';
    const parts = name.trim().split(' ');
    if (parts.length < 2) return name;
    // Handle names like "Casey DeSmith" -> "C. DeSmith"
    return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
};

// ── Team Ratings View Mode ─────────────────────────────────────────────────
// Column definitions for the "Team Ratings" view (shown after the 8 Record cols)
const RATINGS_COLS = [
    // xG Ratings group
    { k: 'xgf_rating',    l: 'xGF Rtg',  desc: 'xG For Rating (EWMA-blended season + recent)',        inv: false, groupEnd: false },
    { k: 'xga_rating',    l: 'xGA Rtg',  desc: 'xG Against Rating (EWMA-blended season + recent)',     inv: true,  groupEnd: false },
    { k: 'xgf_rolling',   l: 'xGF Roll', desc: 'xG For Rolling Average (7-game half-life)',             inv: false, groupEnd: false },
    { k: 'xga_rolling',   l: 'xGA Roll', desc: 'xG Against Rolling Average (7-game half-life)',         inv: true,  groupEnd: false },
    { k: 'xgf_5v5',       l: 'xGF 5v5',  desc: 'xG For Rating at 5-on-5',                              inv: false, groupEnd: false },
    { k: 'xga_5v5',       l: 'xGA 5v5',  desc: 'xG Against Rating at 5-on-5',                          inv: true,  groupEnd: true  },
    // Lineup Impact group
    { k: 'lineup_rating', l: 'LINEUP',   desc: 'Total Lineup Impact — sum of impact_score for all 7 lines (F1–F4 + D1–D3) plus goalie impact', inv: false, groupEnd: false },
    { k: 'f1_impact',     l: 'F1',       desc: 'F1 Line Impact (sum of impact_score)',                  inv: false, groupEnd: false },
    { k: 'f2_impact',     l: 'F2',       desc: 'F2 Line Impact (sum of impact_score)',                  inv: false, groupEnd: false },
    { k: 'f3_impact',     l: 'F3',       desc: 'F3 Line Impact (sum of impact_score)',                  inv: false, groupEnd: false },
    { k: 'f4_impact',     l: 'F4',       desc: 'F4 Line Impact (sum of impact_score)',                  inv: false, groupEnd: false },
    { k: 'd1_impact',     l: 'D1',       desc: 'D1 Pair Impact (sum of impact_score)',                  inv: false, groupEnd: false },
    { k: 'd2_impact',     l: 'D2',       desc: 'D2 Pair Impact (sum of impact_score)',                  inv: false, groupEnd: false },
    { k: 'd3_impact',     l: 'D3',       desc: 'D3 Pair Impact (sum of impact_score)',                  inv: false, groupEnd: false },
    { k: 'f_impact',      l: 'F Tot',    desc: 'Total Forward Impact (F1+F2+F3+F4 impact_score)',       inv: false, groupEnd: false },
    { k: 'ftop6_impact',  l: 'FTop6',    desc: 'Top 6 Forward Impact (F1+F2 impact_score)',             inv: false, groupEnd: false },
    { k: 'fmid6_impact',  l: 'FMid6',    desc: 'Mid 6 Forward Impact (F2+F3 impact_score)',             inv: false, groupEnd: false },
    { k: 'fbot6_impact',  l: 'FBot6',    desc: 'Bottom 6 Forward Impact (F3+F4 impact_score)',          inv: false, groupEnd: false },
    { k: 'd_impact',      l: 'D Tot',    desc: 'Total Defense Impact (D1+D2+D3 impact_score)',          inv: false, groupEnd: false },
    { k: 'dtop4_impact',  l: 'DTop4',    desc: 'Top 4 Defense Impact (D1+D2 impact_score)',             inv: false, groupEnd: true  },
    // RAPM Lineup group
    { k: 'rapm_lineup',   l: 'RAPM Tot', desc: 'TOI-weighted Lineup RAPM — each player\'s isolated RAPM weighted by their EV ice time share (F1–F4 + D1–D3)', inv: false, groupEnd: false },
    { k: 'rapm_f',        l: 'F RAPM',   desc: 'TOI-weighted Forward RAPM — forwards\' isolated RAPM weighted by EV ice time share',                          inv: false, groupEnd: false },
    { k: 'rapm_d',        l: 'D RAPM',   desc: 'TOI-weighted Defense RAPM — defensemen\'s isolated RAPM weighted by EV ice time share',                        inv: false, groupEnd: true  },
    // Goalie group
    { k: 'goalie_impact', l: 'G Impact', desc: 'Goalie Impact (GSAx/G, sum of top-2 goalies by GP)',   inv: false, groupEnd: true  },
] as const;

const RATINGS_STAT_GROUPS = [
    { name: 'Record',         columns: ['ranking','gp','wins','losses','otl','points','pt_pct','rw'] },
    { name: 'xG Ratings',     columns: ['xgf_rating','xga_rating','xgf_rolling','xga_rolling','xgf_5v5','xga_5v5'] },
    { name: 'Lineup Impact',  columns: ['lineup_rating','f1_impact','f2_impact','f3_impact','f4_impact','d1_impact','d2_impact','d3_impact','f_impact','ftop6_impact','fmid6_impact','fbot6_impact','d_impact','dtop4_impact'] },
    { name: 'RAPM',           columns: ['rapm_lineup','rapm_f','rapm_d'] },
    { name: 'Goalie',         columns: ['goalie_impact'] },
];

// Default group names (at module scope so they can seed useState)
// Stats mode — all nine groups on by default
const DEFAULT_STAT_GROUP_NAMES = ['Record', 'Goals', 'PP', 'PK', 'Saves', 'Shots', 'xGoals', 'Game Situation', 'Empty Net'];
// Ratings mode — all five groups on by default
const DEFAULT_RATINGS_GROUP_NAMES = RATINGS_STAT_GROUPS.map(g => g.name);
// ──────────────────────────────────────────────────────────────────────────────

// Type for a single precomputed team-ratings entry (used by extractRatingValue)
type TeamRatingEntry = {
    ratings: TeamRating | null;
    lineImpacts: { f1: number; f2: number; f3: number; f4: number; d1: number; d2: number; d3: number };
    rapmImpacts: { f: number; d: number };
    goalieImpact: number;
};

// Pure helper: extracts a numeric value for the given RATINGS_COLS key from a
// precomputed entry. Used by both renderRatingCell and sortedStats.
const extractRatingValue = (entry: TeamRatingEntry | undefined, colKey: string): number => {
    if (!entry) return NaN;
    const { ratings: r, lineImpacts: li, goalieImpact } = entry;
    switch (colKey) {
        case 'xgf_rating':    return r?.xgf_rating     ?? NaN;
        case 'xga_rating':    return r?.xga_rating     ?? NaN;
        case 'xgf_rolling':   return r?.xgf_rolling    ?? NaN;
        case 'xga_rolling':   return r?.xga_rolling    ?? NaN;
        case 'xgf_5v5':       return r?.xgf_5v5_rating ?? NaN;
        case 'xga_5v5':       return r?.xga_5v5_rating ?? NaN;
        case 'lineup_rating': return li.f1+li.f2+li.f3+li.f4+li.d1+li.d2+li.d3+entry.goalieImpact;
        case 'f1_impact':     return li.f1;
        case 'f2_impact':     return li.f2;
        case 'f3_impact':     return li.f3;
        case 'f4_impact':     return li.f4;
        case 'd1_impact':     return li.d1;
        case 'd2_impact':     return li.d2;
        case 'd3_impact':     return li.d3;
        case 'f_impact':      return li.f1+li.f2+li.f3+li.f4;
        case 'ftop6_impact':  return li.f1+li.f2;
        case 'fmid6_impact':  return li.f2+li.f3;
        case 'fbot6_impact':  return li.f3+li.f4;
        case 'd_impact':      return li.d1+li.d2+li.d3;
        case 'dtop4_impact':  return li.d1+li.d2;
        case 'rapm_lineup':   return entry.rapmImpacts.f + entry.rapmImpacts.d;
        case 'rapm_f':        return entry.rapmImpacts.f;
        case 'rapm_d':        return entry.rapmImpacts.d;
        case 'goalie_impact': return goalieImpact;
        default:              return NaN;
    }
};

const RATINGS_KEYS = new Set<string>(RATINGS_COLS.map(c => c.k));

const calculateTeamStats = (teamName: string, teamGames: RawGameStat[], period: 'All' | '1st' | '2nd' | '3rd' | 'OT' = 'All'): TeamStat => {
    const pSuffix = period === 'All' ? '' : period === '1st' ? '_1P' : period === '2nd' ? '_2P' : period === '3rd' ? '_3P' : '_OT';
    // Access a period-specific column from a game row (falls back to '0' if missing)
    const pGet = (g: RawGameStat, fullCol: keyof RawGameStat, periodCol: string): number => {
        if (period === 'All') return parseFloat((g[fullCol] as string) || '0');
        return parseFloat(((g as unknown as Record<string, string>)[periodCol]) || '0');
    };

    if (teamGames.length === 0) {
        // Return zeroed stats
        return {
            team: teamName, gp: 0, wins: 0, losses: 0, otl: 0, points: 0, pt_pct: 0,
            gf_per_game: 0, ga_per_game: 0, goal_diff: 0, true_goal_diff: 0,
            true_gf_per_game: 0, true_ga_per_game: 0, total_goals_per_game: 0,
            pp_goals: 0, pp_opps: 0, pp_pct: 0, pp_lev: 0, pp_time_per_game: '0:00', pp_time_per_goal: '0:00',
            pk_goals_allowed: 0, pk_opps: 0, pk_pct: 0, pk_lev: 0, pk_time_per_game: '0:00', pk_time_per_goal_allowed: '0:00',
            sf_per_game: 0, sa_per_game: 0, cf_per_game: 0, ca_per_game: 0, hdf_per_game: 0, hda_per_game: 0, sh_pct: 0, sv_pct: 0,

            engf: 0, enga: 0, en_attempts: 0, ens_pct: 0, xgf_per_game: 0, xga_per_game: 0, xgf_pct: 0, gsax: 0, otml: 0, rw: 0, row: 0,
            time_leading_per_game: 0, time_trailing_per_game: 0, time_tied_per_game: 0, control_score: 1.0,
            nlw: 0, ntw: 0, ntl: 0,
            bl: 0, bl_3p: 0, bl_2plus: 0, bl_3plus: 0, cw: 0, cw_3p: 0, cw_2plus: 0, cw_3plus: 0,
        };
    }

    let gp = 0, wins = 0, losses = 0, otl = 0;
    let rw = 0, row = 0;
    let gf = 0, ga = 0;
    let pp_goals = 0, pp_opps = 0, pp_time = 0;
    let pk_goals_allowed = 0, pk_opps = 0, pk_time = 0;
    let sf = 0, sa = 0;
    let cf = 0, ca = 0;
    let hdf = 0, hda = 0;
    let saves = 0;
    let engf = 0, enga = 0;
    let en_pp_gf = 0, en_pp_ga = 0;
    let en_attempts = 0;
    let xgf = 0, xga = 0;
    let otml = 0;
    let time_leading = 0, time_trailing = 0, time_tied = 0;
    let control_score_sum = 0;
    let nlw = 0, ntw = 0, ntl = 0;
    let bl = 0, bl_3p = 0, bl_2plus = 0, bl_3plus = 0;
    let cw = 0, cw_3p = 0, cw_2plus = 0, cw_3plus = 0;

    teamGames.forEach(g => {
        gp++;
        if (g.result === 'RW' || g.result === 'OTW' || g.result === 'SOW') wins++;
        else if (g.result === 'RL') losses++;
        else otl++;

        if (g.result === 'RW') {
            rw++;
            row++;
        }
        if (g.result === 'OTW') {
            row++;
        }

        gf += pGet(g, 'goals_for', 'goals_for' + pSuffix);
        ga += pGet(g, 'goals_ag', 'goals_ag' + pSuffix);

        // PP/PK are full-game only (no per-period columns)
        pp_goals += parseFloat(g.pp_goals || '0');
        pp_opps += parseFloat(g.pp_opportunities || '0');
        pp_time += parseFloat(g.pp_time || '0');

        pk_goals_allowed += parseFloat(g.pp_goals_against || '0');
        pk_opps += parseFloat(g.pk_opportunities || '0');
        pk_time += parseFloat(g.pk_time || '0');

        sf += pGet(g, 'sog_for', 'sog_for' + pSuffix);
        sa += pGet(g, 'sog_ag', 'sog_ag' + pSuffix);

        // Period mode uses all-situation attempts (5v5 column not available per-period)
        cf += period === 'All' ? parseFloat(g.attempts_for_5v5 || '0') : pGet(g, 'attempts_for', 'attempts_for' + pSuffix);
        ca += period === 'All' ? parseFloat(g.attempts_ag_5v5 || '0') : pGet(g, 'attempts_ag', 'attempts_ag' + pSuffix);

        hdf += pGet(g, 'hdf', 'hdf' + pSuffix);
        hda += pGet(g, 'hda', 'hda' + pSuffix);

        // saves_for has no per-period column — use sa - ga as approximation in period mode
        if (period === 'All') {
            saves += parseFloat(g.saves_for || '0');
        } else {
            saves += Math.max(0, pGet(g, 'sog_ag', 'sog_ag' + pSuffix) - pGet(g, 'goals_ag', 'goals_ag' + pSuffix));
        }

        // EN stats are full-game only
        if (period === 'All') {
            engf += parseFloat(g.emptynet_goalsfor || '0');
            enga += parseFloat(g.emptynet_goalsagainst || '0');
            en_pp_gf += parseFloat(g.en_pp_goalsfor || '0');
            en_pp_ga += parseFloat(g.en_pp_goalsagainst || '0');
            en_attempts += parseFloat(g.en_attempts_for || '0');
        }

        xgf += pGet(g, 'xG_for', 'xg_for' + pSuffix);
        xga += pGet(g, 'xG_against', 'xg_ag' + pSuffix);

        // Time/control: per-period columns available for newly scraped games; fall back to full-game
        // NOTE: use || not ?? so empty strings ('') also fall back (parseFloat('') = NaN)
        const rawG = g as unknown as Record<string, string>;
        time_leading  += period === 'All' ? parseFloat(g.time_leading  || '0') : parseFloat(rawG['time_leading'  + pSuffix]  || g.time_leading  || '0');
        time_trailing += period === 'All' ? parseFloat(g.time_trailing || '0') : parseFloat(rawG['time_trailing' + pSuffix]  || g.time_trailing || '0');
        time_tied     += period === 'All' ? parseFloat(g.time_tied     || '0') : parseFloat(rawG['time_tied'     + pSuffix]  || g.time_tied     || '0');
        control_score_sum += period === 'All' ? parseFloat(g.control_score || '1') : parseFloat(rawG['control_score' + pSuffix] || g.control_score || '1');

        // OtmL Logic: EN Att > 0 AND EN GF < 1 AND Result is Loss (RL, OTL, SOL)
        const g_en_attempts = parseFloat(g.en_attempts_for || '0');
        const g_en_goals = parseFloat(g.emptynet_goalsfor || '0');
        if (g_en_attempts > 0 && g_en_goals < 1 && (g.result === 'RL' || g.result === 'OTL' || g.result === 'SOL')) {
            otml++;
        }

        // NLW / NTW / NTL: always full-game (score-state is cumulative over the game)
        const isWin  = g.result === 'RW' || g.result === 'OTW' || g.result === 'SOW';
        const isLoss = g.result === 'RL' || g.result === 'OTL' || g.result === 'SOL';
        const tLead  = parseFloat(g.time_leading  || '0');
        const tTrail = parseFloat(g.time_trailing || '0');
        if (isWin  && tLead  === 0) nlw++;
        if (isWin  && tTrail === 0) ntw++;
        if (isLoss && tTrail === 0) ntl++;

        // Blown Lead / Comeback tracking
        bl       += parseInt(rawG['blownlead_1'] || '0');
        bl_2plus += parseInt(rawG['blownlead_2'] || '0');
        bl_3plus += parseInt(rawG['blownlead_3+'] || '0');
        cw       += parseInt(rawG['comeback_1'] || '0');
        cw_2plus += parseInt(rawG['comeback_2'] || '0');
        cw_3plus += parseInt(rawG['comeback_3+'] || '0');

        // 3P variants: leading/trailing after 2 periods
        const gf_2p = parseFloat(rawG['goals_for_1P'] || '0') + parseFloat(rawG['goals_for_2P'] || '0');
        const ga_2p = parseFloat(rawG['goals_ag_1P'] || '0') + parseFloat(rawG['goals_ag_2P'] || '0');
        if (isLoss && gf_2p > ga_2p) bl_3p++;
        if (isWin  && gf_2p < ga_2p) cw_3p++;
    });

    const points = wins * 2 + otl;

    // Calculations for new stats
    // In period mode, PP/EN goals aren't available per-period, so true goals = raw goals
    // Remove PP goals and EN goals, but add back any EN goals that were already counted as PP (avoid double-subtract)
    const true_gf = period === 'All' ? gf - pp_goals - engf + en_pp_gf : gf;
    const true_ga = period === 'All' ? ga - pk_goals_allowed - enga + en_pp_ga : ga;

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
        rw,
        row,

        gf_per_game: gf / gp,
        ga_per_game: ga / gp,
        goal_diff: gf - ga,
        true_goal_diff: true_gf - true_ga,

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

        hdf_per_game: hdf / gp,
        hda_per_game: hda / gp,

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
        gsax: period === 'All' ? xga - (ga - enga) : xga - ga, // Cumulative GSAx

        time_leading_per_game: time_leading / gp,
        time_trailing_per_game: time_trailing / gp,
        time_tied_per_game: time_tied / gp,
        control_score: control_score_sum / gp,

        nlw, ntw, ntl,
        bl, bl_3p, bl_2plus, bl_3plus, cw, cw_3p, cw_2plus, cw_3plus,
    };
};

const TeamsTable = () => {
    const [stats, setStats] = useState<TeamStat[]>([]);
    const [leagueStats, setLeagueStats] = useState<TeamStat[]>([]); // For consistent ranges
    const [playoffBracket, setPlayoffBracket] = useState<PlayoffConferenceBracket[]>([]);
    const [loading, setLoading] = useState(true);
    const [teams, setTeams] = useState<Record<string, TeamInfo>>({});

    // Filters
    const [viewBase, setViewBase] = useState<ViewBase>('All');
    const [withOptions, setWithOptions] = useState<WithOption[]>([]);
    const [valuesMode, setValuesMode] = useState<ValuesMode>('Stats');
    const [filterHomeAway, setFilterHomeAway] = useState<'All' | 'Home' | 'Away'>('All');
    const [filterLastN, setFilterLastN] = useState<number | 'All' | 'Olympics' | 'Playoffs'>('All');
    const [filterPeriod, setFilterPeriod] = useState<'All' | '1st' | '2nd' | '3rd' | 'OT'>('All');
    const [filterPlayoff, setFilterPlayoff] = useState<'All' | 'Yes' | 'No'>('All');
    const [moreFiltersOpen, setMoreFiltersOpen] = useState(true);

    // Game-level stat filters (desktop only) — applied per-game before aggregating
    const [gameFilters, setGameFilters] = useState({
        ppg: 'All' as 'All' | 'Yes' | 'No',
        ppga: 'All' as 'All' | 'Yes' | 'No',
        scoringFirst: 'All' as 'All' | 'Yes' | 'No',
        minGf: '', maxGf: '',
        minGa: '', maxGa: '',
        minSf: '', maxSf: '',
        minSa: '', maxSa: '',
        minHdf: '', maxHdf: '',
        minHda: '', maxHda: '',
        minCf: '', maxCf: '',
        minCa: '', maxCa: '',
        minCorsiDiff: '', maxCorsiDiff: '',
        minXgDiff: '', maxXgDiff: '',
        minPpOpps: '', maxPpOpps: '',
        minPkOpps: '', maxPkOpps: '',
        minSvPct: '', maxSvPct: '',
        minShotDiff: '', maxShotDiff: '',
    });
    const setGF = (key: string, val: string) => setGameFilters(f => ({ ...f, [key]: val }));
    const [selectedDivisions, setSelectedDivisions] = useState<string[]>([]);

    // Sorting
    const [sortKey, setSortKey] = useState<string>('pt_pct');
    const [sortDesc, setSortDesc] = useState(true);
    const [flashKey, setFlashKey] = useState(0);

    const [rawData, setRawData] = useState<RawGameStat[]>([]);
    const [todayMatchups, setTodayMatchups] = useState<Matchup[]>([]);
    const [tomorrowMatchups, setTomorrowMatchups] = useState<Matchup[]>([]);

    // Team Ratings view mode data
    const [teamRatingsData, setTeamRatingsData] = useState<Record<string, TeamRating>>({});
    const [teamLineups, setTeamLineups] = useState<Record<string, TeamLineup>>({});
    const [playerImpact, setPlayerImpact] = useState<Record<string, PlayerImpactData>>({});
    const [goalieRatings, setGoalieRatings] = useState<Record<string, GoalieRating>>({});

    // Official clinch/elimination data from NHL API (keyed by team tricode)
    // Values: "p"=Presidents', "z"=Division, "y"=Conference, "x"=Playoff, "e"=Eliminated, null=competing
    const [clinchData, setClinchData] = useState<Record<string, string | null>>({});

    // Derive the legacy ViewMode string from the two new state variables
    // DayOfWeek is handled separately in getGames and does NOT affect ViewMode
    const viewMode = useMemo((): ViewMode => {
        if (viewBase === 'All') return 'All';
        const hasLoc = withOptions.includes('Location');
        const hasStar = withOptions.includes('Starter');
        const suffix = hasLoc && hasStar ? 'LocationStarter' : hasLoc ? 'Location' : hasStar ? 'Starter' : '';
        return `${viewBase}${suffix}` as ViewMode;
    }, [viewBase, withOptions]);

    // Returns the numeric day-of-week (0=Sun…6=Sat) for the target view
    const getTargetDayOfWeek = (vb: ViewBase): number => {
        const d = new Date();
        if (vb === 'PlayingTomorrow') d.setDate(d.getDate() + 1);
        return d.getDay();
    };

    const toggleWithOption = (opt: WithOption) => {
        setWithOptions(prev => prev.includes(opt) ? prev.filter(o => o !== opt) : [...prev, opt]);
    };

    // Fixed-position odds tooltip (floats over the table, doesn't affect layout)
    const [oddsTooltip, setOddsTooltip] = useState<{ x: number; y: number; data: TeamOdds } | null>(null);

    // Groups for Desktop headers and Mobile filtering
    // PP/PK are hidden when a period filter is active (no per-period PP/PK data)
    const STAT_GROUPS = useMemo(() => {
        const allGroups = [
            { name: 'Record', columns: ['ranking', 'gp', 'wins', 'losses', 'otl', 'points', 'pt_pct', 'rw'] },
            { name: 'Goals', columns: ['gf_per_game', 'ga_per_game', 'goal_diff', 'true_gf_per_game', 'true_ga_per_game', 'true_goal_diff', 'total_goals_per_game'] },
            { name: 'PP', columns: ['pp_goals', 'pp_opps', 'pp_pct', 'pp_lev', 'pp_time_per_game', 'pp_time_per_goal'] },
            { name: 'PK', columns: ['pk_goals_allowed', 'pk_opps', 'pk_pct', 'pk_lev', 'pk_time_per_game', 'pk_time_per_goal_allowed'] },
            { name: 'Saves', columns: ['sv_pct', 'gsax'] },
            { name: 'Shots', columns: ['sf_per_game', 'sa_per_game', 'cf_per_game', 'ca_per_game', 'hdf_per_game', 'hda_per_game', 'sh_pct'] },
            { name: 'xGoals', columns: ['xgf_per_game', 'xga_per_game', 'xgf_pct'] },
            { name: 'Game Situation', columns: filterPeriod === 'All'
                ? ['time_leading_per_game', 'time_trailing_per_game', 'time_tied_per_game', 'control_score', 'nlw', 'ntw', 'ntl']
                : ['time_leading_per_game', 'time_trailing_per_game', 'time_tied_per_game', 'control_score'] },
            ...(filterPeriod === 'All' ? [{ name: 'Leads & Comebacks', columns: ['bl', 'bl_3p', 'bl_2plus', 'bl_3plus', 'cw', 'cw_3p', 'cw_2plus', 'cw_3plus'] }] : []),
            { name: 'Empty Net', columns: ['engf', 'en_attempts', 'ens_pct', 'otml', 'enga'] },
        ];
        if (filterPeriod !== 'All') {
            return allGroups.filter(g => g.name !== 'PP' && g.name !== 'PK' && g.name !== 'Empty Net');
        }
        return allGroups;
    }, [filterPeriod]);

    const [activeGroups, setActiveGroups] = useState<string[]>(DEFAULT_STAT_GROUP_NAMES);

    // When valuesMode switches, reset active groups to all-on defaults for that mode
    useEffect(() => {
        setActiveGroups(valuesMode === 'Ratings' ? DEFAULT_RATINGS_GROUP_NAMES : DEFAULT_STAT_GROUP_NAMES);
    }, [valuesMode]);

    // Precomputed set of column keys whose group is currently active.
    // Used for conditional rendering (return null instead of CSS hidden) to avoid
    // table cell count mismatches that cause data/header misalignment.
    const activeColumnKeys = useMemo(() => {
        const currentGroups = valuesMode === 'Ratings' ? RATINGS_STAT_GROUPS : STAT_GROUPS;
        const keys = new Set<string>();
        currentGroups.forEach(g => {
            if (activeGroups.includes(g.name)) {
                (g.columns as readonly string[]).forEach(c => keys.add(c));
            }
        });
        return keys;
    }, [valuesMode, STAT_GROUPS, activeGroups]);

    // When filterPeriod hides PP/PK/Empty Net, remove them from activeGroups
    useEffect(() => {
        if (filterPeriod !== 'All') {
            setActiveGroups(prev => prev.filter(g => g !== 'PP' && g !== 'PK' && g !== 'Empty Net' && g !== 'Leads & Comebacks'));
        }
    }, [filterPeriod]);

    const toggleGroup = (name: string) => {
        setActiveGroups(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]);
    };

    // Load filters from sessionStorage on mount
    useEffect(() => {
        try {
            if (typeof window !== 'undefined') {
                const stored = sessionStorage.getItem('teamsTableFilters');
                if (stored) {
                    const parsed = JSON.parse(stored);
                    if (parsed.viewBase) setViewBase(parsed.viewBase);
                    if (parsed.withOptions) setWithOptions(parsed.withOptions);
                    if (parsed.valuesMode) setValuesMode(parsed.valuesMode);
                    if (parsed.filterHomeAway) setFilterHomeAway(parsed.filterHomeAway);
                    if (parsed.filterLastN) setFilterLastN(parsed.filterLastN);
                    if (parsed.filterPeriod) setFilterPeriod(parsed.filterPeriod);
                    if (parsed.filterPlayoff) setFilterPlayoff(parsed.filterPlayoff);
                    if (parsed.selectedDivisions) setSelectedDivisions(parsed.selectedDivisions);
                    if (parsed.sortKey) setSortKey(parsed.sortKey);
                    if (parsed.sortDesc !== undefined) setSortDesc(parsed.sortDesc);
                    if (parsed.activeGroups) setActiveGroups(parsed.activeGroups);
                    if (parsed.gameFilters) setGameFilters(parsed.gameFilters);
                }
            }
        } catch (e) {
            console.error('Failed to parse stored filters', e);
        }
    }, []);

    // Save filters to sessionStorage when they change
    useEffect(() => {
        try {
            if (typeof window !== 'undefined') {
                const filters = {
                    viewBase, withOptions, valuesMode, filterHomeAway, filterLastN, filterPeriod, filterPlayoff, selectedDivisions, sortKey, sortDesc, activeGroups, gameFilters
                };
                sessionStorage.setItem('teamsTableFilters', JSON.stringify(filters));
            }
        } catch (e) {
            console.error('Failed to save filters', e);
        }
    }, [viewBase, withOptions, valuesMode, filterHomeAway, filterLastN, filterPeriod, filterPlayoff, selectedDivisions, sortKey, sortDesc, activeGroups, gameFilters]);

    const COLUMNS = useMemo(() => [
        { k: 'ranking', l: 'Rank', desc: 'Projected Playoff Standing' },
        { k: 'gp', l: 'GP', desc: 'Games Played' },
        { k: 'wins', l: 'W', desc: 'Wins' },
        { k: 'losses', l: 'L', desc: 'Regulation Losses' },
        { k: 'otl', l: 'OT', desc: 'Overtime/Shootout Losses' },
        { k: 'points', l: 'PTS', desc: 'Points', calc: '2*W + OTL' },
        { k: 'pt_pct', l: 'P%', desc: 'Points Percentage', calc: 'PTS / (2 * GP)' },
        { k: 'rw', l: 'RW', desc: 'Regulation Wins' },
        { k: 'gf_per_game', l: 'GF/G', desc: 'Goals For Per Game' },
        { k: 'ga_per_game', l: 'GA/G', inv: true, desc: 'Goals Against Per Game' },
        { k: 'goal_diff', l: 'GΔ', desc: 'Goal Differential', calc: 'GF - GA' },
        { k: 'true_gf_per_game', l: 'TruGF', desc: 'True Goals For Per Game', calc: '(GF - PP Goals - EN Goals) / GP' },
        { k: 'true_ga_per_game', l: 'TruGA', inv: true, desc: 'True Goals Against Per Game', calc: '(GA - PP GA - EN GA) / GP' },
        { k: 'true_goal_diff', l: 'TruGΔ', desc: 'True Goal Differential', calc: 'True GF - True GA' },
        { k: 'total_goals_per_game', l: 'TotG/G', desc: 'Total Goals (For + Ag) Per Game', calc: '(GF + GA) / GP' },
        { k: 'pp_goals', l: 'PPG', desc: 'Power Play Goals' },
        { k: 'pp_opps', l: 'PP Opp', desc: 'Power Play Opportunities' },
        { k: 'pp_pct', l: 'PP%', desc: 'Power Play Percentage', calc: 'PP Goals / PP Opps' },
        { k: 'pp_lev', l: 'PPLev', inv: true, desc: 'Power Play Leverage', calc: '% of Team Goals scored on PP' },
        { k: 'pp_time_per_game', l: 'PP T/GP', isTime: true, desc: 'PP Time Per Game' },
        { k: 'pp_time_per_goal', l: 'PP T/G', isTime: true, inv: true, desc: 'PP Time Per PPG Scored' },
        { k: 'pk_goals_allowed', l: 'PPGA', inv: true, desc: 'Power Play Goals Against' },
        { k: 'pk_opps', l: 'PK Opp', desc: 'Penalty Kill Opportunities' },
        { k: 'pk_pct', l: 'PK%', desc: 'Penalty Kill Percentage', calc: 'Kills / PK Opps' },
        { k: 'pk_lev', l: 'PKLev', inv: true, desc: 'Penalty Kill Leverage', calc: '% of Goals Against allowed on PK' },
        { k: 'pk_time_per_game', l: 'PK T/GP', isTime: true, inv: true, desc: 'PK Time Per Game' },
        { k: 'pk_time_per_goal_allowed', l: 'PK T/GA', isTime: true, desc: 'PK Time Per PPG Allowed' },
        { k: 'sv_pct', l: 'Sv%', desc: 'Save Percentage', calc: 'Saves / (Shots Ag - EN GA)' },
        { k: 'gsax', l: 'GSAx', desc: 'Goals Saved Above Expected' },
        { k: 'sf_per_game', l: 'SF/G', desc: 'Shots For Per Game' },
        { k: 'sa_per_game', l: 'SA/G', inv: true, desc: 'Shots Against Per Game' },
        { k: 'cf_per_game', l: 'CF/G', desc: 'Corsi For Per Game' },
        { k: 'ca_per_game', l: 'CA/G', inv: true, desc: 'Corsi Against Per Game' },
        { k: 'hdf_per_game', l: 'HDF/G', desc: 'High Danger For Per Game' },
        { k: 'hda_per_game', l: 'HDA/G', inv: true, desc: 'High Danger Against Per Game' },
        { k: 'sh_pct', l: 'Sh%', desc: 'Shooting Percentage', calc: 'Goals / Shots' },
        { k: 'xgf_per_game', l: 'xGF/G', desc: 'Expected Goals For Per Game' },
        { k: 'xga_per_game', l: 'xGA/G', inv: true, desc: 'Expected Goals Against Per Game' },
        { k: 'xgf_pct', l: 'xGF%', desc: 'Expected Goals For %', calc: 'xGF / (xGF + xGA)' },
        { k: 'time_leading_per_game', l: 'T↑/G', desc: 'Avg Time Leading Per Game (mm:ss)' },
        { k: 'time_trailing_per_game', l: 'T↓/G', inv: true, desc: 'Avg Time Trailing Per Game (mm:ss)' },
        { k: 'time_tied_per_game', l: 'T=/G', desc: 'Avg Time Tied Per Game (mm:ss)' },
        { k: 'control_score', l: 'Control', desc: 'Weighted Game Control Score', calc: 'Σ(weight×second) / total seconds. Weights: tied=1, lead+1=1.2, lead+2=1.5, lead+3=2.0, trail-1=0.8, trail-2=0.5, trail-3=0' },
        { k: 'nlw', l: 'NLW', desc: 'No-Lead Wins: wins where time leading = 0:00 (came from behind or never led)' },
        { k: 'ntw', l: 'NTW', desc: 'No-Trail Wins: wins where time trailing = 0:00 (never trailed)' },
        { k: 'ntl', l: 'NTL', desc: 'No-Trail Losses: losses where time trailing = 0:00 (never trailed but still lost)', inv: true },
        { k: 'bl', l: 'BL', desc: 'Blown Leads: games where team had a lead and lost', inv: true },
        { k: 'bl_3p', l: 'BL(3P)', desc: 'Blown 3rd Period Lead: leading after 2 periods but lost', inv: true },
        { k: 'bl_2plus', l: 'BL(2+)', desc: 'Blown 2+ Goal Lead: had a 2+ goal lead and lost', inv: true },
        { k: 'bl_3plus', l: 'BL(3+)', desc: 'Blown 3+ Goal Lead: had a 3+ goal lead and lost', inv: true },
        { k: 'cw', l: 'CW', desc: 'Comeback Wins: opponent had a lead and team won' },
        { k: 'cw_3p', l: 'CW(3P)', desc: '3rd Period Comeback Win: trailing after 2 periods and won' },
        { k: 'cw_2plus', l: 'CW(2+)', desc: 'Comeback from 2+ Goal Deficit: opponent had 2+ goal lead and team won' },
        { k: 'cw_3plus', l: 'CW(3+)', desc: 'Comeback from 3+ Goal Deficit: opponent had 3+ goal lead and team won' },
        { k: 'engf', l: 'EN GF', desc: 'Empty Net Goals For' },
        { k: 'en_attempts', l: 'EN Att', desc: 'Empty Net Attempts (missed/blocked shots, icings, goals)' },
        { k: 'ens_pct', l: 'ENS%', desc: 'Empty Net Success %', calc: 'EN Goals / EN Attempts' },
        { k: 'otml', l: 'OtmL', inv: true, desc: 'Off-The-Mat Loss', calc: 'Losses with at least one EN Attempt' },
        { k: 'enga', l: 'EN GA', inv: true, desc: 'Empty Net Goals Against' }
    ], []);

    // Pre-compute all Team Ratings view values for every team
    const teamRatingsComputed = useMemo(() => {
        if (Object.keys(teams).length === 0) return {} as Record<string, TeamRatingEntry>;

        // Build goalie → game-count lookup from rawData (by team common name)
        const goalieGamesByTeam: Record<string, Record<string, number>> = {};
        rawData.filter(g => g.team && g.starting_goalie).forEach(g => {
            if (!goalieGamesByTeam[g.team]) goalieGamesByTeam[g.team] = {};
            const name = cleanName(g.starting_goalie);
            goalieGamesByTeam[g.team][name] = (goalieGamesByTeam[g.team][name] || 0) + 1;
        });

        // player_impact.json uses 7-digit NHL API IDs; team_lineups.json uses shorter IDs.
        // Build a name-based fallback map using normName (strips diacritics like ü→u)
        // so "Tim Stützle" (lineups) matches "Tim Stutzle" (player_impact).
        const impactByName = new Map<string, PlayerImpactData>();
        Object.values(playerImpact).forEach(p => {
            if (p.name) impactByName.set(normName(p.name), p);
        });

        const sumLineImpact = (players: LineupPlayer[]) =>
            (players ?? []).reduce((s, p) => {
                const byId = playerImpact[String(p.id)];
                const entry = byId ?? impactByName.get(normName(p.name ?? ''));
                return s + (entry?.impact_score ?? 0);
            }, 0);

        // TOI-weighted RAPM: each player's RAPM is weighted by their EV ice time
        // share so depth players with fluky RAPM don't inflate the total.
        const toiWeightedRapm = (players: LineupPlayer[]) => {
            const entries = (players ?? []).map(p => {
                const byId = playerImpact[String(p.id)];
                const entry = byId ?? impactByName.get(normName(p.name ?? ''));
                return { rapm: entry?.rapm_net ?? 0, toi: entry?.ev_toi_per_game ?? 0 };
            });
            const totalToi = entries.reduce((s, e) => s + e.toi, 0);
            if (totalToi === 0) return 0;
            return entries.reduce((s, e) => s + e.rapm * (e.toi / totalToi), 0) * entries.length;
        };

        const result: Record<string, TeamRatingEntry> = {};

        Object.entries(teams).forEach(([commonName, teamInfo]) => {
            const ratings = teamRatingsData[commonName] ?? null;
            const lineup = teamLineups[teamInfo.tricode];

            const lineImpacts = {
                f1: sumLineImpact(lineup?.f1 ?? []),
                f2: sumLineImpact(lineup?.f2 ?? []),
                f3: sumLineImpact(lineup?.f3 ?? []),
                f4: sumLineImpact(lineup?.f4 ?? []),
                d1: sumLineImpact(lineup?.d1 ?? []),
                d2: sumLineImpact(lineup?.d2 ?? []),
                d3: sumLineImpact(lineup?.d3 ?? []),
            };

            // Top-2 goalies for this team by games started
            const goalieGames = goalieGamesByTeam[commonName] ?? {};
            const top2 = Object.entries(goalieGames)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 2)
                .map(([name]) => name);

            const goalieImpact = top2.reduce((sum, name) => {
                let gr: GoalieRating | undefined = goalieRatings[name];
                if (!gr) {
                    const norm = normalizeGoalieName(name);
                    const found = Object.entries(goalieRatings).find(([k]) => normalizeGoalieName(k) === norm);
                    gr = found?.[1];
                }
                return sum + (gr?.gsax_per_game ?? 0);
            }, 0);

            const allF = [...(lineup?.f1 ?? []), ...(lineup?.f2 ?? []), ...(lineup?.f3 ?? []), ...(lineup?.f4 ?? [])];
            const allD = [...(lineup?.d1 ?? []), ...(lineup?.d2 ?? []), ...(lineup?.d3 ?? [])];
            const rapmImpacts = {
                f: toiWeightedRapm(allF),
                d: toiWeightedRapm(allD),
            };

            result[commonName] = { ratings, lineImpacts, rapmImpacts, goalieImpact };
        });
        return result;
    }, [teams, teamRatingsData, teamLineups, playerImpact, goalieRatings, rawData]);

    // Min/max ranges for gradient coloring of rating columns
    const ratingsRanges = useMemo(() => {
        const vals = Object.values(teamRatingsComputed);
        if (vals.length === 0) return null;
        const rng = (fn: (v: typeof vals[0]) => number) => {
            const nums = vals.map(fn).filter(n => isFinite(n));
            if (!nums.length) return { min: 0, max: 0 };
            return { min: Math.min(...nums), max: Math.max(...nums) };
        };
        return {
            xgf_rating:    rng(v => v.ratings?.xgf_rating    ?? NaN),
            xga_rating:    rng(v => v.ratings?.xga_rating    ?? NaN),
            xgf_rolling:   rng(v => v.ratings?.xgf_rolling   ?? NaN),
            xga_rolling:   rng(v => v.ratings?.xga_rolling   ?? NaN),
            xgf_5v5:       rng(v => v.ratings?.xgf_5v5_rating ?? NaN),
            xga_5v5:       rng(v => v.ratings?.xga_5v5_rating ?? NaN),
            lineup_rating: rng(v => { const li = v.lineImpacts; return li.f1+li.f2+li.f3+li.f4+li.d1+li.d2+li.d3+v.goalieImpact; }),
            f1_impact:     rng(v => v.lineImpacts.f1),
            f2_impact:     rng(v => v.lineImpacts.f2),
            f3_impact:     rng(v => v.lineImpacts.f3),
            f4_impact:     rng(v => v.lineImpacts.f4),
            d1_impact:     rng(v => v.lineImpacts.d1),
            d2_impact:     rng(v => v.lineImpacts.d2),
            d3_impact:     rng(v => v.lineImpacts.d3),
            f_impact:      rng(v => { const li = v.lineImpacts; return li.f1+li.f2+li.f3+li.f4; }),
            ftop6_impact:  rng(v => v.lineImpacts.f1 + v.lineImpacts.f2),
            fmid6_impact:  rng(v => v.lineImpacts.f2 + v.lineImpacts.f3),
            fbot6_impact:  rng(v => v.lineImpacts.f3 + v.lineImpacts.f4),
            d_impact:      rng(v => { const li = v.lineImpacts; return li.d1+li.d2+li.d3; }),
            dtop4_impact:  rng(v => v.lineImpacts.d1 + v.lineImpacts.d2),
            rapm_lineup:   rng(v => v.rapmImpacts.f + v.rapmImpacts.d),
            rapm_f:        rng(v => v.rapmImpacts.f),
            rapm_d:        rng(v => v.rapmImpacts.d),
            goalie_impact: rng(v => v.goalieImpact),
        };
    }, [teamRatingsComputed]);


    useEffect(() => {
        const initLoad = async () => {
            try {
                const t = new Date().getTime();
                const [statsRes, teamsRes, predsRes, ratingsRes, lineupsRes, impactRes, goalieRes, clinchRes] = await Promise.all([
                    fetch(`/data/gamestats.csv?t=${t}`),
                    fetch(`/data/nhl_teams.csv?t=${t}`),
                    fetch(`/data/predictions_detailed.csv?t=${t}`),
                    fetch(`/data/team_ratings.json?t=${t}`),
                    fetch(`/data/team_lineups.json?t=${t}`),
                    fetch(`/data/player_impact.json?t=${t}`),
                    fetch(`/data/goalie_ratings.json?t=${t}`),
                    fetch(`/data/clinch_status.json?t=${t}`)
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
                                    tricode: row['Team Tricode'],
                                    division: DIVISION_MAPPING[row['Team Tricode']]
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

                // Fix broken attempts_ag_5v5: the pipeline sometimes leaves it as 0
                // even though attempts_for_5v5 is correct. Derive it from the
                // opponent's for_5v5 in the same game (they are mirror images).
                const gameFor5v5 = new Map<string, Map<string, string>>(); // game_id → { team → for_5v5 }
                for (const row of parsedStats) {
                    if (!row.game_id || !row.team) continue;
                    if (!gameFor5v5.has(row.game_id)) gameFor5v5.set(row.game_id, new Map());
                    gameFor5v5.get(row.game_id)!.set(row.team, row.attempts_for_5v5 || '0');
                }
                for (const row of parsedStats) {
                    const agVal = parseFloat(row.attempts_ag_5v5 || '0');
                    if (agVal === 0 && row.game_id && row.team) {
                        // Find the opponent's for_5v5 for this game
                        const gameTeams = gameFor5v5.get(row.game_id);
                        if (gameTeams) {
                            const opponentFor5v5 = [...gameTeams.entries()]
                                .find(([t]) => t !== row.team)?.[1];
                            if (opponentFor5v5 && parseFloat(opponentFor5v5) > 0) {
                                row.attempts_ag_5v5 = opponentFor5v5;
                            }
                        }
                    }
                }

                setRawData(parsedStats);

                // Parse Team Ratings JSON files (for Team Ratings view mode)
                try {
                    if (ratingsRes.ok) setTeamRatingsData(await ratingsRes.json());
                    if (lineupsRes.ok) setTeamLineups(await lineupsRes.json());
                    if (impactRes.ok) setPlayerImpact(await impactRes.json());
                    if (goalieRes.ok) setGoalieRatings(await goalieRes.json());
                    if (clinchRes.ok) setClinchData(await clinchRes.json());
                } catch (e) {
                    console.error('Failed to load team rating JSON files', e);
                }

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

                    const parseMatchupRow = (row: Record<string, string>): Matchup => ({
                        home: row.home_team?.trim(),
                        away: row.away_team?.trim(),
                        homeStarter: cleanName(row.home_starter),
                        homeStarterStatus: getStarterStatus(row.home_starter),
                        awayStarter: cleanName(row.away_starter),
                        awayStarterStatus: getStarterStatus(row.away_starter),
                        homeVegasOdds: row.home_vegas_odds ? parseFloat(row.home_vegas_odds) : undefined,
                        awayVegasOdds: row.away_vegas_odds ? parseFloat(row.away_vegas_odds) : undefined,
                        homeModelOdds: row.home_model_odds?.trim() || undefined,
                        awayModelOdds: row.away_model_odds?.trim() || undefined,
                        homeEV: row.home_ev ? parseFloat(row.home_ev) : undefined,
                        awayEV: row.away_ev ? parseFloat(row.away_ev) : undefined,
                        homeXg: row.home_xg ? parseFloat(row.home_xg) : undefined,
                        awayXg: row.away_xg ? parseFloat(row.away_xg) : undefined,
                        recommendation: row.wager_recommendation?.trim().replace(/^'|'$/g, '') || undefined,
                    });

                    const matchups: Matchup[] = parsedPreds
                        .filter((row: Record<string, string>) => row.game_date === todayStr)
                        .map(parseMatchupRow)
                        .filter(m => m.home && m.away);

                    console.log("Valid Matchups:", matchups);
                    setTodayMatchups(matchups);

                    // Get tomorrow
                    const tomorrow = new Date(today);
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    const tomorrowStr = formatter.format(tomorrow);

                    const tomorrowMatchupsData: Matchup[] = parsedPreds
                        .filter((row: Record<string, string>) => row.game_date === tomorrowStr)
                        .map(parseMatchupRow)
                        .filter(m => m.home && m.away);
                    setTomorrowMatchups(tomorrowMatchupsData);
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
            // Use last-name + first-initial normalization so "Sam Montembeault"
            // matches "Samuel Montembeault" in gamestats.
            if (targetStarter) {
                const normTarget = normalizeGoalieName(targetStarter);
                games = games.filter(g =>
                    g.starting_goalie && normalizeGoalieName(g.starting_goalie) === normTarget
                );
            }

            // Apply Day of Week Filter
            if (withOptions.includes('DayOfWeek')) {
                const targetDow = getTargetDayOfWeek(viewBase);
                games = games.filter(g => new Date(g.game_date + 'T12:00:00').getDay() === targetDow);
            }

            // Apply game-level stat filters
            const gf = gameFilters;
            if (gf.ppg !== 'All') games = games.filter(g => gf.ppg === 'Yes' ? parseInt(g.pp_goals) >= 1 : parseInt(g.pp_goals) < 1);
            if (gf.ppga !== 'All') games = games.filter(g => gf.ppga === 'Yes' ? parseInt(g.pp_goals_against) >= 1 : parseInt(g.pp_goals_against) < 1);
            if (gf.scoringFirst !== 'All') {
                games = games.filter(g => {
                    const sf = g.scored_first;
                    const scored = sf === '1' || sf === 'true' || sf === '1.0';
                    return gf.scoringFirst === 'Yes' ? scored : !scored;
                });
            }
            const applyIntRange = (arr: typeof games, field: (g: typeof games[0]) => number, min: string, max: string) => {
                if (min !== '') { const v = parseInt(min); if (!isNaN(v)) arr = arr.filter(g => field(g) >= v); }
                if (max !== '') { const v = parseInt(max); if (!isNaN(v)) arr = arr.filter(g => field(g) <= v); }
                return arr;
            };
            const applyFloatRange = (arr: typeof games, field: (g: typeof games[0]) => number, min: string, max: string) => {
                if (min !== '') { const v = parseFloat(min); if (!isNaN(v)) arr = arr.filter(g => field(g) >= v); }
                if (max !== '') { const v = parseFloat(max); if (!isNaN(v)) arr = arr.filter(g => field(g) <= v); }
                return arr;
            };
            games = applyIntRange(games, g => parseInt(g.goals_for)    || 0, gf.minGf,        gf.maxGf);
            games = applyIntRange(games, g => parseInt(g.goals_ag)     || 0, gf.minGa,        gf.maxGa);
            games = applyIntRange(games, g => parseInt(g.sog_for)      || 0, gf.minSf,        gf.maxSf);
            games = applyIntRange(games, g => parseInt(g.sog_ag)      || 0, gf.minSa,        gf.maxSa);
            games = applyIntRange(games, g => (parseInt(g.sog_for) || 0) - (parseInt(g.sog_ag) || 0), gf.minShotDiff, gf.maxShotDiff);
            games = applyIntRange(games, g => parseInt(g.hdf)         || 0, gf.minHdf,       gf.maxHdf);
            games = applyIntRange(games, g => parseInt(g.hda)         || 0, gf.minHda,       gf.maxHda);
            games = applyIntRange(games, g => parseInt(g.attempts_for)|| 0, gf.minCf,        gf.maxCf);
            games = applyIntRange(games, g => parseInt(g.attempts_ag) || 0, gf.minCa,        gf.maxCa);
            games = applyIntRange(games, g => (parseInt(g.attempts_for) || 0) - (parseInt(g.attempts_ag) || 0), gf.minCorsiDiff, gf.maxCorsiDiff);
            games = applyFloatRange(games, g => (parseFloat(g.xG_for) || 0) - (parseFloat(g.xG_against) || 0), gf.minXgDiff, gf.maxXgDiff);
            games = applyIntRange(games, g => parseInt(g.pp_opportunities) || 0, gf.minPpOpps, gf.maxPpOpps);
            games = applyIntRange(games, g => parseInt(g.pk_opportunities) || 0, gf.minPkOpps, gf.maxPkOpps);
            if (gf.minSvPct !== '' || gf.maxSvPct !== '') {
                games = applyFloatRange(games, g => {
                    const sa = parseInt(g.sog_ag) || 0;
                    const sv = parseInt(g.saves_for ?? '0') || 0;
                    return sa > 0 ? sv / sa : 0;
                }, gf.minSvPct, gf.maxSvPct);
            }

            // Apply Last N (Always applies unless 'All')
            if (filterLastN === 'Playoffs') {
                // NHL game IDs: digits 5-6 are '03' for playoff games
                games = games.filter(g => g.game_id.substring(4, 6) === '03');
            } else if (filterLastN === 'Olympics') {
                // Since Olympics: games on or after Feb 22, 2026
                games = games.filter(g => g.game_date >= '2026-02-22');
            } else if (filterLastN !== 'All') {
                games = games.slice(0, filterLastN);
            }
            return games;
        };

        const processedTeams: TeamStat[] = [];

        // ALWAYS calculate league-wide stats for consistent ranges AND STANDINGS
        const allTeamsList = Array.from(new Set(rawData.map(g => g.team)));

        // 1. Calculate STANDINGS Baseline (Ignoring all filters)
        // This ensures "Rank" column is static based on full season
        const standingsBaseline: TeamStat[] = [];
        allTeamsList.forEach(teamName => {
            // Get ALL games for the team (ignore location/starter/lastN/period)
            const allGames = rawData.filter(g => g.team === teamName);
            if (allGames.length > 0) {
                standingsBaseline.push(calculateTeamStats(teamName, allGames)); // standings always use full-season
            }
        });

        // 2. Calculate League Baseline (Respecting Filters)
        // This is used for Ranges (color gradients) - usually we want gradients to reflect the filtered view (e.g. "Who has best PP in last 10?")

        // leagueBaseline: for PlayoffMatchup modes, applies per-team location/starter filters
        // (populated after playoff seeding computed — see "playoff matchup" block inserted after plySet)
        const leagueBaseline: TeamStat[] = [];

        if (viewMode !== 'All') {
            // Playing Today/Tomorrow Views (Force specific order: Away, Home, Away, Home...)
            const isTomorrow = viewMode.startsWith('PlayingTomorrow');
            const targetMatchups = isTomorrow ? tomorrowMatchups : todayMatchups;

            targetMatchups.forEach(matchup => {
                const { home, away, homeStarter, awayStarter, homeStarterStatus, awayStarterStatus } = matchup;

                // Determine Location Filter based on Mode
                // If PlayingTodayLocation OR PlayingTodayLocationStarter (or Tomorrow equivalents), FORCE Home/Away.
                // Otherwise (PlayingToday, PlayingTodayStarter), use the user's manual filter (filterHomeAway).
                const isForcedLocation = viewMode.includes('Location');

                const awayLoc = isForcedLocation ? 'Away' : filterHomeAway;
                const homeLoc = isForcedLocation ? 'Home' : filterHomeAway;

                // Determine Starter Filter
                const useStarter = viewMode.includes('Starter');

                const starterHome = useStarter ? homeStarter : undefined;
                const starterAway = useStarter ? awayStarter : undefined;

                // We still respect filterLastN if set by user
                const awayGames = getGames(away, awayLoc, starterAway);
                const homeGames = getGames(home, homeLoc, starterHome);

                // Calculate stats and attach starter name if applicable
                const awayStats = calculateTeamStats(away, awayGames, filterPeriod);
                if (starterAway) {
                    awayStats.starterName = starterAway;
                    awayStats.starterStatus = awayStarterStatus;
                }
                processedTeams.push(awayStats);

                const homeStats = calculateTeamStats(home, homeGames, filterPeriod);
                if (starterHome) {
                    homeStats.starterName = starterHome;
                    homeStats.starterStatus = homeStarterStatus;
                }
                processedTeams.push(homeStats);
            });
        }

        // --- CALCULATE STANDINGS (Official NHL Tiebreaker Rules) ---
        // Order: Points → RW → ROW → H2H pts (pairwise) → Conference record pts → Goal Diff
        // Pre-compute H2H points: h2hPts[team][opponent] = total pts earned in all matchups
        const h2hPts: Record<string, Record<string, number>> = {};
        rawData.forEach(g => {
            if (!h2hPts[g.team]) h2hPts[g.team] = {};
            const pts = (g.result === 'RW' || g.result === 'OTW' || g.result === 'SOW') ? 2
                       : (g.result === 'OTL' || g.result === 'SOL') ? 1 : 0;
            h2hPts[g.team][g.opponent] = (h2hPts[g.team][g.opponent] || 0) + pts;
        });

        // Pre-compute conference record points: confPts[team] = total pts vs same-conference opponents
        const confPts: Record<string, number> = {};
        rawData.forEach(g => {
            const teamDiv = teams[g.team]?.division;
            const oppDiv  = teams[g.opponent]?.division;
            if (!teamDiv || !oppDiv) return;
            if (CONFERENCE_MAPPING[teamDiv] !== CONFERENCE_MAPPING[oppDiv]) return;
            const pts = (g.result === 'RW' || g.result === 'OTW' || g.result === 'SOW') ? 2
                       : (g.result === 'OTL' || g.result === 'SOL') ? 1 : 0;
            confPts[g.team] = (confPts[g.team] || 0) + pts;
        });

        const sortForRank = (a: TeamStat, b: TeamStat) => {
            if (b.points !== a.points) return b.points - a.points;
            if (b.rw !== a.rw) return b.rw - a.rw;
            if (b.row !== a.row) return b.row - a.row;
            // H2H points (pairwise — exact for 2-way ties, best-available for 3+ way)
            const aH2H = h2hPts[a.team]?.[b.team] || 0;
            const bH2H = h2hPts[b.team]?.[a.team] || 0;
            if (aH2H !== bH2H) return bH2H - aH2H;
            // Conference record points
            const aConf = confPts[a.team] || 0;
            const bConf = confPts[b.team] || 0;
            if (aConf !== bConf) return bConf - aConf;
            // Goal differential (last resort)
            return b.goal_diff - a.goal_diff;
        };

        const divMap: Record<string, TeamStat[]> = { Atlantic: [], Metro: [], Central: [], Pacific: [] };
        // Use standingsBaseline (ALL GAMES) for frame of reference
        standingsBaseline.forEach(t => {
            const inf = teams[t.team];
            if (inf && inf.division) {
                if (!divMap[inf.division]) divMap[inf.division] = [];
                divMap[inf.division].push(t);
            }
        });
        Object.values(divMap).forEach(list => list.sort(sortForRank));

        const plySet = new Set<string>();
        const divisionToInitial: Record<string, string> = { Atlantic: 'A', Metro: 'M', Central: 'C', Pacific: 'P' };

        // Playoff Spots
        Object.values(divMap).forEach(list => list.slice(0, 3).forEach(t => plySet.add(t.team)));
        ['Eastern', 'Western'].forEach(conf => {
            const confTeams = standingsBaseline.filter(t => {
                const inf = teams[t.team];
                return inf && inf.division && CONFERENCE_MAPPING[inf.division] === conf && !plySet.has(t.team);
            });
            confTeams.sort(sortForRank);
            confTeams.slice(0, 2).forEach(t => plySet.add(t.team));
        });

        // ── Playoff Matchup Location/Starter filters ───────────────────────
        // Now that divMap and plySet are ready, derive each team's home/away
        // from their playoff seed (higher seed = Home ice advantage).
        // Div winners (rank 0) and div 2nd-place (rank 1) = HOME
        // Div 3rd-place (rank 2) and wild cards = AWAY
        const isPlayoffWithFilter = viewMode.startsWith('PlayoffMatchup') && viewMode !== 'PlayoffMatchup';
        const playoffTeamLocation = new Map<string, 'Home' | 'Away'>();
        const playoffTeamStarter = new Map<string, string | undefined>();
        if (isPlayoffWithFilter) {
            // Location: derive from seeding
            if (viewMode.includes('Location')) {
                Object.values(divMap).forEach(list => {
                    if (list[0]) playoffTeamLocation.set(list[0].team, 'Home'); // div winner
                    if (list[1]) playoffTeamLocation.set(list[1].team, 'Home'); // div 2nd
                    if (list[2]) playoffTeamLocation.set(list[2].team, 'Away'); // div 3rd
                });
                // Wild cards are away
                standingsBaseline.forEach(t => {
                    const inf = teams[t.team];
                    if (!inf?.division) return;
                    const divRank = divMap[inf.division].findIndex(x => x.team === t.team);
                    if (plySet.has(t.team) && divRank >= 3) {
                        playoffTeamLocation.set(t.team, 'Away');
                    }
                });
            }
            // Starter: use next available game prediction (today then tomorrow), fall back to #1 historical goalie
            if (viewMode.includes('Starter')) {
                const allMatchups = [...todayMatchups, ...tomorrowMatchups];
                // Build starter map from predictions
                allMatchups.forEach(m => {
                    if (!playoffTeamStarter.has(m.home) && m.homeStarter) playoffTeamStarter.set(m.home, m.homeStarter);
                    if (!playoffTeamStarter.has(m.away) && m.awayStarter) playoffTeamStarter.set(m.away, m.awayStarter);
                });
                // Fallback: #1 goalie by most starts in last 20 games for each playoff team
                plySet.forEach(teamName => {
                    if (!playoffTeamStarter.has(teamName)) {
                        const recentGames = rawData.filter(g => g.team === teamName).sort((a, b) => b.game_date.localeCompare(a.game_date)).slice(0, 20);
                        const counts: Record<string, number> = {};
                        recentGames.forEach(g => { if (g.starting_goalie) counts[g.starting_goalie] = (counts[g.starting_goalie] ?? 0) + 1; });
                        const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
                        if (top) playoffTeamStarter.set(teamName, top);
                    }
                });
            }
        }

        // Fill leagueBaseline (uses playoffTeamLocation/Starter if in playoff filter mode)
        allTeamsList.forEach(teamName => {
            const loc = isPlayoffWithFilter && viewMode.includes('Location')
                ? (playoffTeamLocation.get(teamName) ?? filterHomeAway)
                : filterHomeAway;
            const starter = isPlayoffWithFilter && viewMode.includes('Starter')
                ? playoffTeamStarter.get(teamName)
                : undefined;
            const games = getGames(teamName, loc, starter);
            if (games.length > 0) {
                leagueBaseline.push(calculateTeamStats(teamName, games, filterPeriod));
            }
        });
        setLeagueStats(leagueBaseline);

        // For 'All' view, populate processedTeams from leagueBaseline (now fully populated)
        if (viewMode === 'All') {
            let filteredBase = leagueBaseline;
            if (selectedDivisions.length > 0) {
                filteredBase = filteredBase.filter(s => {
                    const teamInfo = teams[s.team];
                    return teamInfo && teamInfo.division && selectedDivisions.includes(teamInfo.division);
                });
            }
            processedTeams.push(...filteredBase);
        }

        // ── Magic Number / Tragic Number ─────────────────────────────────────
        // M# (playoff teams): combined pts a team needs to earn + pts the 9th-place
        //   team needs to lose to guarantee a playoff spot.
        //   Formula: (9th team's max possible pts) − team's current pts + 1
        //   Where max possible pts = current pts + remaining games × 2  (remaining = 82 − GP)
        // E# (non-playoff teams): combined pts they need to earn + pts the 8th-place
        //   team needs to lose before elimination.
        //   Formula: (8th team's max possible pts) − team's current pts + 1
        // Reference boundary: the Wild Card cutoff in each conference
        // ─────────────────────────────────────────────────────────────────────
        const SEASON_GP = 82;
        const magicTragicMap: Record<string, { magic_number?: number; tragic_number?: number }> = {};

        (['Eastern', 'Western'] as const).forEach(conf => {
            const confDivisions = conf === 'Eastern' ? ['Atlantic', 'Metro'] : ['Central', 'Pacific'];

            // All conference teams sorted by standings (points → RW → ROW → W → GD)
            const allConfTeams = standingsBaseline
                .filter(t => { const inf = teams[t.team]; return inf && inf.division && CONFERENCE_MAPPING[inf.division] === conf; })
                .sort(sortForRank);

            // Re-build the playoff set for this conference only
            const confPlayoffSet = new Set<string>();
            confDivisions.forEach(div => divMap[div].slice(0, 3).forEach(t => confPlayoffSet.add(t.team)));
            // Wild card pool: non-division-leaders in this conference, sorted by standings
            const wcPool = allConfTeams.filter(t => !confPlayoffSet.has(t.team));
            wcPool.slice(0, 2).forEach(t => confPlayoffSet.add(t.team));

            // Identify the 8th (last wildcard) and 9th (first non-playoff) teams
            const playoffSorted   = allConfTeams.filter(t =>  confPlayoffSet.has(t.team));
            const nonPlayoffSorted = allConfTeams.filter(t => !confPlayoffSet.has(t.team));
            const seed8 = playoffSorted[playoffSorted.length - 1]; // last WC = 8th in conf
            const seed9 = nonPlayoffSorted[0];                     // first non-playoff = 9th

            if (!seed8 || !seed9) return; // season over or < 16 teams with data

            const maxPts8 = seed8.points + (SEASON_GP - seed8.gp) * 2;
            const maxPts9 = seed9.points + (SEASON_GP - seed9.gp) * 2;

            allConfTeams.forEach(t => {
                const maxPtsMe = t.points + (SEASON_GP - t.gp) * 2;
                if (confPlayoffSet.has(t.team)) {
                    // Playoff team:
                    //   M#      = 9th's max pts − my pts + 1  (clinch: 9th can no longer catch me)
                    //   Tragic# = my max pts − 9th's pts + 1  (eliminated: I can no longer stay above 9th)
                    magicTragicMap[t.team] = {
                        magic_number:  Math.max(0, maxPts9 - t.points + 1),
                        tragic_number: Math.max(0, maxPtsMe - seed9.points + 1),
                    };
                } else {
                    // Non-playoff team:
                    //   M#      = 8th's max pts − my pts + 1  (get in: 8th can no longer stay above me)
                    //   Tragic# = my max pts − 8th's pts + 1  (eliminated: I can no longer catch 8th)
                    magicTragicMap[t.team] = {
                        magic_number:  Math.max(0, maxPts8 - t.points + 1),
                        tragic_number: Math.max(0, maxPtsMe - seed8.points + 1),
                    };
                }
            });
        });
        // ─────────────────────────────────────────────────────────────────────

        // Map props (ranking label + magic/tragic numbers)
        // Clinch/elimination badges now come from clinch_status.json (NHL official data)
        const rMap: Record<string, { ranking: string, isPlayoff: boolean, magic_number?: number, tragic_number?: number }> = {};
        standingsBaseline.forEach(t => {
            const inf = teams[t.team];
            if (inf && inf.division) {
                const rank = divMap[inf.division].findIndex(x => x.team === t.team) + 1;
                const mt = magicTragicMap[t.team];
                rMap[t.team] = {
                    ranking: `${divisionToInitial[inf.division]}${rank}`,
                    isPlayoff: plySet.has(t.team),
                    ...mt,
                };
            }
        });

        processedTeams.forEach(t => {
            if (rMap[t.team]) {
                t.ranking = rMap[t.team].ranking;
                t.isPlayoff = rMap[t.team].isPlayoff;
                t.magic_number = rMap[t.team].magic_number;
                t.tragic_number = rMap[t.team].tragic_number;
            }
        });

        // Apply Playoff Filter after isPlayoff has been assigned
        const finalTeams = filterPlayoff === 'All'
            ? processedTeams
            : processedTeams.filter(t => filterPlayoff === 'Yes' ? t.isPlayoff : !t.isPlayoff);

        setStats(finalTeams);

        // ── Compute Playoff Bracket ───────────────────────────────────────────
        // NHL first-round format per conference:
        //   seed1 (better div winner) vs WC2
        //   seed2 (other div winner)  vs WC1
        //   seed1's div: 2nd vs 3rd
        //   seed2's div: 2nd vs 3rd
        // Higher seed (lower number) listed first in each pair.
        // Build a lookup from leagueBaseline (filtered stats) so the bracket shows filtered data
        const filteredByTeam = new Map<string, TeamStat>();
        leagueBaseline.forEach(t => filteredByTeam.set(t.team, t));
        // Apply rMap to leagueBaseline entries so ranking/isPlayoff are set
        leagueBaseline.forEach(t => {
            if (rMap[t.team]) {
                t.ranking = rMap[t.team].ranking;
                t.isPlayoff = rMap[t.team].isPlayoff;
            }
        });

        const bracket: PlayoffConferenceBracket[] = [];

        (['Eastern', 'Western'] as const).forEach(conf => {
            const confDivisions = conf === 'Eastern' ? ['Atlantic', 'Metro'] : ['Central', 'Pacific'];

            // Use standingsBaseline order to determine seeding, but return filtered stats for display
            const resolve = (t: TeamStat | undefined) => t ? (filteredByTeam.get(t.team) ?? t) : undefined;

            // Division winners and their rosters (seeding order from standingsBaseline)
            const divWinners = confDivisions.map(div => ({
                div,
                winner: resolve(divMap[div][0]),
                second: resolve(divMap[div][1]),
                third:  resolve(divMap[div][2]),
            })).filter(d => d.winner);

            if (divWinners.length < 2) return;

            // Sort division winners by points to assign seed1 / seed2
            const [dw1, dw2] = divWinners.sort((a, b) => sortForRank(a.winner!, b.winner!));

            // Wild cards: in this conference, in plySet, but NOT in top-3 of their division
            const wcTeams = standingsBaseline
                .filter(t => {
                    const inf = teams[t.team];
                    return inf?.division
                        && CONFERENCE_MAPPING[inf.division] === conf
                        && plySet.has(t.team)
                        && divMap[inf.division].slice(0, 3).every(d => d.team !== t.team);
                })
                .sort(sortForRank);

            const wc1 = resolve(wcTeams[0]); // WC1 = more points (plays worse div winner)
            const wc2 = resolve(wcTeams[1]); // WC2 = fewer points (plays better div winner)

            const matchups: [TeamStat, TeamStat][] = [];

            // seed1 (dw1.winner) vs WC2 — seed1 on top
            if (dw1.winner && wc2) matchups.push([dw1.winner, wc2]);
            // seed2 (dw2.winner) vs WC1 — seed2 on top
            if (dw2.winner && wc1) matchups.push([dw2.winner, wc1]);
            // seed1's division: 2nd vs 3rd — 2nd on top
            if (dw1.second && dw1.third) matchups.push([dw1.second, dw1.third]);
            // seed2's division: 2nd vs 3rd — 2nd on top
            if (dw2.second && dw2.third) matchups.push([dw2.second, dw2.third]);

            if (matchups.length > 0) bracket.push({ conf, matchups });
        });

        setPlayoffBracket(bracket);
        // ─────────────────────────────────────────────────────────────────────

    }, [rawData, viewMode, viewBase, withOptions, filterHomeAway, filterLastN, filterPeriod, filterPlayoff, todayMatchups, tomorrowMatchups, selectedDivisions, teams, gameFilters]);


    const handleSort = (key: string) => {
        // Disable sorting in Matchup Filter modes to preserve pairing
        if (viewMode !== 'All') return;

        if (sortKey === key) {
            setSortDesc(!sortDesc);
        } else {
            setSortKey(key);
            setSortDesc(true); // Default to desc
            setFlashKey(prev => prev + 1); // Trigger flash on column change
        }
    };

    const sortedStats = useMemo(() => {
        // If in Playing Today/Tomorrow/PlayoffMatchup modes, PRESERVE ORDER
        if (viewMode.startsWith('PlayoffMatchup')) {
            return playoffBracket.flatMap(conf => conf.matchups.flatMap(([a, b]) => [a, b]));
        }
        if (viewMode !== 'All') return stats;

        const sorted = [...stats];
        sorted.sort((a, b) => {
            // Ratings columns sort (looks up value from teamRatingsComputed)
            if (RATINGS_KEYS.has(sortKey)) {
                const valA = extractRatingValue(teamRatingsComputed[a.team], sortKey);
                const valB = extractRatingValue(teamRatingsComputed[b.team], sortKey);
                if (!isFinite(valA) && !isFinite(valB)) return 0;
                if (!isFinite(valA)) return 1;   // push NaN to bottom
                if (!isFinite(valB)) return -1;
                return sortDesc ? valB - valA : valA - valB;
            }

            const valA = a[sortKey as keyof TeamStat];
            const valB = b[sortKey as keyof TeamStat];

            // Special handling for time columns
            if (['pp_time_per_game', 'pk_time_per_game', 'pp_time_per_goal', 'pk_time_per_goal_allowed'].includes(sortKey)) {
                const getSeconds = (v: string | number) => {
                    if (v === 'Inf' || v === 'Perfect') return 999999;
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
    }, [stats, sortKey, sortDesc, viewMode, teamRatingsComputed, playoffBracket]);

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
            rw: calculateRange('rw'),
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
            hdf_per_game: calculateRange('hdf_per_game'),
            hda_per_game: calculateRange('hda_per_game'),
            sh_pct: calculateRange('sh_pct'),
            sv_pct: calculateRange('sv_pct'),
            xgf_per_game: calculateRange('xgf_per_game'),
            xga_per_game: calculateRange('xga_per_game'),
            xgf_pct: calculateRange('xgf_pct'),

            time_leading_per_game: calculateRange('time_leading_per_game'),
            time_trailing_per_game: calculateRange('time_trailing_per_game'),
            time_tied_per_game: calculateRange('time_tied_per_game'),
            control_score: calculateRange('control_score'),
            nlw: calculateRange('nlw'),
            ntw: calculateRange('ntw'),
            ntl: calculateRange('ntl'),
            bl: calculateRange('bl'),
            bl_3p: calculateRange('bl_3p'),
            bl_2plus: calculateRange('bl_2plus'),
            bl_3plus: calculateRange('bl_3plus'),
            cw: calculateRange('cw'),
            cw_3p: calculateRange('cw_3p'),
            cw_2plus: calculateRange('cw_2plus'),
            cw_3plus: calculateRange('cw_3plus'),

            true_gf_per_game: calculateRange('true_gf_per_game'),
            true_ga_per_game: calculateRange('true_ga_per_game'),
            true_goal_diff: calculateRange('true_goal_diff'),
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


    // Build per-team odds lookup from today + tomorrow matchups
    const teamOddsLookup = useMemo(() => {
        const lookup = new Map<string, TeamOdds>();
        const isTomorrow = viewMode.startsWith('PlayingTomorrow');
        const sourceMatchups = isTomorrow ? tomorrowMatchups : todayMatchups;
        sourceMatchups.forEach(m => {
            // The recommendation string starts with "Home" or "Away" to indicate
            // which side is being recommended (e.g. "Away 1.4 Units").
            // Only the indicated side gets isRecommended = true.
            const recLower = m.recommendation?.toLowerCase() ?? '';
            const homeIsRec = recLower.startsWith('home');
            const awayIsRec = recLower.startsWith('away');
            if (m.home) {
                lookup.set(m.home, {
                    vegasOdds: m.homeVegasOdds,
                    modelOdds: m.homeModelOdds,
                    ev: m.homeEV,
                    xg: m.homeXg,
                    recommendation: m.recommendation,
                    isRecommended: homeIsRec,
                });
            }
            if (m.away) {
                lookup.set(m.away, {
                    vegasOdds: m.awayVegasOdds,
                    modelOdds: m.awayModelOdds,
                    ev: m.awayEV,
                    xg: m.awayXg,
                    recommendation: m.recommendation,
                    isRecommended: awayIsRec,
                });
            }
        });
        return lookup;
    }, [viewMode, todayMatchups, tomorrowMatchups]);

    if (loading) return <div className="p-8 text-center bg-gray-900 border border-gray-800 rounded-xl text-gray-400">Loading Stats...</div>;

    // Helper for columns
    const renderCell = (team: TeamStat, key: keyof TeamStat, label?: string, isInverse: boolean = false, isTime: boolean = false, isGroupEnd: boolean = false, isHidden: boolean = false) => {
        // Handle 0 GP (First Start) -> Show Blank
        if (team.gp === 0) {
            return (
                <td className={`px-2 py-0.5 text-sm font-medium whitespace-nowrap text-center text-gray-600 ${isGroupEnd ? 'md:border-r md:border-gray-700/50' : ''} ${isHidden ? 'hidden' : 'table-cell'}`}>
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
                if (key === 'pp_lev' || key === 'pk_lev') {
                    // Use new Leverage Gradient (Low=Cyan, High=Yellow)
                    // Note: We ignore 'inverse' here because the user specified High/Low colors explicitly
                    color = getLeverageGradientColor(value, r.min, r.max);
                } else {
                    color = getGradientColor(value, r.min, r.max, isInverse);
                }
            }
            // Format
            if (key === 'pt_pct') {
                value = (value as number).toFixed(3).replace(/^0+/, ''); // .650
            } else if (key === 'sv_pct') {
                value = ((value as number) / 100).toFixed(3).replace(/^0+/, ''); // .925
            } else if (key === 'pp_lev' || key === 'pk_lev') {
                value = (value as number).toFixed(0) + '%';
            } else if (key.toString().includes('pct')) {
                value = value.toFixed(1) + '%';
            } else if (key === 'time_leading_per_game' || key === 'time_trailing_per_game' || key === 'time_tied_per_game') {
                value = formatTime(value as number);
            } else if (key === 'control_score') {
                value = (value as number).toFixed(3);
            } else if (['sf_per_game', 'sa_per_game', 'cf_per_game', 'ca_per_game', 'hdf_per_game', 'hda_per_game'].includes(key)) {
                value = value.toFixed(1);
            } else if (key.toString().includes('per_game')) {
                value = value.toFixed(2);
            } else if (key === 'gsax') {
                // +#,##0.00;(#,##0.00);"E"
                const paramVal = value as number;
                if (Math.abs(paramVal) < 0.01) value = 'E';
                else if (paramVal > 0) value = '+' + paramVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                else value = '(' + Math.abs(paramVal).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ')';
            } else if (key === 'goal_diff' || key === 'true_goal_diff') {
                // +#,##0;(#,##0);"E"
                const paramVal = value as number;
                if (Math.abs(paramVal) < 0.1) value = 'E'; // Treat 0 or near 0 as Even
                else if (paramVal > 0) value = '+' + Math.round(paramVal).toLocaleString();
                else value = '(' + Math.round(Math.abs(paramVal)).toLocaleString() + ')';
            }
        } else if (key === 'ranking') {
            // Apply Special Styling
            color = team.isPlayoff ? '#FFFFFF' : '#99A2AF';
            // Font weight handled in class
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

        const isActiveSort = key === sortKey && viewMode === 'All';

        return (
            <td
                key={isActiveSort ? `${key}-${flashKey}` : key}
                className={`px-2 py-0.5 text-sm whitespace-nowrap text-center ${isGroupEnd ? 'md:border-r md:border-gray-700/50' : ''} ${isHidden ? 'hidden' : 'table-cell'} ${key === 'ranking' ? (team.isPlayoff ? 'font-medium' : 'font-light') : 'font-medium'} ${isActiveSort ? 'animate-[sortFlash_0.6s_ease-out]' : ''}`}
                style={{ color }}
            >
                {value}
            </td>
        );
    };

    // Renders a single cell in the Team Ratings view (rating/lineup/goalie columns)
    const renderRatingCell = (teamName: string, colKey: string, isInverse: boolean, isGroupEnd: boolean, isHidden: boolean = false) => {
        const visClass = isHidden ? 'hidden' : 'table-cell';
        const cellClass = `${visClass} px-2 py-0.5 text-sm font-medium whitespace-nowrap text-center${isGroupEnd ? ' md:border-r md:border-gray-700/50' : ''}`;

        const value = extractRatingValue(teamRatingsComputed[teamName], colKey);

        if (!isFinite(value)) {
            return <td key={colKey} className={cellClass} style={{ color: '#4b5563' }}>—</td>;
        }

        const rng = ratingsRanges?.[colKey as keyof typeof ratingsRanges];
        const color = rng ? getGradientColor(value, rng.min, rng.max, isInverse) : '#DADADA';

        return (
            <td key={colKey} className={cellClass} style={{ color }}>
                {value.toFixed(2)}
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

    const MultiSelectButtonGroup = ({ options, current, onChange }: { options: string[], current: string[], onChange: (val: string) => void }) => {
        const isAll = current.length === 0;

        return (
            <div className="flex bg-gray-800 rounded-lg p-1 gap-1">
                {/* All Button */}
                <button
                    onClick={() => {
                        // Create a synthetic event or just pass 'All'? Logic handled in parent or here?
                        // Let's handle "Clear All" signal by passing 'All'
                        onChange('All');
                    }}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${isAll
                        ? 'bg-blue-600 text-white shadow-lg'
                        : 'text-gray-400 hover:text-white hover:bg-gray-700'
                        }`}
                >
                    All
                </button>

                {options.map((opt) => {
                    const isSelected = current.includes(opt);
                    return (
                        <button
                            key={opt}
                            onClick={() => onChange(opt)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${isSelected
                                ? 'bg-blue-600 text-white shadow-lg'
                                : 'text-gray-400 hover:text-white hover:bg-gray-700'
                                }`}
                        >
                            {opt}
                        </button>
                    );
                })}
            </div>
        );
    };

    return (
        <>
        <div className="w-full">
            {/* View Mode & Filters */}
            <div className="flex flex-col gap-2 mb-3">

                {/* Top Row: View Type + With */}
                <div className="flex flex-row gap-3 items-end flex-wrap">
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">View Type</label>
                        <ButtonGroup
                            options={['All', 'PlayingToday', 'PlayingTomorrow', 'PlayoffMatchup']}
                            labels={['All Teams', 'Playing Today', 'Playing Tomorrow', 'Playoff Matchups']}
                            current={viewBase}
                            onChange={(v) => setViewBase(v as ViewBase)}
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">With</label>
                        <div className="flex bg-gray-800 rounded-lg p-1 gap-1">
                            {(['Location', 'Starter', 'DayOfWeek'] as WithOption[]).map(opt => {
                                const isActive = withOptions.includes(opt);
                                const isDisabled = (opt === 'DayOfWeek' && viewBase === 'PlayoffMatchup') || ((opt === 'Location' || opt === 'Starter') && viewBase === 'All');
                                const targetDow = getTargetDayOfWeek(viewBase);
                                const label = opt === 'DayOfWeek'
                                    ? (isActive ? `${DAY_NAMES[targetDow]}s` : 'Day of Week')
                                    : opt;
                                return (
                                    <button
                                        key={opt}
                                        onClick={() => !isDisabled && toggleWithOption(opt)}
                                        className={`px-3 py-1.5 rounded text-xs font-medium transition-all whitespace-nowrap ${
                                            isDisabled
                                                ? 'text-gray-600 cursor-default'
                                                : isActive
                                                ? 'bg-blue-600 text-white shadow-sm'
                                                : 'text-gray-400 hover:text-white cursor-pointer'
                                        }`}
                                        title={isDisabled ? 'Only applies to Playing Today / Tomorrow' : undefined}
                                    >
                                        {label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Bottom Row: Filters (Only manual filters) */}
                <div className="flex flex-row gap-3 items-center flex-wrap">
                    {/* Location Filter: Only show if NOT in PlayingTodayLocation/Starter(Location) mode AND not in Ratings mode */}
                    {!viewMode.includes('Location') && valuesMode !== 'Ratings' && (
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Location</label>
                            <ButtonGroup
                                options={['All', 'Home', 'Away']}
                                current={filterHomeAway}
                                onChange={(v) => setFilterHomeAway(v as 'All' | 'Home' | 'Away')}
                            />
                        </div>
                    )}

                    {/* Recent Filter: hidden in Ratings mode (lineup data is not game-filtered) */}
                    {valuesMode !== 'Ratings' && (
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Recent</label>
                            <ButtonGroup
                                options={['All', 5, 10, 20, 'Olympics', 'Playoffs']}
                                labels={['All', 'L5', 'L10', 'L20', 'Olympics', 'Playoffs']}
                                current={filterLastN}
                                onChange={(v) => setFilterLastN(v as number | 'All' | 'Olympics' | 'Playoffs')}
                            />
                        </div>
                    )}

                    {/* Period Filter: hidden in Ratings mode */}
                    {valuesMode !== 'Ratings' && (
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Period</label>
                            <ButtonGroup
                                options={['All', '1st', '2nd', '3rd', 'OT']}
                                current={filterPeriod}
                                onChange={(v) => setFilterPeriod(v as 'All' | '1st' | '2nd' | '3rd' | 'OT')}
                            />
                        </div>
                    )}

                    {/* Values Filter */}
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Values</label>
                        <ButtonGroup
                            options={['Stats', 'Ratings']}
                            current={valuesMode}
                            onChange={(v) => setValuesMode(v as ValuesMode)}
                        />
                    </div>

                    {/* Division Filter (Only in All Teams view) */}
                    {viewMode === 'All' && (
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Division</label>
                            <MultiSelectButtonGroup
                                options={['Atlantic', 'Metro', 'Central', 'Pacific']}
                                current={selectedDivisions}
                                onChange={(val) => {
                                    if (val === 'All') {
                                        setSelectedDivisions([]);
                                    } else {
                                        if (selectedDivisions.includes(val)) {
                                            setSelectedDivisions(selectedDivisions.filter(d => d !== val));
                                        } else {
                                            setSelectedDivisions([...selectedDivisions, val]);
                                        }
                                    }
                                }}
                            />
                        </div>
                    )}

                    {/* Playoff Filter (Only in All Teams view) */}
                    {viewMode === 'All' && (
                        <div className="flex flex-col gap-1">
                            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Playoffs</label>
                            <ButtonGroup
                                options={['All', 'Yes', 'No']}
                                current={filterPlayoff}
                                onChange={(v) => setFilterPlayoff(v as 'All' | 'Yes' | 'No')}
                            />
                        </div>
                    )}
                </div>
            </div>

            {/* Desktop-only Game-Level Stat Filters */}
            {valuesMode !== 'Ratings' && (
                <div className="hidden md:block mb-3">
                    <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] uppercase font-bold text-gray-500 tracking-wider">Game Filters</span>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setGameFilters(f => ({
                                    ...f,
                                    ppg: 'All', ppga: 'All', scoringFirst: 'All',
                                    minGf: '', maxGf: '', minGa: '', maxGa: '',
                                    minSf: '', maxSf: '', minSa: '', maxSa: '',
                                    minHdf: '', maxHdf: '', minHda: '', maxHda: '',
                                    minCf: '', maxCf: '', minCa: '', maxCa: '',
                                    minCorsiDiff: '', maxCorsiDiff: '',
                                    minXgDiff: '', maxXgDiff: '',
                                    minPpOpps: '', maxPpOpps: '', minPkOpps: '', maxPkOpps: '',
                                    minSvPct: '', maxSvPct: '', minShotDiff: '', maxShotDiff: '',
                                }))}
                                className="text-[9px] uppercase font-bold text-gray-500 hover:text-white transition-colors px-2 py-0.5 rounded border border-gray-700 hover:border-gray-500"
                            >
                                Clear All
                            </button>
                            <button
                                onClick={() => setMoreFiltersOpen(o => !o)}
                                className="text-[9px] uppercase font-bold text-gray-500 hover:text-white transition-colors px-2 py-0.5 rounded border border-gray-700 hover:border-gray-500"
                            >
                                {moreFiltersOpen ? 'Collapse' : 'Expand'}
                            </button>
                        </div>
                    </div>
                    {moreFiltersOpen && <div className="flex flex-wrap gap-x-6 gap-y-3 p-3 bg-white/5 rounded-lg border border-white/10 items-end">

                        {/* PPG */}
                        <div className="flex flex-col gap-1">
                            <label className="text-[9px] uppercase font-bold text-gray-500 tracking-wider">Scoring 1+ PPG</label>
                            <div className="flex gap-1">
                                {(['All', 'Yes', 'No'] as const).map(v => (
                                    <button key={v} onClick={() => setGF('ppg', v)}
                                        className={`px-2 py-0.5 rounded-sm text-[9px] uppercase font-bold transition-all ${gameFilters.ppg === v ? 'bg-white text-black' : 'bg-black/40 text-gray-400 hover:bg-white/10 hover:text-white'}`}>
                                        {v}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* PPGA */}
                        <div className="flex flex-col gap-1">
                            <label className="text-[9px] uppercase font-bold text-gray-500 tracking-wider">Allowing 1+ PPGA</label>
                            <div className="flex gap-1">
                                {(['All', 'Yes', 'No'] as const).map(v => (
                                    <button key={v} onClick={() => setGF('ppga', v)}
                                        className={`px-2 py-0.5 rounded-sm text-[9px] uppercase font-bold transition-all ${gameFilters.ppga === v ? 'bg-white text-black' : 'bg-black/40 text-gray-400 hover:bg-white/10 hover:text-white'}`}>
                                        {v}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Scored First */}
                        <div className="flex flex-col gap-1">
                            <label className="text-[9px] uppercase font-bold text-gray-500 tracking-wider">Scored First</label>
                            <div className="flex gap-1">
                                <button onClick={() => setGF('scoringFirst', 'All')} className={`px-2 py-0.5 rounded-sm text-[9px] uppercase font-bold transition-all ${gameFilters.scoringFirst === 'All' ? 'bg-white text-black' : 'bg-black/40 text-gray-400 hover:bg-white/10 hover:text-white'}`}>All</button>
                                <button onClick={() => setGF('scoringFirst', 'Yes')} className={`px-2 py-0.5 rounded-sm text-[9px] uppercase font-bold transition-all ${gameFilters.scoringFirst === 'Yes' ? 'bg-white text-black' : 'bg-black/40 text-gray-400 hover:bg-white/10 hover:text-white'}`}>Yes</button>
                                <button onClick={() => setGF('scoringFirst', 'No')}  className={`px-2 py-0.5 rounded-sm text-[9px] uppercase font-bold transition-all ${gameFilters.scoringFirst === 'No'  ? 'bg-white text-black' : 'bg-black/40 text-gray-400 hover:bg-white/10 hover:text-white'}`}>Trailed</button>
                            </div>
                        </div>

                        {/* Range input helper rendered inline */}
                        {([
                            { label: 'GF',           minK: 'minGf',        maxK: 'maxGf' },
                            { label: 'GA',           minK: 'minGa',        maxK: 'maxGa' },
                            { label: 'Shots For',    minK: 'minSf',        maxK: 'maxSf' },
                            { label: 'Shots Against',minK: 'minSa',        maxK: 'maxSa' },
                            { label: 'Shot Diff',    minK: 'minShotDiff',  maxK: 'maxShotDiff' },
                            { label: 'HD For',       minK: 'minHdf',       maxK: 'maxHdf' },
                            { label: 'HD Against',   minK: 'minHda',       maxK: 'maxHda' },
                            { label: 'CF',           minK: 'minCf',        maxK: 'maxCf' },
                            { label: 'CA',           minK: 'minCa',        maxK: 'maxCa' },
                            { label: 'Corsi Diff',   minK: 'minCorsiDiff', maxK: 'maxCorsiDiff' },
                        ] as const).map(({ label, minK, maxK }) => (
                            <div key={label} className="flex flex-col gap-1">
                                <label className="text-[9px] uppercase font-bold text-gray-500 tracking-wider">{label}</label>
                                <div className="flex items-center gap-1">
                                    {([['Min', minK], ['Max', maxK]] as const).map(([lbl, key]) => (
                                        <div key={key} className="flex items-center gap-0.5 px-1.5 py-0.5 bg-black/40 rounded-sm border border-white/10">
                                            <span className="text-[8px] text-gray-600 uppercase">{lbl}</span>
                                            <input type="number" step="1" placeholder="—" value={gameFilters[key]}
                                                onChange={e => setGF(key, e.target.value)}
                                                className="w-9 bg-transparent text-[9px] font-bold text-center text-white placeholder:text-gray-600 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                            />
                                            {gameFilters[key] !== '' && <button onClick={() => setGF(key, '')} className="text-gray-600 hover:text-white text-[8px] leading-none">✕</button>}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}

                        {/* xG Diff — float step */}
                        <div className="flex flex-col gap-1">
                            <label className="text-[9px] uppercase font-bold text-gray-500 tracking-wider">xG Diff</label>
                            <div className="flex items-center gap-1">
                                {([['Min', 'minXgDiff'], ['Max', 'maxXgDiff']] as const).map(([lbl, key]) => (
                                    <div key={key} className="flex items-center gap-0.5 px-1.5 py-0.5 bg-black/40 rounded-sm border border-white/10">
                                        <span className="text-[8px] text-gray-600 uppercase">{lbl}</span>
                                        <input type="number" step="0.1" placeholder="—" value={gameFilters[key]}
                                            onChange={e => setGF(key, e.target.value)}
                                            className="w-10 bg-transparent text-[9px] font-bold text-center text-white placeholder:text-gray-600 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                        />
                                        {gameFilters[key] !== '' && <button onClick={() => setGF(key, '')} className="text-gray-600 hover:text-white text-[8px] leading-none">✕</button>}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* PP / PK Opps */}
                        {([
                            { label: 'PP Opps', minK: 'minPpOpps', maxK: 'maxPpOpps' },
                            { label: 'PK Opps', minK: 'minPkOpps', maxK: 'maxPkOpps' },
                        ] as const).map(({ label, minK, maxK }) => (
                            <div key={label} className="flex flex-col gap-1">
                                <label className="text-[9px] uppercase font-bold text-gray-500 tracking-wider">{label}</label>
                                <div className="flex items-center gap-1">
                                    {([['Min', minK], ['Max', maxK]] as const).map(([lbl, key]) => (
                                        <div key={key} className="flex items-center gap-0.5 px-1.5 py-0.5 bg-black/40 rounded-sm border border-white/10">
                                            <span className="text-[8px] text-gray-600 uppercase">{lbl}</span>
                                            <input type="number" step="1" placeholder="—" value={gameFilters[key]}
                                                onChange={e => setGF(key, e.target.value)}
                                                className="w-9 bg-transparent text-[9px] font-bold text-center text-white placeholder:text-gray-600 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                            />
                                            {gameFilters[key] !== '' && <button onClick={() => setGF(key, '')} className="text-gray-600 hover:text-white text-[8px] leading-none">✕</button>}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}

                        {/* Save % */}
                        <div className="flex flex-col gap-1">
                            <label className="text-[9px] uppercase font-bold text-gray-500 tracking-wider">Save %</label>
                            <div className="flex items-center gap-1">
                                {([['Min', 'minSvPct'], ['Max', 'maxSvPct']] as const).map(([lbl, key]) => (
                                    <div key={key} className="flex items-center gap-0.5 px-1.5 py-0.5 bg-black/40 rounded-sm border border-white/10">
                                        <span className="text-[8px] text-gray-600 uppercase">{lbl}</span>
                                        <input type="number" step="0.001" min="0" max="1" placeholder=".900" value={gameFilters[key]}
                                            onChange={e => setGF(key, e.target.value)}
                                            className="w-12 bg-transparent text-[9px] font-bold text-center text-white placeholder:text-gray-600 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                        />
                                        {gameFilters[key] !== '' && <button onClick={() => setGF(key, '')} className="text-gray-600 hover:text-white text-[8px] leading-none">✕</button>}
                                    </div>
                                ))}
                            </div>
                        </div>

                    </div>}
                </div>
            )}

            {/* Table */}
            {/* Column group toggles — multi-select, all on by default */}
            <div className="flex flex-col gap-1 mb-2">
                <div className="flex flex-wrap gap-1.5">
                    {(valuesMode === 'Ratings' ? RATINGS_STAT_GROUPS : STAT_GROUPS).map(group => {
                        const isOn = activeGroups.includes(group.name);
                        return (
                            <button
                                key={group.name}
                                onClick={() => toggleGroup(group.name)}
                                style={isOn ? { background: 'rgba(37,219,235,0.15)', borderColor: 'rgba(37,219,235,0.45)', color: '#25DBEB' } : undefined}
                                className={`px-3 py-1 text-[10px] font-bold uppercase tracking-tight rounded-full transition-all border ${
                                    isOn ? '' : 'bg-gray-800/60 border-gray-700 text-gray-500 hover:text-gray-300'
                                }`}
                            >
                                {group.name}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="overflow-auto max-h-[75vh] bg-gray-900 border border-gray-800 rounded-xl shadow-2xl relative" style={{ scrollbarGutter: 'stable' }}>
                <table className="w-full text-left border-collapse">
                    <thead>
                        {/* Desktop Group Headers — clickable toggles */}
                        <tr className="bg-gray-950 border-b border-gray-800 sticky top-0 z-50 shadow-[0_6px_0_0_#030712]">
                            <th className="sticky left-0 bg-gray-950 z-[55] shadow-[2px_0_8px_-2px_rgba(0,0,0,0.6)] border-r border-gray-800"></th>
                            {(valuesMode === 'Ratings' ? RATINGS_STAT_GROUPS : STAT_GROUPS).map(group => {
                                const isOn = activeGroups.includes(group.name);
                                if (!isOn) return null; // don't render the <th> at all — keeps colSpan counts consistent
                                return (
                                    <th
                                        key={group.name}
                                        colSpan={group.columns.length}
                                        className="px-2 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-center border-r border-gray-800/50 cursor-pointer select-none"
                                        onClick={() => toggleGroup(group.name)}
                                    >
                                        <span
                                            style={{ background: 'rgba(37,219,235,0.12)', borderColor: 'rgba(37,219,235,0.35)', color: '#25DBEB' }}
                                            className="inline-block px-3 py-1 rounded-full border transition-all"
                                        >
                                            {group.name}
                                        </span>
                                    </th>
                                );
                            })}
                        </tr>

                        <tr className="border-b border-gray-800 bg-gray-900 sticky top-0 md:top-[23px] z-40 text-xs uppercase tracking-wider text-gray-400">
                            <th className="px-2 py-1.5 font-semibold sticky left-0 bg-gray-900 z-[55] shadow-[2px_0_8px_-2px_rgba(0,0,0,0.8)]">Team</th>

                            {valuesMode === 'Ratings' ? (
                                <>
                                    {/* First 8 Record columns (ranking → rw) */}
                                    {COLUMNS.slice(0, 8).map(({ k, l, desc, calc }) => {
                                        if (!activeColumnKeys.has(k)) return null;
                                        const isGroupEnd = k === 'rw'; // last Record col
                                        return (
                                            <th
                                                key={k}
                                                className={`px-2 py-1.5 font-semibold transition-colors text-center whitespace-nowrap group relative cursor-pointer hover:text-white ${isGroupEnd ? 'md:border-r md:border-gray-700/50' : ''} table-cell`}
                                                onClick={() => handleSort(k)}
                                            >
                                                <div className="flex items-center justify-center gap-1">
                                                    {l}
                                                    {sortKey === k && <span className="text-[10px] text-blue-400">{sortDesc ? '▼' : '▲'}</span>}
                                                </div>
                                                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block w-max max-w-[200px] p-2 bg-black/95 border border-gray-700 text-white text-[10px] rounded shadow-xl z-[60] normal-case text-left pointer-events-none">
                                                    <div className="font-bold text-blue-400 mb-0.5 whitespace-normal">{desc}</div>
                                                    {calc && <div className="text-gray-400 font-mono text-[9px] whitespace-normal">{calc}</div>}
                                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-black/95"></div>
                                                </div>
                                            </th>
                                        );
                                    })}
                                    {/* Rating / Lineup / Goalie columns */}
                                    {RATINGS_COLS.map(({ k, l, desc, groupEnd }) => {
                                        if (!activeColumnKeys.has(k)) return null;
                                        const canSort = viewMode === 'All';
                                        return (
                                            <th
                                                key={k}
                                                className={`px-2 py-1.5 font-semibold transition-colors text-center whitespace-nowrap group relative ${canSort ? 'cursor-pointer hover:text-white' : 'cursor-default opacity-80'} ${groupEnd ? 'md:border-r md:border-gray-700/50' : ''} table-cell`}
                                                onClick={() => handleSort(k)}
                                            >
                                                <div className="flex items-center justify-center gap-1">
                                                    {l}
                                                    {canSort && sortKey === k && (
                                                        <span className="text-[10px] text-blue-400">{sortDesc ? '▼' : '▲'}</span>
                                                    )}
                                                </div>
                                                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block w-max max-w-[220px] p-2 bg-black/95 border border-gray-700 text-white text-[10px] rounded shadow-xl z-[60] normal-case text-left pointer-events-none">
                                                    <div className="font-bold text-blue-400 mb-0.5 whitespace-normal">{desc}</div>
                                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-black/95"></div>
                                                </div>
                                            </th>
                                        );
                                    })}
                                </>
                            ) : (
                                COLUMNS.map(({ k, l, desc, calc }) => {
                                    if (!activeColumnKeys.has(k)) return null;
                                    // Determine if this is the last column in any group for vertical grid lines
                                    const isGroupEnd = STAT_GROUPS.some(g => g.columns[g.columns.length - 1] === k);

                                    return (
                                        <th
                                            key={k}
                                            className={`px-2 py-1.5 font-semibold transition-colors text-center whitespace-nowrap group relative ${viewMode === 'All' ? 'cursor-pointer hover:text-white' : 'cursor-default opacity-80'
                                                } ${isGroupEnd ? 'md:border-r md:border-gray-700/50' : ''} table-cell`}
                                            onClick={() => handleSort(k)}
                                        >
                                            <div className="flex items-center justify-center gap-1">
                                                {l}
                                                {viewMode === 'All' && sortKey === k && (
                                                    <span className="text-[10px] text-blue-400">{sortDesc ? '▼' : '▲'}</span>
                                                )}
                                            </div>

                                            {/* Tooltip */}
                                            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block w-max max-w-[200px] p-2 bg-black/95 border border-gray-700 text-white text-[10px] rounded shadow-xl z-[60] normal-case text-left pointer-events-none">
                                                <div className="font-bold text-blue-400 mb-0.5 whitespace-normal">{desc}</div>
                                                {calc && <div className="text-gray-400 font-mono text-[9px] whitespace-normal">{calc}</div>}
                                                {/* Arrow */}
                                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-black/95"></div>
                                            </div>
                                        </th>
                                    );
                                })
                            )}
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

                            // For PlayoffMatchup view: show conference header before first team of each conference
                            let confHeaderRow: React.ReactNode = null;
                            if (viewMode.startsWith('PlayoffMatchup')) {
                                let teamCount = 0;
                                for (const confBracket of playoffBracket) {
                                    if (teamCount === idx) {
                                        confHeaderRow = (
                                            <tr key={`conf-${confBracket.conf}`}>
                                                <td colSpan={999} className="px-3 pt-5 pb-1 bg-gray-900">
                                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-400/70">{confBracket.conf} Conference</span>
                                                </td>
                                            </tr>
                                        );
                                        break;
                                    }
                                    teamCount += confBracket.matchups.length * 2;
                                }
                            }
                            const playoffSeedLabel = viewMode.startsWith('PlayoffMatchup') ? team.ranking : null;

                            return (
                                <React.Fragment key={`${team.team}-${idx}`}>
                                    {confHeaderRow}
                                    <tr className={rowStyle}>
                                        <td className="px-2 py-0 font-medium text-white sticky left-0 bg-gray-900 z-30 shadow-[2px_0_8px_-2px_rgba(0,0,0,0.6)]">
                                            <div className="flex items-center justify-center md:justify-start gap-3">
                                                {viewMode === 'All' && <span className="text-gray-600 text-xs w-4 text-center md:text-left">{idx + 1}</span>}

                                                <Link href={`/teams/${meta.tricode || ''}`} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                                                    {meta.tricode && (
                                                        <div className="w-10 h-10 md:w-9 md:h-9 relative shrink-0">
                                                            <Image
                                                                src={`/logos/${meta.tricode}.svg`}
                                                                alt={team.team}
                                                                fill
                                                                className="object-contain"
                                                            />
                                                        </div>
                                                    )}
                                                    <span
                                                        className={`truncate max-w-[120px] hidden md:block ${(viewMode.includes('Starter')) && team.starterStatus
                                                            ? (team.starterStatus?.toUpperCase()?.includes('UNCONFIRMED') ? 'text-gray-500 font-bold'
                                                                : team.starterStatus?.toUpperCase()?.includes('CONFIRMED') ? 'text-neon-green font-bold'
                                                                    : team.starterStatus?.toUpperCase()?.includes('LIKELY') ? 'text-yellow-400 font-bold'
                                                                        : 'text-gray-500 font-bold')
                                                            : ''
                                                            }`}
                                                        title={meta.commonName || team.team}
                                                    >
                                                        {(viewMode.includes('Starter')) && team.starterName
                                                            ? formatStarterName(team.starterName)
                                                            : (meta.commonName || team.team)}
                                                    </span>
                                                </Link>

                                                {/* Clinch / Elimination badge — official NHL data from clinch_status.json */}
                                                {viewMode === 'All' && meta.tricode && clinchData[meta.tricode] && (
                                                    <ClinchBadge indicator={clinchData[meta.tricode]!} />
                                                )}

                                                {/* Playoff seed label in Playoff Matchup view */}
                                                {viewMode.startsWith('PlayoffMatchup') && playoffSeedLabel && (
                                                    <span className="text-[10px] font-bold text-gray-500 ml-1 hidden md:inline">{playoffSeedLabel}</span>
                                                )}

                                                {/* Matchup visual indicator for Location Mode */}
                                                {(viewMode.includes('Location')) && (() => {
                                                    // For PlayoffMatchup: derive from team's playoff seeding (higher seed = home)
                                                    // Higher seeds: div winner [0] and div 2nd [1] → HOME; div 3rd [2] and WC → AWAY
                                                    if (viewMode.startsWith('PlayoffMatchup')) {
                                                        if (!team.isPlayoff) return null;
                                                        const label = idx % 2 === 0 ? 'HOME' : 'AWAY';
                                                        const isHome = label === 'HOME';
                                                        return (
                                                            <span className={isHome ? "text-[10px] font-bold uppercase ml-2 px-1 rounded text-blue-400 bg-blue-900/40" : "text-[10px] font-bold uppercase ml-2 px-1 rounded text-orange-400 bg-orange-900/40"}>
                                                                {label}
                                                            </span>
                                                        );
                                                    }
                                                    return (
                                                        <span className="text-[10px] font-bold text-gray-500 uppercase ml-2 bg-gray-800 px-1 rounded">
                                                            {idx % 2 === 0 ? 'HOME' : 'AWAY'}
                                                        </span>
                                                    );
                                                })()}

                                                {/* Odds Badge (Playing Today / Tomorrow modes only) */}
                                                {viewMode !== 'All' && (() => {
                                                    const oddsData = teamOddsLookup.get(team.team);
                                                    if (!oddsData || oddsData.vegasOdds == null) return null;
                                                    const vegasStr = oddsData.vegasOdds > 0 ? `+${oddsData.vegasOdds}` : `${oddsData.vegasOdds}`;
                                                    return (
                                                        <span
                                                            className="flex items-center gap-1 ml-auto shrink-0 cursor-default"
                                                            onMouseEnter={e => {
                                                                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                                                setOddsTooltip({
                                                                    x: rect.left,
                                                                    y: rect.bottom + 8,
                                                                    data: { ...oddsData, logoUrl: meta.logoUrl, tricode: meta.tricode },
                                                                });
                                                            }}
                                                            onMouseLeave={() => setOddsTooltip(null)}
                                                        >
                                                            <span className="text-[10px] font-bold px-1 py-0.5 rounded text-gray-400">
                                                                {vegasStr}
                                                            </span>
                                                            {oddsData.isRecommended && (
                                                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                                                            )}
                                                        </span>
                                                    );
                                                })()}
                                            </div>
                                        </td>

                                        {valuesMode === 'Ratings' ? (
                                            <>
                                                {/* Record columns (ranking → rw) */}
                                                {COLUMNS.slice(0, 8).map(col => {
                                                    if (!activeColumnKeys.has(col.k)) return null;
                                                    const isGroupEnd = col.k === 'rw';
                                                    return (
                                                        <React.Fragment key={col.k}>
                                                            {renderCell(team, col.k as keyof TeamStat, undefined, !!col.inv, !!col.isTime, isGroupEnd)}
                                                        </React.Fragment>
                                                    );
                                                })}
                                                {/* Ratings / Lineup / Goalie columns */}
                                                {RATINGS_COLS.map(col => {
                                                    if (!activeColumnKeys.has(col.k)) return null;
                                                    return (
                                                        <React.Fragment key={col.k}>
                                                            {renderRatingCell(team.team, col.k, col.inv, col.groupEnd)}
                                                        </React.Fragment>
                                                    );
                                                })}
                                            </>
                                        ) : (
                                            COLUMNS.map(col => {
                                                if (!activeColumnKeys.has(col.k)) return null;
                                                const isGroupEnd = STAT_GROUPS.some(g => g.columns[g.columns.length - 1] === col.k);

                                                return (
                                                    <React.Fragment key={col.k}>
                                                        {renderCell(team, col.k as keyof TeamStat, undefined, !!col.inv, !!col.isTime, isGroupEnd)}
                                                    </React.Fragment>
                                                );
                                            })
                                        )}
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

        {/* ── Odds tooltip rendered via portal to body — escapes any stacking context ── */}
        {oddsTooltip && typeof document !== 'undefined' && createPortal((() => {
            const { x, y, data } = oddsTooltip;
            const modelStr = data.modelOdds
                ? (!data.modelOdds.startsWith('+') && !data.modelOdds.startsWith('-') && parseFloat(data.modelOdds) > 0
                    ? `+${data.modelOdds}`
                    : data.modelOdds)
                : null;
            const evColor = (data.ev ?? 0) >= 0 ? '#34d399' : '#f87171';
            const recText = data.recommendation
                ? data.recommendation.replace(/^(Home|Away)\s+/i, '')
                : null;
            // Clamp left so tooltip stays on screen
            const W = 310;
            const vw = window.innerWidth;
            const left = Math.max(8, Math.min(x, vw - W - 8));
            return (
                <div
                    style={{
                        position: 'fixed',
                        left,
                        top: y,
                        width: W,
                        zIndex: 9999,
                        pointerEvents: 'none',
                    }}
                >
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 16,
                        padding: '12px 16px',
                        borderRadius: 12,
                        background: '#0f1621',
                        border: '1px solid rgba(255,255,255,0.10)',
                        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.8)',
                    }}>
                        {/* Team logo */}
                        {data.tricode && (
                            <div style={{ position: 'relative', width: 36, height: 36, flexShrink: 0 }}>
                                <Image src={`/logos/${data.tricode}.svg`} alt="" fill className="object-contain" />
                            </div>
                        )}
                        {/* Divider */}
                        {data.tricode && <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(255,255,255,0.08)' }} />}
                        {/* xG prediction */}
                        {data.xg != null && (
                            <>
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                                    <span style={{ fontSize: 15, fontWeight: 900, color: '#fff', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{data.xg.toFixed(2)}</span>
                                    <span style={{ fontSize: 8, fontWeight: 500, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.15em', lineHeight: 1 }}>xG</span>
                                </div>
                                <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(255,255,255,0.08)' }} />
                            </>
                        )}
                        {/* xOdds */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                            <span style={{ fontSize: 15, fontWeight: 900, color: '#fff', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{modelStr ?? '—'}</span>
                            <span style={{ fontSize: 8, fontWeight: 500, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.15em', lineHeight: 1 }}>xOdds</span>
                        </div>
                        {/* EV% */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                            <span style={{ fontSize: 15, fontWeight: 900, color: evColor, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                                {data.ev != null ? `${data.ev >= 0 ? '+' : ''}${data.ev.toFixed(1)}%` : '—'}
                            </span>
                            <span style={{ fontSize: 8, fontWeight: 500, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.15em', lineHeight: 1 }}>EV%</span>
                        </div>
                        {/* Rec — only if this team is the recommended side */}
                        {data.isRecommended && recText && (
                            <>
                                <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(255,255,255,0.08)' }} />
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                                    <span style={{ fontSize: 15, fontWeight: 900, color: '#fde047', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{recText}</span>
                                    <span style={{ fontSize: 8, fontWeight: 500, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.15em', lineHeight: 1 }}>Rec</span>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            );
        })(), document.body)}
        </>
    );
};

export default TeamsTable;
