'use client';

import * as React from 'react';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/utils';
import { periodLabel, powerPlays, teamTotals, type TeamStrength, type TeamTotals } from '@/lib/game/analytics';
import { SIDES, type Side } from '@/lib/game/types';
import { leagueRanks, type LeagueRates, type RankKey } from '@/lib/game/league-ranks';
import { ControlRow } from './ControlRow';
import { GameSection, useGame } from './GameContext';
import { fmtInt, fmtNum } from '@/components/views/format';

interface RowDef {
    key: keyof TeamTotals | 'pp' | 'fo';
    /** The league-rank stat behind this row. */
    rank: RankKey;
    label: string;
    xg?: boolean;
    adjustable?: boolean;
    /** Decimals per game. */
    pg: number;
}

const ROWS: RowDef[] = [
    { key: 'goals', rank: 'goals', label: 'Goals', pg: 2 },
    { key: 'xg', rank: 'xg', label: 'xG', xg: true, adjustable: true, pg: 2 },
    { key: 'sog', rank: 'sog', label: 'Shots', adjustable: true, pg: 1 },
    { key: 'unblocked', rank: 'unblocked', label: 'Unblocked', adjustable: true, pg: 1 },
    { key: 'attempts', rank: 'attempts', label: 'Attempts', adjustable: true, pg: 1 },
    { key: 'hd', rank: 'hd', label: 'High danger', pg: 1 },
    { key: 'pp', rank: 'pp', label: 'Power play', pg: 2 },
    { key: 'fo', rank: 'fo', label: 'Faceoffs', pg: 1 },
    { key: 'hits', rank: 'hits', label: 'Hits', pg: 1 },
    { key: 'blocks', rank: 'blocks', label: 'Blocks', pg: 1 },
    { key: 'takeaways', rank: 'takeaways', label: 'Takeaways', pg: 1 },
    { key: 'giveaways', rank: 'giveaways', label: 'Giveaways', pg: 1 },
    { key: 'pim', rank: 'pim', label: 'PIM', pg: 1 },
];

/** A league rank beside the number: top ten in ink, the rest dim (one hue, no traffic light). */
function Rank({ n, title }: { n: number | null; title: string }) {
    if (n == null) return <span aria-hidden="true" />;
    return (
        <span title={title} className={cn('text-micro tabular-nums', n <= 10 ? 'font-semibold text-fg-1' : 'text-fg-3')}>
            <span className="sr-only">{title} </span>#{n}
        </span>
    );
}

/** One side of a mirrored row: the bar grows away from the centre label, the number sits against it. */
function Cell({ side, text, share, lit, model, color, rank }: { side: Side; text: string; share: number; lit: boolean; model?: boolean; color: string; rank?: React.ReactNode }) {
    const away = side === 'away';
    return (
        <span className={cn('flex min-w-0 items-center gap-2', !away && 'flex-row-reverse')}>
            <span className="relative h-5 min-w-0 flex-1 overflow-hidden rounded-[3px] bg-track">
                <span className={cn('absolute inset-y-0', away ? 'right-0' : 'left-0')} style={{ width: `${share * 100}%`, background: color, opacity: lit ? 0.9 : 0.35 }} />
            </span>
            <span className={cn('flex w-14 shrink-0 flex-col', away ? 'text-right' : 'text-left', model ? 'text-model' : lit ? 'font-bold text-fg-1' : 'text-fg-2', lit && 'font-bold')}>
                {text}
                {/* Phones: the rank tucks under the number rather than taking a column from the bar. */}
                {rank !== undefined ? <span className="font-normal leading-none sm:hidden">{rank}</span> : null}
            </span>
            {rank !== undefined ? <span className={cn('w-8 shrink-0 max-sm:hidden', away ? 'text-right' : 'text-left')}>{rank}</span> : null}
        </span>
    );
}

/**
 * Mirrored team bars. On a team's Breakdown (a merged season, `league` given) it adds a per-game view and
 * league ranks: the team's side ranks its offence, the opponents' side its defence (what it allows), each over
 * the picked games against the other clubs' season rates. Ranks need the plain view (all strengths, all
 * periods, raw), the only one the league table is built for.
 */
