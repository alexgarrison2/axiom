import React, { useMemo } from 'react';
import { GameLog, PlayerBoxscoreRow } from '@/types';
import GameBoxscore from '@/components/GameBoxscore';

interface GamesLogTableProps {
    games: GameLog[];
    filters: {
        goalie: string;
        loc: string;
        period: string;
        last: string;
        result: string;
    };
    expandedGameId: string | null;
    setExpandedGameId: (id: string | null) => void;
    teamAbbr: string;
    playerStats: PlayerBoxscoreRow[];
    teamLogos: Record<string, string>;
    primaryColor: string;
}

const GamesLogTable: React.FC<GamesLogTableProps> = ({
    games,
    filters,
    expandedGameId,
    setExpandedGameId,
    teamAbbr,
    playerStats,
    teamLogos,
    primaryColor
}) => {

    // Helper for Period Stats
    const getStat = (game: GameLog, stat: 'gf' | 'ga' | 'sf' | 'sa' | 'cf' | 'ca' | 'xgf' | 'xga' | 'hdf' | 'hda') => {
        if (filters.period === 'All') {
            return game[stat];
        }

        const suffix = filters.period === '1st' ? '_1P' :
            filters.period === '2nd' ? '_2P' :
                filters.period === '3rd' ? '_3P' : '_OT';

        // xG: use per-period columns from raw (xg_for_1P etc.)
        if (stat === 'xgf') return parseFloat((game.raw?.['xg_for' + suffix] as string) || '0');
        if (stat === 'xga') return parseFloat((game.raw?.['xg_ag' + suffix] as string) || '0');

        let prefix = '';
        if (stat === 'gf') prefix = 'goals_for';
        if (stat === 'ga') prefix = 'goals_ag';
        if (stat === 'sf') prefix = 'sog_for';
        if (stat === 'sa') prefix = 'sog_ag';
        if (stat === 'cf') prefix = 'attempts_for';
        if (stat === 'ca') prefix = 'attempts_ag';
        if (stat === 'hdf') prefix = 'hdf';
        if (stat === 'hda') prefix = 'hda';

        return parseInt((game.raw?.[prefix + suffix] as string) || '0');
    };

    // Per-period time helper: reads time_leading_1P etc. from raw, falls back to full-game value
    const getTimeStat = (game: GameLog, stat: 'time_leading' | 'time_trailing' | 'time_tied') => {
        if (filters.period === 'All') return game[stat] || 0;
        const suffix = filters.period === '1st' ? '_1P' :
            filters.period === '2nd' ? '_2P' :
                filters.period === '3rd' ? '_3P' : '_OT';
        const raw = game.raw?.[stat + suffix];
        return raw !== undefined ? parseInt(raw as string) || 0 : game[stat] || 0;
    };

    // Per-period control score from raw, falls back to full-game value
    const getControlScore = (game: GameLog) => {
        if (filters.period === 'All') return game.control_score || 1.0;
        const suffix = filters.period === '1st' ? '_1P' :
            filters.period === '2nd' ? '_2P' :
                filters.period === '3rd' ? '_3P' : '_OT';
        const raw = game.raw?.['control_score' + suffix];
        return raw !== undefined ? parseFloat(raw as string) || 1.0 : game.control_score || 1.0;
    };

    // Format seconds as mm:ss
    const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

    // Gradient Helper
    const getGradientColor = (value: number, min: number, mid: number, max: number) => {
        const val = Math.max(min, Math.min(max, value));
        let r, g, b;

        if (val < mid) {
            const ratio = (val - min) / (mid - min);
            r = Math.round(248 + (156 - 248) * ratio);
            g = Math.round(113 + (163 - 113) * ratio);
            b = Math.round(113 + (175 - 113) * ratio);
        } else {
            const ratio = (val - mid) / (max - mid);
            r = Math.round(156 + (96 - 156) * ratio);
            g = Math.round(163 + (165 - 163) * ratio);
            b = Math.round(175 + (250 - 175) * ratio);
        }
        return `rgb(${r}, ${g}, ${b})`;
    };

    // Totals Calculation
    const totals = useMemo(() => {
        if (games.length === 0) return null;

        const count = games.length;
        let w = 0, l = 0, otl = 0;

        games.forEach(g => {
            const res = g.result_code ? g.result_code.toUpperCase().trim() : '';
            if (['RW', 'OTW', 'SOW', 'W'].includes(res)) w++;
            else if (['RL', 'L'].includes(res)) l++;
            else if (['OTL', 'SOL'].includes(res)) otl++;
        });

        const pts = (w * 2) + otl;
        const pt_pct = count > 0 ? (pts / (count * 2)).toFixed(3).replace(/^0+/, '') : '.000';
        const record = `${w}-${l}-${otl} ${pts}pts (${pt_pct}) ${count} GP`;

        const sum = (key: 'gf' | 'ga' | 'sf' | 'sa' | 'cf' | 'ca' | 'xgf' | 'xga' | 'hdf' | 'hda') => games.reduce((acc, g) => acc + (getStat(g, key) as number), 0);

        const gf = sum('gf');
        const ga = sum('ga');
        const sf = sum('sf');
        const sa = sum('sa');
        const cf = sum('cf');
        const ca = sum('ca');
        const hdf = sum('hdf');
        const hda = sum('hda');
        const xgf = sum('xgf');
        const xga = sum('xga');
        const gsax = games.reduce((acc, g) => acc + (g.gsax || 0), 0);

        const en_gf = games.reduce((acc, g) => acc + g.en_gf, 0);
        const en_att = games.reduce((acc, g) => acc + g.en_att, 0);
        const en_ga = games.reduce((acc, g) => acc + g.en_ga, 0);
        const en_att_ag = games.reduce((acc, g) => acc + g.en_att_ag, 0);

        const time_leading_avg = games.reduce((acc, g) => acc + (g.time_leading || 0), 0) / count;
        const time_trailing_avg = games.reduce((acc, g) => acc + (g.time_trailing || 0), 0) / count;
        const time_tied_avg = games.reduce((acc, g) => acc + (g.time_tied || 0), 0) / count;
        const control_score_avg = games.reduce((acc, g) => acc + (g.control_score || 1), 0) / count;

        const pp_goals = games.reduce((acc, g) => acc + g.pp_goals, 0);
        const pp_opps = games.reduce((acc, g) => acc + g.pp_opps, 0);
        const pk_goals_ag = games.reduce((acc, g) => acc + g.pp_goals_against, 0);
        const pk_opps = games.reduce((acc, g) => acc + g.pk_opps, 0);

        const total_saves = games.reduce((acc, g) => acc + (getStat(g, 'sa') as number) - (getStat(g, 'ga') as number), 0);
        // Correct SV% by subtracting Empty Net Goals from Shots Against (only for Full Game totals where we have EN data)
        const adjusted_sa = sa - (filters.period === 'All' ? en_ga : 0);
        const tot_sv_pct = adjusted_sa > 0 ? (total_saves / adjusted_sa) : 0;

        return {
            record,
            gf: (gf / count).toFixed(1),
            ga: (ga / count).toFixed(1),
            gd: gf - ga,
            sf: (sf / count).toFixed(1),
            sa: (sa / count).toFixed(1),
            sd: (sf - sa),
            cf: (cf / count).toFixed(1),
            ca: (ca / count).toFixed(1),
            cd: (cf - ca),
            hdf: (hdf / count).toFixed(1),
            hda: (hda / count).toFixed(1),
            hdd: (hdf - hda),
            xgf: (xgf / count).toFixed(2),
            xga: (xga / count).toFixed(2),
            xgd: (xgf - xga).toFixed(2),
            gsax: gsax.toFixed(2),
            en_gf, en_att, en_ga, en_att_ag,
            time_leading_avg, time_trailing_avg, time_tied_avg, control_score_avg,
            pp_goals, pp_opps,
            pk_goals_ag, pk_opps,
            pp_pct: pp_opps > 0 ? (pp_goals / pp_opps * 100).toFixed(1) : '0.0',
            pk_pct: pk_opps > 0 ? (100 - (pk_goals_ag / pk_opps * 100)).toFixed(1) : '0.0',
            sh_pct: sf > 0 ? (gf / sf * 100).toFixed(1) : '0.0',
            sv_pct: tot_sv_pct.toFixed(3).replace(/^0+/, '')
        };
    }, [games, filters.period]);

    return (
        <div className="overflow-x-auto border border-gray-800 rounded-lg bg-gray-900/50">
            <table className="w-full text-xs text-left whitespace-nowrap border-collapse">
                <thead className="bg-gray-900/80 text-gray-400 font-bold uppercase tracking-wider border-b border-gray-700">
                    <tr>
                        <th className="p-1 sticky left-0 bg-gray-900 z-30 min-w-[2rem] w-8 text-center text-gray-500">#</th>
                        <th className="p-1 sticky left-8 bg-gray-900 z-30 min-w-[6rem] w-24 text-center border-r border-gray-700">Date</th>
                        <th className="p-1 sticky left-32 bg-gray-900 z-30 min-w-[2rem] w-8 text-center border-r border-gray-700">Loc</th>
                        <th className="p-1 sticky left-40 bg-gray-900 z-30 min-w-[3rem] w-12 text-center border-r border-gray-700">Opp</th>
                        <th className="p-1">Starter</th>
                        <th className="p-1">Opp Strt</th>
                        <th className="p-1 text-center">Res</th>
                        <th className="p-1 text-center">GF</th>
                        <th className="p-1 text-center">GA</th>
                        <th className="p-1 text-center">GΔ</th>
                        {filters.period === 'All' && (
                            <>
                                <th className="p-1 text-center text-blue-300">Powerplay</th>
                                <th className="p-1 text-center text-red-300">Penalty Kill</th>
                            </>
                        )}
                        <th className="p-1 text-center">SF</th>
                        <th className="p-1 text-center">SA</th>
                        <th className="p-1 text-center">SΔ</th>
                        <th className="p-1 text-center">CF</th>
                        <th className="p-1 text-center">CA</th>
                        <th className="p-1 text-center">CΔ</th>
                        <th className="p-1 text-center">HDF</th>
                        <th className="p-1 text-center">HDA</th>
                        <th className="p-1 text-center">HDΔ</th>
                        <th className="p-1 text-center border-l border-gray-700">SH%</th>
                        <th className="p-1 text-center">SV%</th>
                        <th className="p-1 text-center">GSAx</th>
                        <th className="p-1 text-center">xGF</th>
                        <th className="p-1 text-center">xGA</th>
                        <th className="p-1 text-center">xGΔ</th>
                        <th className="p-1 text-center border-l border-gray-700">T↑/G</th>
                        <th className="p-1 text-center">T↓/G</th>
                        <th className="p-1 text-center border-r border-gray-700">T=/G</th>
                        <th className="p-1 text-center border-r border-gray-700">Control</th>
                        <th className="p-1 text-center">EN GF</th>
                        <th className="p-1 text-center">EN Att</th>
                        <th className="p-1 text-center">OTML</th>
                        <th className="p-1 text-center">EN GA</th>
                        <th className="p-1 text-center">EN Att Ag</th>
                    </tr>
                    {totals && (
                        <tr className="bg-white/10 font-bold border-b border-white/20 text-white">
                            <td className="p-1 sticky left-0 bg-[#1c1c1c] z-30 border-r border-gray-800 text-center min-w-[2rem] w-8"></td>
                            <td className="p-1 sticky left-8 bg-[#1c1c1c] z-30 border-r border-gray-700 text-center min-w-[6rem] w-24">TOTALS</td>
                            <td className="p-1 sticky left-32 bg-[#1c1c1c] z-30 border-r border-gray-800 text-center min-w-[2rem] w-8"></td>
                            <td className="p-1 sticky left-40 bg-[#1c1c1c] z-30 border-r border-gray-800 text-center min-w-[3rem] w-12"></td>
                            <td colSpan={3} className="p-1 text-center text-gray-400 text-[10px] tracking-wider uppercase">{totals.record}</td>
                            <td className="p-1 text-center text-white">{totals.gf}</td>
                            <td className="p-1 text-center text-white">{totals.ga}</td>
                            <td className={`p-1 text-center ${totals.gd > 0 ? 'text-green-400' : totals.gd < 0 ? 'text-red-400' : 'text-gray-500'}`}>{totals.gd > 0 ? '+' : ''}{totals.gd}</td>
                            {filters.period === 'All' && (
                                <>
                                    <td className="p-1 text-center text-blue-300">{totals.pp_goals} / {totals.pp_opps} ({totals.pp_pct}%)</td>
                                    <td className="p-1 text-center text-red-300">{totals.pk_goals_ag} / {totals.pk_opps} ({totals.pk_pct}%)</td>
                                </>
                            )}
                            <td className="p-1 text-center text-gray-300">{totals.sf}</td>
                            <td className="p-1 text-center text-gray-300">{totals.sa}</td>
                            <td className={`p-1 text-center ${totals.sd > 0 ? 'text-green-400' : totals.sd < 0 ? 'text-red-400' : 'text-gray-500'}`}>{totals.sd > 0 ? '+' : ''}{totals.sd}</td>
                            <td className="p-1 text-center text-gray-300">{totals.cf}</td>
                            <td className="p-1 text-center text-gray-300">{totals.ca}</td>
                            <td className={`p-1 text-center ${totals.cd > 0 ? 'text-green-400' : totals.cd < 0 ? 'text-red-400' : 'text-gray-500'}`}>{totals.cd > 0 ? '+' : ''}{totals.cd}</td>
                            <td className="p-1 text-center text-orange-200">{totals.hdf}</td>
                            <td className="p-1 text-center text-orange-200">{totals.hda}</td>
                            <td className={`p-1 text-center ${totals.hdd > 0 ? 'text-green-400' : totals.hdd < 0 ? 'text-red-400' : 'text-gray-500'}`}>{totals.hdd > 0 ? '+' : ''}{totals.hdd}</td>
                            <td className="p-1 text-center border-l border-gray-800" style={{ color: getGradientColor(parseFloat(totals.sh_pct), 0, 10, 20) }}>{totals.sh_pct}%</td>
                            <td className="p-1 text-center" style={{ color: getGradientColor(parseFloat(totals.sv_pct), 0.800, 0.885, 0.945) }}>{totals.sv_pct}</td>
                            <td className={`p-1 text-center ${parseFloat(totals.gsax) > 0 ? 'text-green-400' : 'text-red-400'}`}>{parseFloat(totals.gsax) > 0 ? '+' : ''}{totals.gsax}</td>
                            <td className="p-1 text-center text-gray-300">{totals.xgf}</td>
                            <td className="p-1 text-center text-gray-300">{totals.xga}</td>
                            <td className={`p-1 text-center ${parseFloat(totals.xgd) > 0 ? 'text-green-400' : parseFloat(totals.xgd) < 0 ? 'text-red-400' : 'text-gray-500'}`}>{parseFloat(totals.xgd) > 0 ? '+' : ''}{totals.xgd}</td>
                            <td className="p-1 text-center border-l border-gray-700" style={{ color: getGradientColor(totals.time_leading_avg, 0, 1500, 3000) }}>{formatTime(totals.time_leading_avg)}</td>
                            <td className="p-1 text-center" style={{ color: getGradientColor(3000 - totals.time_trailing_avg, 0, 1500, 3000) }}>{formatTime(totals.time_trailing_avg)}</td>
                            <td className="p-1 text-center border-r border-gray-700" style={{ color: getGradientColor(totals.time_tied_avg, 0, 600, 2000) }}>{formatTime(totals.time_tied_avg)}</td>
                            <td className="p-1 text-center border-r border-gray-700" style={{ color: getGradientColor(totals.control_score_avg, 0.7, 1.0, 1.3) }}>{totals.control_score_avg.toFixed(3)}</td>
                            <td className="p-1 text-center text-gray-500">{totals.en_att > 0 ? totals.en_gf : '-'}</td>
                            <td className="p-1 text-center text-gray-500">{totals.en_att > 0 ? totals.en_att : '-'}</td>
                            <td></td>
                            <td className="p-1 text-center text-gray-500">{totals.en_att_ag > 0 ? totals.en_ga : '-'}</td>
                            <td className="p-1 text-center text-gray-500">{totals.en_att_ag > 0 ? totals.en_att_ag : '-'}</td>
                        </tr>
                    )}
                </thead>
                <tbody className="divide-y divide-gray-800">
                    {games.length === 0 ?
                        <tr><td colSpan={30} className="p-4 text-center text-gray-500">No games played.</td></tr>
                        : games.map((game, idx) => {
                            const isExpanded = expandedGameId === game.game_id;

                            const gf = getStat(game, 'gf');
                            const ga = getStat(game, 'ga');
                            const sf = getStat(game, 'sf');
                            const sa = getStat(game, 'sa');
                            const cf = getStat(game, 'cf');
                            const ca = getStat(game, 'ca');
                            const hdf = getStat(game, 'hdf');
                            const hda = getStat(game, 'hda');

                            // Safe parsing
                            const _gf = typeof gf === 'number' ? gf : 0;
                            const _ga = typeof ga === 'number' ? ga : 0;
                            const _sf = typeof sf === 'number' ? sf : 0;
                            const _sa = typeof sa === 'number' ? sa : 0;
                            const _cf = typeof cf === 'number' ? cf : 0;
                            const _ca = typeof ca === 'number' ? ca : 0;
                            const _hdf = typeof hdf === 'number' ? hdf : 0;
                            const _hda = typeof hda === 'number' ? hda : 0;

                            const gd = _gf - _ga;
                            const sd = _sf - _sa;
                            const cd = _cf - _ca;
                            const hdd = _hdf - _hda;

                            // xG: use period-specific via getStat
                            const _xgf = (getStat(game, 'xgf') as number) || 0;
                            const _xga = (getStat(game, 'xga') as number) || 0;
                            const xgd = _xgf - _xga;

                            const sh_pct = _sf > 0 ? (_gf / _sf * 100).toFixed(1) : "0.0";
                            // For SV%, exclude Empty Net Goals from the denominator (Shots Against).
                            // Only apply correction if we are looking at Full Game, because we don't have period-specific EN stats.
                            const adjusted_sa = _sa > 0 ? _sa - (filters.period === 'All' ? game.en_ga : 0) : 0;
                            const sv_pct_val = adjusted_sa > 0 ? ((_sa - _ga) / adjusted_sa).toFixed(3).replace(/^0+/, '') : ".000";

                            // GSAx: xGA - (GA - EN GA). In period mode, no EN correction (no per-period EN data).
                            const gsax = (_xga - (_ga - (filters.period === 'All' ? game.en_ga : 0))).toFixed(2);
                            const opponentName = game.opponent.trim();
                            const logoUrl = teamLogos ? (teamLogos[opponentName] || teamLogos[opponentName.split(' ').pop() || ''] || '') : '';

                            return (
                                <React.Fragment key={game.game_id}>
                                    <tr
                                        onClick={() => setExpandedGameId(isExpanded ? null : game.game_id)}
                                        className={`cursor-pointer transition-colors hover:bg-white/5 ${idx % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.02]'} ${isExpanded ? 'bg-white/10' : ''}`}
                                    >
                                        <td className="p-1 sticky left-0 bg-[#09090b] border-r border-gray-800 z-20 text-center font-mono text-gray-500 text-[10px] min-w-[2rem] w-8">{game.game_number}</td>
                                        <td className="p-1 sticky left-8 bg-[#09090b] border-r border-gray-700 z-20 font-mono text-gray-300 min-w-[6rem] w-24 text-center text-[11px]">{game.date}</td>
                                        <td className={`p-1 sticky left-32 bg-[#09090b] border-r border-gray-700 z-20 text-center font-bold text-[10px] min-w-[2rem] w-8 ${game.home_away === 'Home' ? 'text-gray-500' : 'text-blue-400'}`}>
                                            {game.home_away === 'Home' ? 'vs' : '@'}
                                        </td>
                                        <td className="p-1 sticky left-40 bg-[#09090b] border-r border-gray-700 z-20 justify-center min-w-[3rem] w-12 text-center">
                                            <div className="w-5 h-5 relative mx-auto" title={game.opponent}>
                                                {logoUrl ? <img src={logoUrl} alt={game.opponent} className="w-5 h-5 object-contain" /> : <span className='text-[9px]'>{game.opponent.substring(0, 3)}</span>}
                                            </div>
                                        </td>
                                        <td className="p-1 text-gray-400 text-[10px] truncate max-w-[80px]" title={game.starting_goalie}>
                                            {game.starting_goalie ? game.starting_goalie.split(' ').pop() : '-'}
                                        </td>
                                        <td className="p-1 text-gray-400 text-[10px] truncate max-w-[80px]" title={game.opponent_starter}>
                                            {game.opponent_starter ? game.opponent_starter.split(' ').pop() : '-'}
                                        </td>
                                        <td className="p-1 text-center">
                                            <span className={`px-1 py-0.5 rounded text-[10px] font-black ${game.result_code.includes('W') ? 'bg-green-900/40 text-green-400 border border-green-500/20' :
                                                game.result_code.includes('OTL') || game.result_code.includes('SOL') ? 'bg-orange-900/40 text-orange-400 border border-orange-500/20' :
                                                    'bg-red-900/40 text-red-400 border border-red-500/20'
                                                }`}>
                                                {game.result}
                                            </span>
                                        </td>
                                        <td className="p-1 text-center font-mono text-white">{gf}</td>
                                        <td className="p-1 text-center font-mono text-white">{ga}</td>
                                        <td className={`p-1 text-center font-bold font-mono ${gd > 0 ? 'text-green-400' : gd < 0 ? 'text-red-400' : 'text-gray-500'}`}>
                                            {gd > 0 ? '+' : ''}{gd}
                                        </td>
                                        {filters.period === 'All' && (
                                            <>
                                                <td className="p-1 text-center font-mono text-blue-300">
                                                    {game.pp_goals} / {game.pp_opps}
                                                </td>
                                                <td className="p-1 text-center font-mono text-red-300">
                                                    {game.pp_goals_against} / {game.pk_opps}
                                                </td>
                                            </>
                                        )}
                                        <td className="p-1 text-center font-mono text-gray-300">{sf}</td>
                                        <td className="p-1 text-center font-mono text-gray-300">{sa}</td>
                                        <td className={`p-1 text-center font-mono ${sd > 0 ? 'text-green-400/70' : sd < 0 ? 'text-red-400/70' : 'text-gray-500'}`}>
                                            {sd > 0 ? '+' : ''}{sd}
                                        </td>
                                        <td className="p-1 text-center font-mono text-gray-300">{cf}</td>
                                        <td className="p-1 text-center font-mono text-gray-300">{ca}</td>
                                        <td className={`p-1 text-center font-mono ${cd > 0 ? 'text-green-400/70' : cd < 0 ? 'text-red-400/70' : 'text-gray-500'}`}>
                                            {cd > 0 ? '+' : ''}{cd}
                                        </td>
                                        <td className="p-1 text-center font-mono text-orange-200">{_hdf}</td>
                                        <td className="p-1 text-center font-mono text-orange-200">{_hda}</td>
                                        <td className={`p-1 text-center font-mono ${hdd > 0 ? 'text-green-400/70' : hdd < 0 ? 'text-red-400/70' : 'text-gray-500'}`}>
                                            {hdd > 0 ? '+' : ''}{hdd}
                                        </td>
                                        <td className="p-1 text-center font-mono border-l border-gray-800" style={{ color: getGradientColor(parseFloat(sh_pct), 0, 10, 20) }}>{sh_pct}%</td>
                                        <td className="p-1 text-center font-mono" style={{ color: getGradientColor(parseFloat(sv_pct_val), 0.800, 0.885, 0.945) }}>{sv_pct_val}</td>
                                        <td className={`p-1 text-center font-mono font-bold ${parseFloat(gsax) > 0 ? 'text-green-400' : 'text-red-400'}`}>{gsax}</td>
                                        <td className="p-1 text-center font-mono text-gray-300">{_xgf.toFixed(2)}</td>
                                        <td className="p-1 text-center font-mono text-gray-300">{_xga.toFixed(2)}</td>
                                        <td className={`p-1 text-center font-mono ${xgd > 0 ? 'text-green-400/70' : xgd < 0 ? 'text-red-400/70' : 'text-gray-500'}`}>
                                            {xgd > 0 ? '+' : ''}{xgd.toFixed(2)}
                                        </td>
                                        <td className="p-1 text-center font-mono border-l border-gray-800" style={{ color: getGradientColor(getTimeStat(game, 'time_leading'), 0, 1500, 3000) }}>{formatTime(getTimeStat(game, 'time_leading'))}</td>
                                        <td className="p-1 text-center font-mono" style={{ color: getGradientColor(3000 - getTimeStat(game, 'time_trailing'), 0, 1500, 3000) }}>{formatTime(getTimeStat(game, 'time_trailing'))}</td>
                                        <td className="p-1 text-center font-mono border-r border-gray-800" style={{ color: getGradientColor(getTimeStat(game, 'time_tied'), 0, 600, 2000) }}>{formatTime(getTimeStat(game, 'time_tied'))}</td>
                                        <td className="p-1 text-center font-mono border-r border-gray-800" style={{ color: getGradientColor(getControlScore(game), 0.7, 1.0, 1.3) }}>{getControlScore(game).toFixed(3)}</td>
                                        <td className="p-1 text-center font-mono text-gray-500">{game.en_att > 0 ? game.en_gf : '-'}</td>
                                        <td className="p-1 text-center font-mono text-gray-500">{game.en_att > 0 ? game.en_att : '-'}</td>
                                        <td className={`p-1 text-center font-mono ${game.otml === 'Yes' ? 'text-red-400 font-bold' : 'text-gray-500'}`}>{game.otml}</td>
                                        <td className="p-1 text-center font-mono text-gray-500">{game.en_att_ag > 0 ? game.en_ga : '-'}</td>
                                        <td className="p-1 text-center font-mono text-gray-500">{game.en_att_ag > 0 ? game.en_att_ag : '-'}</td>
                                    </tr>
                                    {isExpanded && (
                                        <tr>
                                            <td colSpan={30} className="p-0 border-b border-gray-800 bg-gray-900/50">
                                                <div className="p-4 border-l-4" style={{ borderColor: primaryColor }}>
                                                    <GameBoxscore
                                                        gameId={String(game.game_id)}
                                                        teamAbbr={teamAbbr}
                                                        playerStats={playerStats.filter(p => String(p.game_id) === String(game.game_id))}
                                                    />
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })
                    }
                </tbody>
            </table>
        </div>
    );
};

export default GamesLogTable;
