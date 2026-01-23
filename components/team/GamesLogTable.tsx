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
        strength?: string; // Optional to prevent breaking if not passed immediately (though we sort of control it)
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

    // ... (getStat and helpers above) ... (Logic was updated in previous step via range, but I need to make sure I don't overwrite it incorrectly if I target this block)
    // Wait, the previous block I replaced STARTED with getStat.
    // This replacement targets the Props definition which is ABOVE getStat.
    // So I should be careful.

    // Actually, I can just replace the interface definition and the component start.

    // Oh, I see I also need to update the ROW rendering logic variables.
    // Lines 235-260 calculate per-game stats `gf`, `ga`, etc.
    // They ALREADY use `getStat`. So if `getStat` is updated (which I did in previous step), `gf/ga` will be correct.
    // However, `adjusted_sa` logic needs to match the Totals logic I just added.

    // Re-paste logic for row inside map:

    /*
                                const gf = getStat(game, 'gf');
                                const ga = getStat(game, 'ga');
                                const sf = getStat(game, 'sf');
                                const sa = getStat(game, 'sa');
                                const cf = getStat(game, 'cf');
                                const ca = getStat(game, 'ca');
    
                                // Safe parsing
                                const _gf = typeof gf === 'number' ? gf : 0;
                                const _ga = typeof ga === 'number' ? ga : 0;
                                const _sf = typeof sf === 'number' ? sf : 0;
                                const _sa = typeof sa === 'number' ? sa : 0;
                                const _cf = typeof cf === 'number' ? cf : 0;
                                const _ca = typeof ca === 'number' ? ca : 0;
    
                                const gd = _gf - _ga;
                                const sd = _sf - _sa;
                                const cd = _cf - _ca;
                                // xG logic: game.xgf is total. We need filtered if available.
                                const _xgf = getStat(game, 'xgf');
                                const _xga = getStat(game, 'xga');
                                const _xgf_val = typeof _xgf === 'number' ? _xgf : 0;
                                const _xga_val = typeof _xga === 'number' ? _xga : 0;
                                
                                const xgd = _xgf_val - _xga_val;
    
                                const sh_pct = _sf > 0 ? (_gf / _sf * 100).toFixed(1) : "0.0";
                                
                                // Sv% correction
                                let adjusted_sa = _sa;
                                if (filters.period === 'All' && (!filters.strength || filters.strength === 'All')) {
                                    adjusted_sa = _sa > 0 ? _sa - game.en_ga : 0;
                                }
                                
                                const sv_pct_val = adjusted_sa > 0 ? ((_sa - _ga) / adjusted_sa).toFixed(3).replace(/^0+/, '') : ".000";
    */

    // I will replace lines 6-13 (filters interface) AND lines 235-260 (Row logic) in ONE GO?
    // No, I can't do non-contiguous edits with `replace_file_content`.
    // I will use `replace_file_content` for Prop Definition first.

    return null; // Pseudo-return, I will actually make the tool call.

    // Since I messed up my thought process, I'll do two edits or use multi_replace.
    // I'll use multi_replace to be clean.

    // Actually, I already updated the component BODY (getStat, totals). 
    // I just need to update the Interface and the Row Logic.

    // I will use multi_replace.

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

    // Helper for Period/Strength Stats
    const getStat = (game: GameLog, stat: 'gf' | 'ga' | 'sf' | 'sa' | 'cf' | 'ca' | 'xgf' | 'xga') => {
        let prefix = '';
        if (stat === 'gf') prefix = 'goals_for';
        if (stat === 'ga') prefix = 'goals_ag';
        if (stat === 'sf') prefix = 'sog_for';
        if (stat === 'sa') prefix = 'sog_ag';
        if (stat === 'cf') prefix = 'attempts_for';
        if (stat === 'ca') prefix = 'attempts_ag';
        if (stat === 'xgf') prefix = 'xG_for';
        if (stat === 'xga') prefix = 'xG_against';

        // Handle Period First (If Period is selected, it takes precedence OR we don't support Period + Strength together?)
        // If Period is 'All', check Strength
        // If Period is 1st/2nd/3rd, we likely don't have Strength split per period (our script doesn't produce it).
        // Current script produces: totals, 5v5 totals, period totals.
        // It does NOT produce 5v5 per period.
        // So if Period != All, we ignore Strength filter or warn?
        // Let's assume if Period != All, we use Period. 
        // If Period == All, we use Strength.

        if (filters.period !== 'All') {
            // Period Stats
            if (stat === 'xgf' || stat === 'xga') return 0; // No period xG yet

            const suffix = filters.period === '1st' ? '_1P' :
                filters.period === '2nd' ? '_2P' :
                    filters.period === '3rd' ? '_3P' : '_OT';

            return parseInt(game.raw?.[prefix + suffix] || '0');
        } else if (filters.strength && filters.strength !== 'All') {
            // Strength Stats (Full Game)
            const s = filters.strength.toLowerCase(); // 5v5, ev, pp, sh
            let key = prefix;

            // Map prefix to split keys
            // goals_for -> goals_5v5
            // goals_ag -> goals_ag_5v5
            // sog_for -> sog_5v5
            // sog_ag -> sog_ag_5v5
            // attempts_for -> attempts_5v5
            // attempts_ag -> attempts_ag_5v5
            // xG_for -> xg_for_5v5
            // xG_against -> xg_ag_5v5

            if (stat === 'gf') key = `goals_${s}`;
            if (stat === 'ga') key = `goals_ag_${s}`;
            if (stat === 'sf') key = `sog_${s}`;
            if (stat === 'sa') key = `sog_ag_${s}`;
            if (stat === 'cf') key = `attempts_${s}`;
            if (stat === 'ca') key = `attempts_ag_${s}`;
            if (stat === 'xgf') key = `xg_for_${s}`;
            if (stat === 'xga') key = `xg_ag_${s}`;

            return parseFloat(game.raw?.[key] || '0');
        }

        // Default: Full Game All Strengths
        // For xG, values are floats in game object, but integers for others?
        // GameLog interface has typed props (gf, ga...). 
        // We can just return game[stat] if period and strength are All.

        if (stat === 'gf') return game.gf;
        if (stat === 'ga') return game.ga;
        if (stat === 'sf') return game.sf;
        if (stat === 'sa') return game.sa;
        if (stat === 'cf') return game.cf;
        if (stat === 'ca') return game.ca;
        if (stat === 'xgf') return game.xgf;
        if (stat === 'xga') return game.xga;

        return 0;
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

        const sum = (key: 'gf' | 'ga' | 'sf' | 'sa' | 'cf' | 'ca' | 'xgf' | 'xga') => games.reduce((acc, g) => acc + (getStat(g, key) as number), 0);

        const gf = sum('gf');
        const ga = sum('ga');
        const sf = sum('sf');
        const sa = sum('sa');
        const cf = sum('cf');
        const ca = sum('ca');
        const xgf = sum('xgf');
        const xga = sum('xga');
        const gsax = games.reduce((acc, g) => acc + (g.gsax || 0), 0);

        const en_gf = games.reduce((acc, g) => acc + g.en_gf, 0);
        const en_att = games.reduce((acc, g) => acc + g.en_att, 0);
        const en_ga = games.reduce((acc, g) => acc + g.en_ga, 0);
        const en_att_ag = games.reduce((acc, g) => acc + g.en_att_ag, 0);

        const pp_goals = games.reduce((acc, g) => acc + g.pp_goals, 0);
        const pp_opps = games.reduce((acc, g) => acc + g.pp_opps, 0);
        const pk_goals_ag = games.reduce((acc, g) => acc + g.pp_goals_against, 0);
        const pk_opps = games.reduce((acc, g) => acc + g.pk_opps, 0);

        const total_saves = games.reduce((acc, g) => acc + (getStat(g, 'sa') as number) - (getStat(g, 'ga') as number), 0);
        // Correct SV%
        // If Strength Filter != All, use filtered SA and GA (EN usually 0).
        // If Strength == All (and Period == All ?), subtract EN.

        let adjusted_sa = sa;
        if (filters.period === 'All' && (!filters.strength || filters.strength === 'All')) {
            adjusted_sa = sa - en_ga;
        }

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
            xgf: (xgf / count).toFixed(2),
            xga: (xga / count).toFixed(2),
            xgd: (xgf - xga).toFixed(2),
            gsax: gsax.toFixed(2),
            en_gf, en_att, en_ga, en_att_ag,
            pp_goals, pp_opps,
            pk_goals_ag, pk_opps,
            pp_pct: pp_opps > 0 ? (pp_goals / pp_opps * 100).toFixed(1) : '0.0',
            pk_pct: pk_opps > 0 ? (100 - (pk_goals_ag / pk_opps * 100)).toFixed(1) : '0.0',
            sh_pct: sf > 0 ? (gf / sf * 100).toFixed(1) : '0.0',
            sv_pct: tot_sv_pct.toFixed(3).replace(/^0+/, '')
        };
    }, [games, filters.period, filters.strength]);

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
                        <th className="p-1 text-center">SH%</th>
                        <th className="p-1 text-center">SV%</th>
                        {filters.period === 'All' && <th className="p-1 text-center">GSAx</th>}
                        {filters.period === 'All' && (
                            <>
                                <th className="p-1 text-center">xGF</th>
                                <th className="p-1 text-center">xGA</th>
                                <th className="p-1 text-center">xGΔ</th>
                            </>
                        )}
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
                            <td className="p-1 text-center" style={{ color: getGradientColor(parseFloat(totals.sh_pct), 0, 10, 20) }}>{totals.sh_pct}%</td>
                            <td className="p-1 text-center" style={{ color: getGradientColor(parseFloat(totals.sv_pct), 0.800, 0.885, 0.945) }}>{totals.sv_pct}</td>
                            {filters.period === 'All' && <td className={`p-1 text-center ${parseFloat(totals.gsax) > 0 ? 'text-green-400' : 'text-red-400'}`}>{parseFloat(totals.gsax) > 0 ? '+' : ''}{totals.gsax}</td>}
                            {filters.period === 'All' && (
                                <>
                                    <td className="p-1 text-center text-gray-300">{totals.xgf}</td>
                                    <td className="p-1 text-center text-gray-300">{totals.xga}</td>
                                    <td className={`p-1 text-center ${parseFloat(totals.xgd) > 0 ? 'text-green-400' : parseFloat(totals.xgd) < 0 ? 'text-red-400' : 'text-gray-500'}`}>{parseFloat(totals.xgd) > 0 ? '+' : ''}{totals.xgd}</td>
                                </>
                            )}
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

                            // Safe parsing
                            const _gf = typeof gf === 'number' ? gf : 0;
                            const _ga = typeof ga === 'number' ? ga : 0;
                            const _sf = typeof sf === 'number' ? sf : 0;
                            const _sa = typeof sa === 'number' ? sa : 0;
                            const _cf = typeof cf === 'number' ? cf : 0;
                            const _ca = typeof ca === 'number' ? ca : 0;

                            const gd = _gf - _ga;
                            const sd = _sf - _sa;
                            const cd = _cf - _ca;

                            // xG Logic (Use filtered)
                            const _xgf = getStat(game, 'xgf');
                            const _xga = getStat(game, 'xga');
                            const _xgf_val = typeof _xgf === 'number' ? _xgf : 0;
                            const _xga_val = typeof _xga === 'number' ? _xga : 0;
                            const xgd = _xgf_val - _xga_val;

                            const sh_pct = _sf > 0 ? (_gf / _sf * 100).toFixed(1) : "0.0";

                            // Sv% correction
                            let adjusted_sa = _sa;
                            // Only subtract EN GA if looking at ALL situations (and All Periods)
                            // If filtered to 5v5/EV/PP/SH, use raw SA (since EN GA shouldn't exist or is handled)
                            if (filters.period === 'All' && (!filters.strength || filters.strength === 'All')) {
                                adjusted_sa = _sa > 0 ? _sa - game.en_ga : 0;
                            }

                            const sv_pct_val = adjusted_sa > 0 ? ((_sa - _ga) / adjusted_sa).toFixed(3).replace(/^0+/, '') : ".000";

                            const gsax = (game.xga - (game.ga - game.en_ga)).toFixed(2);
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
                                        <td className="p-1 text-center font-mono" style={{ color: getGradientColor(parseFloat(sh_pct), 0, 10, 20) }}>{sh_pct}%</td>
                                        <td className="p-1 text-center font-mono" style={{ color: getGradientColor(parseFloat(sv_pct_val), 0.800, 0.885, 0.945) }}>{sv_pct_val}</td>
                                        {filters.period === 'All' && <td className={`p-1 text-center font-mono font-bold ${parseFloat(gsax) > 0 ? 'text-green-400' : 'text-red-400'}`}>{gsax}</td>}
                                        {filters.period === 'All' && (
                                            <>
                                                <td className="p-1 text-center font-mono text-gray-300">{_xgf_val.toFixed(2)}</td>
                                                <td className="p-1 text-center font-mono text-gray-300">{_xga_val.toFixed(2)}</td>
                                                <td className={`p-1 text-center font-mono ${xgd > 0 ? 'text-green-400/70' : xgd < 0 ? 'text-red-400/70' : 'text-gray-500'}`}>
                                                    {xgd > 0 ? '+' : ''}{xgd.toFixed(2)}
                                                </td>
                                            </>
                                        )}
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