export function TeamStats({ league }: { league?: LeagueRates | null }) {
    const { m, colors } = useGame();
    const season = !!m.games?.length;
    const gp = m.games?.length ?? 1;
    const [strength, setStrength] = React.useState<TeamStrength>('all');
    const [period, setPeriod] = React.useState<string>('all');
    const [adjusted, setAdjusted] = React.useState<'raw' | 'adj'>('raw');
    const [metric, setMetric] = React.useState<'totals' | 'pergame' | 'shares'>(season ? 'pergame' : 'totals');
    const ranks = React.useMemo(
        () => (league && season && strength === 'all' && period === 'all' && adjusted === 'raw' ? leagueRanks(league, m.teams.away.tri, m.games!.map(g => g.id)) : null),
        [league, season, strength, period, adjusted, m],
    );
    const per = period === 'all' ? 'all' : Number(period);
    const t = React.useMemo(() => teamTotals(m.events, strength, per, adjusted === 'adj'), [m, strength, per, adjusted]);
    const periods = [...new Set(m.events.map(e => (e.period >= 4 ? 4 : e.period)))].sort();

    // Power play: goals on the man advantage over opportunities (windows of 10s or more).
    const pp = React.useMemo(() => {
        const wins = powerPlays(m).filter(([a, b]) => b - a >= 10);
        const out = {} as Record<Side, { g: number; n: number }>;
        for (const s of SIDES) {
            const mine = wins.filter(w => w[2] === s);
            out[s] = { n: mine.length, g: m.events.filter(e => e.type === 'goal' && e.side === s && e.strength === 'pp').length };
        }
        return out;
    }, [m]);

    const value = (side: Side, r: RowDef): { n: number; text: string } => {
        if (r.key === 'pp') {
            if (metric === 'pergame') return { n: pp[side].g, text: fmtNum(pp[side].g / gp, r.pg) };
            const off = strength === 'all' && period === 'all' ? m.official?.pp[side] : null;
            if (off) return { n: Number(off.split('/')[0]) || 0, text: off };
            return { n: pp[side].g, text: `${pp[side].g} PPG` };
        }
        if (r.key === 'fo') {
            const tot = t.away.faceoffs + t.home.faceoffs;
            const n = t[side].faceoffs;
            if (metric === 'pergame') return { n, text: fmtNum(n / gp, r.pg) };
            return { n, text: metric === 'shares' && tot ? `${Math.round((n / tot) * 100)}%` : fmtInt(n) };
        }
        const n = t[side][r.key as keyof TeamTotals];
        const tot = t.away[r.key as keyof TeamTotals] + t.home[r.key as keyof TeamTotals];
        if (metric === 'shares') return { n, text: tot ? `${((n / tot) * 100).toFixed(1)}%` : '—' };
        if (metric === 'pergame') return { n, text: fmtNum(n / gp, r.pg) };
        const adj = adjusted === 'adj' && r.adjustable;
        return { n, text: r.xg || adj ? fmtNum(n, r.xg ? 2 : 1) : fmtInt(n) };
    };

    return (
        <GameSection id="team" title="Team stats">
            <div className="panel overflow-hidden">
                <ControlRow label="Team stats controls">
                    <Segmented
                        label="Strength"
                        size="sm"
                        value={strength}
                        onChange={setStrength}
                        optionClassName="px-2"
                        options={[
                            { value: 'all', label: 'All' },
                            { value: '5v5', label: '5v5' },
                            { value: 'ev', label: 'EV' },
                            { value: 'awayPP', label: `${m.teams.away.tri} PP` },
                            { value: 'homePP', label: `${m.teams.home.tri} PP` },
                        ]}
                    />
                    <Segmented
                        label="Period"
                        size="sm"
                        value={period}
                        onChange={setPeriod}
                        optionClassName="px-2"
                        options={[{ value: 'all', label: 'All' }, ...periods.map(p => ({ value: String(p), label: periodLabel(p) }))]}
                    />
                    <Segmented
                        label="Score adjustment"
                        size="sm"
                        value={adjusted}
                        onChange={setAdjusted}
                        optionClassName="px-2"
                        options={[
                            { value: 'raw', label: 'Raw' },
                            { value: 'adj', label: 'Score-adj' },
                        ]}
                    />
                    <Segmented
                        label="Metric"
                        size="sm"
                        value={metric}
                        onChange={setMetric}
                        optionClassName="px-2"
                        options={[
                            { value: 'totals', label: 'Totals' },
                            ...(season ? [{ value: 'pergame' as const, label: 'Per GP' }] : []),
                            { value: 'shares', label: 'Shares' },
                        ]}
                    />
                </ControlRow>
                <div className="grid grid-cols-[minmax(0,1fr)_6.5rem_minmax(0,1fr)] items-center gap-y-1.5 px-card py-3 text-caption tabular-nums md:grid-cols-[minmax(0,1fr)_9rem_minmax(0,1fr)]">
                    <span className="flex items-baseline justify-between gap-2 pb-1 text-micro font-bold uppercase tracking-label">
                        <span style={{ color: colors.away }}>{m.teams.away.tri}</span>
                        {ranks ? <span className="text-right font-medium text-fg-3 sm:w-8">Off</span> : null}
                    </span>
                    <span />
                    <span className="flex flex-row-reverse items-baseline justify-between gap-2 pb-1 text-right text-micro font-bold uppercase tracking-label">
                        <span style={{ color: colors.home }}>{m.teams.home.tri}</span>
                        {ranks ? <span className="text-left font-medium text-fg-3 sm:w-8">Def</span> : null}
                    </span>
                    {ROWS.map(r => {
                        const a = value('away', r);
                        const h = value('home', r);
                        const tot = a.n + h.n;
                        const lead: Side | null = a.n === h.n ? null : a.n > h.n ? 'away' : 'home';
                        return (
                            <React.Fragment key={r.key}>
                                <Cell
                                    side="away"
                                    text={a.text}
                                    share={tot ? a.n / tot : 0}
                                    lit={lead === 'away'}
                                    model={r.xg}
                                    color={colors.away}
                                    rank={ranks ? <Rank n={ranks.for[r.rank]} title={`${r.label}: league rank for`} /> : undefined}
                                />
                                <span className="text-center text-micro font-bold uppercase tracking-wide text-fg-2">{r.label}</span>
                                <Cell
                                    side="home"
                                    text={h.text}
                                    share={tot ? h.n / tot : 0}
                                    lit={lead === 'home'}
                                    model={r.xg}
                                    color={colors.home}
                                    rank={ranks ? <Rank n={ranks.ag[r.rank]} title={`${r.label}: league rank allowed`} /> : undefined}
                                />
                            </React.Fragment>
                        );
                    })}
                </div>
            </div>
        </GameSection>
    );
}
