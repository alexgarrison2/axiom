import React, { useMemo, useState } from 'react';
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
    const isAllTeams = teamAbbr === 'ALL';

    // ── Sort State ──────────────────────────────────────────────────────────
    const [sortKey, setSortKey] = useState<string | null>(null);
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

    const handleSort = (key: string) => {
        if (sortKey === key) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortDir('desc');
        }
    };

    // ── Period Stat Helpers ─────────────────────────────────────────────────
    const getStat = (game: GameLog, stat: 'gf' | 'ga' | 'sf' | 'sa' | 'cf' | 'ca' | 'xgf' | 'xga' | 'hdf' | 'hda') => {
        if (filters.period === 'All') {
            return game[stat];
        }

        const suffix = filters.period === '1st' ? '_1P' :
            filters.period === '2nd' ? '_2P' :
                filters.period === '3rd' ? '_3P' : '_OT';

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

    const getTimeStat = (game: GameLog, stat: 'time_leading' | 'time_trailing' | 'time_tied') => {
        if (filters.period === 'All') return game[stat] || 0;
        const suffix = filters.period === '1st' ? '_1P' :
            filters.period === '2nd' ? '_2P' :
                filters.period === '3rd' ? '_3P' : '_OT';
        const raw = game.raw?.[stat + suffix];
        return raw !== undefined ? parseInt(raw as string) || 0 : game[stat] || 0;
    };

    const getControlScore = (game: GameLog) => {
        if (filters.period === 'All') return game.control_score || 1.0;
        const suffix = filters.period === '1st' ? '_1P' :
            filters.period === '2nd' ? '_2P' :
                filters.period === '3rd' ? '_3P' : '_OT';
        const raw = game.raw?.['control_score' + suffix];
        return raw !== undefined ? parseFloat(raw as string) || 1.0 : game.control_score || 1.0;
    };

    const formatTime = (seconds: number) => {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    };

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

    // ── Sort Value ──────────────────────────────────────────────────────────
    const getSortValue = (game: GameLog, key: string): number | string => {
        switch (key) {
            case '#': return game.game_number;
            case 'Date': return game.date;
            case 'TM': return (game.raw?.team as string) || '';
            case 'Loc': return game.home_away;
            case 'Opp': return game.opponent;
            case 'Starter': return game.starting_goalie || '';
            case 'Opp Strt': return game.opponent_starter || '';
            case 'Res': {
                const rc = game.result_code?.toUpperCase() || '';
                if (['RW', 'OTW', 'SOW', 'W'].includes(rc)) return 0;
                if (['OTL', 'SOL'].includes(rc)) return 1;
                return 2;
            }
            case 'GF': return (getStat(game, 'gf') as number) || 0;
            case 'GA': return (getStat(game, 'ga') as number) || 0;
            case 'GΔ': return ((getStat(game, 'gf') as number) || 0) - ((getStat(game, 'ga') as number) || 0);
            case 'PP': return game.pp_opps > 0 ? game.pp_goals / game.pp_opps : 0;
            case 'PK': return game.pk_opps > 0 ? 1 - (game.pp_goals_against / game.pk_opps) : 1;
            case 'SF': return (getStat(game, 'sf') as number) || 0;
            case 'SA': return (getStat(game, 'sa') as number) || 0;
            case 'SΔ': return ((getStat(game, 'sf') as number) || 0) - ((getStat(game, 'sa') as number) || 0);
            case 'CF': return (getStat(game, 'cf') as number) || 0;
            case 'CA': return (getStat(game, 'ca') as number) || 0;
            case 'CΔ': return ((getStat(game, 'cf') as number) || 0) - ((getStat(game, 'ca') as number) || 0);
            case 'HDF': return (getStat(game, 'hdf') as number) || 0;
            case 'HDA': return (getStat(game, 'hda') as number) || 0;
            case 'HDΔ': return ((getStat(game, 'hdf') as number) || 0) - ((getStat(game, 'hda') as number) || 0);
            case 'SH%': {
                const sf = (getStat(game, 'sf') as number) || 0;
                const gf = (getStat(game, 'gf') as number) || 0;
                return sf > 0 ? gf / sf : 0;
            }
            case 'SV%': {
                const sa = (getStat(game, 'sa') as number) || 0;
                const ga = (getStat(game, 'ga') as number) || 0;
                const adj = sa - (filters.period === 'All' ? game.en_ga : 0);
                return adj > 0 ? (sa - ga) / adj : 0;
            }
            case 'GSAx': {
                const xga = (getStat(game, 'xga') as number) || 0;
                const ga = (getStat(game, 'ga') as number) || 0;
                return xga - (ga - (filters.period === 'All' ? game.en_ga : 0));
            }
            case 'xGF': return (getStat(game, 'xgf') as number) || 0;
            case 'xGA': return (getStat(game, 'xga') as number) || 0;
            case 'xGΔ': return ((getStat(game, 'xgf') as number) || 0) - ((getStat(game, 'xga') as number) || 0);
            case 'T↑': return getTimeStat(game, 'time_leading');
            case 'T↓': return getTimeStat(game, 'time_trailing');
            case 'T=': return getTimeStat(game, 'time_tied');
            case 'Control': return getControlScore(game);
            case 'EN GF': return game.en_gf;
            case 'EN Att': return game.en_att;
            case 'OTML': return game.otml === 'Yes' ? 1 : 0;
            case 'EN GA': return game.en_ga;
            case 'EN Att Ag': return game.en_att_ag;
            case 'NLW': {
                const rc = game.result_code?.toUpperCase() || '';
                return (['RW', 'OTW', 'SOW', 'W'].includes(rc) && (game.time_leading || 0) === 0) ? 1 : 0;
            }
            case 'NTW': {
                const rc = game.result_code?.toUpperCase() || '';
                return (['RW', 'OTW', 'SOW', 'W'].includes(rc) && (game.time_trailing || 0) === 0) ? 1 : 0;
            }
            case 'NTL': {
                const rc = game.result_code?.toUpperCase() || '';
                return (['RL', 'L', 'OTL', 'SOL'].includes(rc) && (game.time_trailing || 0) === 0) ? 1 : 0;
            }
            default: return 0;
        }
    };

    // ── Sorted Games (display order only; totals use original `games`) ───────
    const sortedGames = useMemo(() => {
        if (!sortKey) return games;
        const dir = sortDir === 'asc' ? 1 : -1;
        return [...games].sort((a, b) => {
            const va = getSortValue(a, sortKey);
            const vb = getSortValue(b, sortKey);
            if (typeof va === 'string' && typeof vb === 'string') {
                return dir * va.localeCompare(vb);
            }
            return dir * ((va as number) - (vb as number));
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [games, sortKey, sortDir, filters.period]);

    // ── Totals ──────────────────────────────────────────────────────────────
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

        const gf = sum('gf'); const ga = sum('ga');
        const sf = sum('sf'); const sa = sum('sa');
        const cf = sum('cf'); const ca = sum('ca');
        const hdf = sum('hdf'); const hda = sum('hda');
        const xgf = sum('xgf'); const xga = sum('xga');

        const isAll = filters.period === 'All';
        const pSuffix = filters.period === '1st' ? '_1P' :
            filters.period === '2nd' ? '_2P' :
                filters.period === '3rd' ? '_3P' : '_OT';
        const gsax = games.reduce((acc, g) => {
            const _xga = (getStat(g, 'xga') as number) || 0;
            const _ga = (getStat(g, 'ga') as number) || 0;
            const _en_ga = isAll ? (g.en_ga || 0) : 0;
            return acc + (_xga - (_ga - _en_ga));
        }, 0);

        const en_gf = games.reduce((acc, g) => acc + g.en_gf, 0);
        const en_att = games.reduce((acc, g) => acc + g.en_att, 0);
        const en_ga = games.reduce((acc, g) => acc + g.en_ga, 0);
        const en_att_ag = games.reduce((acc, g) => acc + g.en_att_ag, 0);

        const getTimeVal = (g: GameLog, stat: 'time_leading' | 'time_trailing' | 'time_tied') => {
            if (isAll) return g[stat] || 0;
            const raw = g.raw?.[stat + pSuffix];
            return raw !== undefined ? parseInt(raw as string) || 0 : g[stat] || 0;
        };
        const getCtrl = (g: GameLog) => {
            if (isAll) return g.control_score || 1;
            const raw = g.raw?.['control_score' + pSuffix];
            return raw !== undefined ? parseFloat(raw as string) || 1 : g.control_score || 1;
        };

        const time_leading_avg = games.reduce((acc, g) => acc + getTimeVal(g, 'time_leading'), 0) / count;
        const time_trailing_avg = games.reduce((acc, g) => acc + getTimeVal(g, 'time_trailing'), 0) / count;
        const time_tied_avg = games.reduce((acc, g) => acc + getTimeVal(g, 'time_tied'), 0) / count;
        const control_score_avg = games.reduce((acc, g) => acc + getCtrl(g), 0) / count;

        const nlw = games.filter(g => {
            const res = g.result_code?.toUpperCase() || '';
            return ['RW', 'OTW', 'SOW', 'W'].includes(res) && (g.time_leading || 0) === 0;
        }).length;
        const ntw = games.filter(g => {
            const res = g.result_code?.toUpperCase() || '';
            return ['RW', 'OTW', 'SOW', 'W'].includes(res) && (g.time_trailing || 0) === 0;
        }).length;
        const ntl = games.filter(g => {
            const res = g.result_code?.toUpperCase() || '';
            return ['RL', 'L', 'OTL', 'SOL'].includes(res) && (g.time_trailing || 0) === 0;
        }).length;

        const pp_goals = games.reduce((acc, g) => acc + g.pp_goals, 0);
        const pp_opps = games.reduce((acc, g) => acc + g.pp_opps, 0);
        const pk_goals_ag = games.reduce((acc, g) => acc + g.pp_goals_against, 0);
        const pk_opps = games.reduce((acc, g) => acc + g.pk_opps, 0);

        const total_saves = games.reduce((acc, g) => acc + (getStat(g, 'sa') as number) - (getStat(g, 'ga') as number), 0);
        const adjusted_sa = sa - (filters.period === 'All' ? en_ga : 0);
        const tot_sv_pct = adjusted_sa > 0 ? (total_saves / adjusted_sa) : 0;

        return {
            record,
            gf: (gf / count).toFixed(1), ga: (ga / count).toFixed(1), gd: gf - ga,
            sf: (sf / count).toFixed(1), sa: (sa / count).toFixed(1), sd: (sf - sa),
            cf: (cf / count).toFixed(1), ca: (ca / count).toFixed(1), cd: (cf - ca),
            hdf: (hdf / count).toFixed(1), hda: (hda / count).toFixed(1), hdd: (hdf - hda),
            xgf: (xgf / count).toFixed(2), xga: (xga / count).toFixed(2), xgd: (xgf - xga).toFixed(2),
            gsax: gsax.toFixed(2),
            nlw, ntw, ntl,
            en_gf, en_att, en_ga, en_att_ag,
            time_leading_avg, time_trailing_avg, time_tied_avg, control_score_avg,
            pp_goals, pp_opps, pk_goals_ag, pk_opps,
            pp_pct: pp_opps > 0 ? (pp_goals / pp_opps * 100).toFixed(1) : '0.0',
            pk_pct: pk_opps > 0 ? (100 - (pk_goals_ag / pk_opps * 100)).toFixed(1) : '0.0',
            sh_pct: sf > 0 ? (gf / sf * 100).toFixed(1) : '0.0',
            sv_pct: tot_sv_pct.toFixed(3).replace(/^0+/, '')
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [games, filters.period]);

    // ── Sortable Header Helper ──────────────────────────────────────────────
    const SortTh = ({ colKey, children, className, title }: { colKey: string; children: React.ReactNode; className?: string; title?: string }) => {
        const isActive = sortKey === colKey;
        return (
            <th
                onClick={() => handleSort(colKey)}
                title={title}
                className={`p-1 cursor-pointer select-none hover:text-white transition-colors group ${isActive ? 'text-white' : ''} ${className || ''}`}
            >
                <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
                    {children}
                    <span className={`text-[8px] leading-none ${isActive ? 'text-white' : 'text-gray-700 group-hover:text-gray-500'}`}>
                        {isActive ? (sortDir === 'asc' ? '▲' : '▼') : '▲▼'}
                    </span>
                </span>
            </th>
        );
    };

    // ── Sticky left positions (px) after adding TM column ──────────────────
    // #: left-0 (0), Date: left-8 (32px), TM: left-32 (128px), Loc: left-44 (176px), Opp: left-52 (208px)
    const stickyBg = 'bg-gray-900';
    const stickyBgRow = 'bg-[#09090b]';
    const stickyBgTotals = 'bg-[#1c1c1c]';

    return (
        <div className="overflow-x-auto border border-gray-800 rounded-lg bg-gray-900/50">
            <table className="w-full text-xs text-left whitespace-nowrap border-collapse">
                <thead className="bg-gray-900/80 text-gray-400 font-bold uppercase tracking-wider border-b border-gray-700">
                    <tr>
                        <SortTh colKey="#" className={`sticky left-0 ${stickyBg} z-30 min-w-[2rem] w-8 text-center text-gray-500`}>#</SortTh>
                        <SortTh colKey="Date" className={`sticky left-8 ${stickyBg} z-30 min-w-[6rem] w-24 text-center border-r border-gray-700`}>Date</SortTh>
                        <SortTh colKey="TM" className={`sticky left-32 ${stickyBg} z-30 min-w-[3rem] w-12 text-center border-r border-gray-700`}>TM</SortTh>
                        <SortTh colKey="Loc" className={`sticky left-44 ${stickyBg} z-30 min-w-[2rem] w-8 text-center border-r border-gray-700`}>Loc</SortTh>
                        <SortTh colKey="Opp" className={`sticky left-52 ${stickyBg} z-30 min-w-[3rem] w-12 text-center border-r border-gray-700`}>Opp</SortTh>
                        <SortTh colKey="Starter">Starter</SortTh>
                        <SortTh colKey="Opp Strt">Opp Strt</SortTh>
                        <SortTh colKey="Res" className="text-center">Res</SortTh>
                        <SortTh colKey="GF" className="text-center">GF</SortTh>
                        <SortTh colKey="GA" className="text-center">GA</SortTh>
                        <SortTh colKey="GΔ" className="text-center">GΔ</SortTh>
                        {filters.period === 'All' && (
                            <>
                                <SortTh colKey="PP" className="text-center text-blue-300">Powerplay</SortTh>
                                <SortTh colKey="PK" className="text-center text-red-300">Penalty Kill</SortTh>
                            </>
                        )}
                        <SortTh colKey="SF" className="text-center">SF</SortTh>
                        <SortTh colKey="SA" className="text-center">SA</SortTh>
                        <SortTh colKey="SΔ" className="text-center">SΔ</SortTh>
                        <SortTh colKey="CF" className="text-center">CF</SortTh>
                        <SortTh colKey="CA" className="text-center">CA</SortTh>
                        <SortTh colKey="CΔ" className="text-center">CΔ</SortTh>
                        <SortTh colKey="HDF" className="text-center">HDF</SortTh>
                        <SortTh colKey="HDA" className="text-center">HDA</SortTh>
                        <SortTh colKey="HDΔ" className="text-center">HDΔ</SortTh>
                        <SortTh colKey="SH%" className="text-center border-l border-gray-700">SH%</SortTh>
                        <SortTh colKey="SV%" className="text-center">SV%</SortTh>
                        <SortTh colKey="GSAx" className="text-center">GSAx</SortTh>
                        <SortTh colKey="xGF" className="text-center">xGF</SortTh>
                        <SortTh colKey="xGA" className="text-center">xGA</SortTh>
                        <SortTh colKey="xGΔ" className="text-center">xGΔ</SortTh>
                        <SortTh colKey="T↑" className="text-center border-l border-gray-700">T↑/G</SortTh>
                        <SortTh colKey="T↓" className="text-center">T↓/G</SortTh>
                        <SortTh colKey="T=" className="text-center border-r border-gray-700">T=/G</SortTh>
                        <SortTh colKey="Control" className="text-center border-r border-gray-700">Control</SortTh>
                        <SortTh colKey="EN GF" className="text-center">EN GF</SortTh>
                        <SortTh colKey="EN Att" className="text-center">EN Att</SortTh>
                        <SortTh colKey="OTML" className="text-center">OTML</SortTh>
                        <SortTh colKey="EN GA" className="text-center">EN GA</SortTh>
                        <SortTh colKey="EN Att Ag" className="text-center">EN Att Ag</SortTh>
                        {filters.period === 'All' && (
                            <>
                                <SortTh colKey="NLW" className="text-center border-l border-gray-700 text-purple-300" title="No-Lead Wins: won with 0:00 time leading">NLW</SortTh>
                                <SortTh colKey="NTW" className="text-center text-teal-300" title="No-Trail Wins: won with 0:00 time trailing">NTW</SortTh>
                                <SortTh colKey="NTL" className="text-center text-orange-300" title="No-Trail Losses: lost with 0:00 time trailing">NTL</SortTh>
                            </>
                        )}
                    </tr>
                    {totals && (
                        <tr className="bg-white/10 font-bold border-b border-white/20 text-white">
                            <td className={`p-1 sticky left-0 ${stickyBgTotals} z-30 border-r border-gray-800 text-center min-w-[2rem] w-8`}></td>
                            <td className={`p-1 sticky left-8 ${stickyBgTotals} z-30 border-r border-gray-700 text-center min-w-[6rem] w-24`}>TOTALS</td>
                            <td className={`p-1 sticky left-32 ${stickyBgTotals} z-30 border-r border-gray-800 text-center min-w-[3rem] w-12`}></td>
                            <td className={`p-1 sticky left-44 ${stickyBgTotals} z-30 border-r border-gray-800 text-center min-w-[2rem] w-8`}></td>
                            <td className={`p-1 sticky left-52 ${stickyBgTotals} z-30 border-r border-gray-800 text-center min-w-[3rem] w-12`}></td>
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
                            {filters.period === 'All' && (
                                <>
                                    <td className="p-1 text-center border-l border-gray-700 text-purple-300 font-bold">{totals.nlw}</td>
                                    <td className="p-1 text-center text-teal-300 font-bold">{totals.ntw}</td>
                                    <td className="p-1 text-center text-orange-300 font-bold">{totals.ntl}</td>
                                </>
                            )}
                        </tr>
                    )}
                </thead>
                <tbody className="divide-y divide-gray-800">
                    {games.length === 0 ?
                        <tr><td colSpan={30} className="p-4 text-center text-gray-500">No games played.</td></tr>
                        : sortedGames.map((game, idx) => {
                            const isExpanded = expandedGameId === game.game_id;

                            const gf = getStat(game, 'gf');
                            const ga = getStat(game, 'ga');
                            const sf = getStat(game, 'sf');
                            const sa = getStat(game, 'sa');
                            const cf = getStat(game, 'cf');
                            const ca = getStat(game, 'ca');
                            const hdf = getStat(game, 'hdf');
                            const hda = getStat(game, 'hda');

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

                            const _xgf = (getStat(game, 'xgf') as number) || 0;
                            const _xga = (getStat(game, 'xga') as number) || 0;
                            const xgd = _xgf - _xga;

                            const sh_pct = _sf > 0 ? (_gf / _sf * 100).toFixed(1) : "0.0";
                            const adjusted_sa = _sa > 0 ? _sa - (filters.period === 'All' ? game.en_ga : 0) : 0;
                            const sv_pct_val = adjusted_sa > 0 ? ((_sa - _ga) / adjusted_sa).toFixed(3).replace(/^0+/, '') : ".000";
                            const gsax = (_xga - (_ga - (filters.period === 'All' ? game.en_ga : 0))).toFixed(2);

                            const opponentName = game.opponent.trim();
                            const oppLogoUrl = teamLogos ? (teamLogos[opponentName] || teamLogos[opponentName.split(' ').pop() || ''] || '') : '';

                            // TM column: team logo for this game's team
                            const teamCommonName = (game.raw?.team as string) || '';
                            const tmLogoUrl = teamLogos ? (teamLogos[teamCommonName] || '') : '';

                            return (
                                <React.Fragment key={`${game.game_id}-${teamCommonName}`}>
                                    <tr
                                        onClick={() => setExpandedGameId(isExpanded ? null : game.game_id)}
                                        className={`cursor-pointer transition-colors hover:bg-white/5 ${idx % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.02]'} ${isExpanded ? 'bg-white/10' : ''}`}
                                    >
                                        {/* Sticky: # */}
                                        <td className={`p-1 sticky left-0 ${stickyBgRow} border-r border-gray-800 z-20 text-center font-mono text-gray-500 text-[10px] min-w-[2rem] w-8`}>{game.game_number}</td>
                                        {/* Sticky: Date */}
                                        <td className={`p-1 sticky left-8 ${stickyBgRow} border-r border-gray-700 z-20 font-mono text-gray-300 min-w-[6rem] w-24 text-center text-[11px]`}>{game.date}</td>
                                        {/* Sticky: TM */}
                                        <td className={`px-1 py-0 sticky left-32 ${stickyBgRow} border-r border-gray-700 z-20 justify-center min-w-[3rem] w-12 text-center`}>
                                            <div className="w-6 h-6 relative mx-auto" title={teamCommonName}>
                                                {tmLogoUrl
                                                    ? <img src={tmLogoUrl} alt={teamCommonName} className="w-6 h-6 object-contain" />
                                                    : <span className="text-[9px] text-gray-500">{teamCommonName.substring(0, 3)}</span>
                                                }
                                            </div>
                                        </td>
                                        {/* Sticky: Loc */}
                                        <td className={`p-1 sticky left-44 ${stickyBgRow} border-r border-gray-700 z-20 text-center font-bold text-[10px] min-w-[2rem] w-8 ${game.home_away === 'Home' ? 'text-gray-500' : 'text-blue-400'}`}>
                                            {game.home_away === 'Home' ? 'vs' : '@'}
                                        </td>
                                        {/* Sticky: Opp */}
                                        <td className={`px-1 py-0 sticky left-52 ${stickyBgRow} border-r border-gray-700 z-20 justify-center min-w-[3rem] w-12 text-center`}>
                                            <div className="w-6 h-6 relative mx-auto" title={game.opponent}>
                                                {oppLogoUrl ? <img src={oppLogoUrl} alt={game.opponent} className="w-6 h-6 object-contain" /> : <span className='text-[9px]'>{game.opponent.substring(0, 3)}</span>}
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
                                        {filters.period === 'All' && (() => {
                                            const res = game.result_code?.toUpperCase() || '';
                                            const isWin = ['RW', 'OTW', 'SOW', 'W'].includes(res);
                                            const isLoss = ['RL', 'L', 'OTL', 'SOL'].includes(res);
                                            const isNLW = isWin && (game.time_leading || 0) === 0;
                                            const isNTW = isWin && (game.time_trailing || 0) === 0;
                                            const isNTL = isLoss && (game.time_trailing || 0) === 0;
                                            return (
                                                <>
                                                    <td className="p-1 text-center border-l border-gray-700">
                                                        {isNLW ? <span className="px-1 py-0.5 rounded text-[10px] font-black bg-purple-900/40 text-purple-300 border border-purple-500/30">NLW</span> : <span className="text-gray-700">—</span>}
                                                    </td>
                                                    <td className="p-1 text-center">
                                                        {isNTW ? <span className="px-1 py-0.5 rounded text-[10px] font-black bg-teal-900/40 text-teal-300 border border-teal-500/30">NTW</span> : <span className="text-gray-700">—</span>}
                                                    </td>
                                                    <td className="p-1 text-center">
                                                        {isNTL ? <span className="px-1 py-0.5 rounded text-[10px] font-black bg-orange-900/40 text-orange-300 border border-orange-500/30">NTL</span> : <span className="text-gray-700">—</span>}
                                                    </td>
                                                </>
                                            );
                                        })()}
                                    </tr>
                                    {isExpanded && !isAllTeams && (
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
