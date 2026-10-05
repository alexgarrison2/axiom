'use client';

import * as React from 'react';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/utils';
import { periodLabel, powerPlays, teamTotals, type TeamStrength, type TeamTotals } from '@/lib/game/analytics';
import { SIDES, type Side } from '@/lib/game/types';
import { GameSection, useGame } from './GameContext';

interface RowDef {
    key: keyof TeamTotals | 'pp' | 'fo';
    label: string;
    xg?: boolean;
    adjustable?: boolean;
}

const ROWS: RowDef[] = [
    { key: 'goals', label: 'Goals' },
    { key: 'xg', label: 'xG', xg: true, adjustable: true },
    { key: 'sog', label: 'Shots', adjustable: true },
    { key: 'unblocked', label: 'Unblocked', adjustable: true },
    { key: 'attempts', label: 'Attempts', adjustable: true },
    { key: 'hd', label: 'High danger' },
    { key: 'pp', label: 'Power play' },
    { key: 'fo', label: 'Faceoffs' },
    { key: 'hits', label: 'Hits' },
    { key: 'blocks', label: 'Blocks' },
    { key: 'takeaways', label: 'Takeaways' },
    { key: 'giveaways', label: 'Giveaways' },
    { key: 'pim', label: 'PIM' },
];

/** One side of a mirrored row: the bar grows away from the centre label, the number sits against it. */
function Cell({ side, text, share, lit, model, color }: { side: Side; text: string; share: number; lit: boolean; model?: boolean; color: string }) {
    const away = side === 'away';
    return (
        <span className={cn('flex min-w-0 items-center gap-2', !away && 'flex-row-reverse')}>
            <span className="relative h-5 min-w-0 flex-1 overflow-hidden rounded-[3px] bg-track">
                <span className={cn('absolute inset-y-0', away ? 'right-0' : 'left-0')} style={{ width: `${share * 100}%`, background: color, opacity: lit ? 0.9 : 0.35 }} />
            </span>
            <span className={cn('w-14 shrink-0', away ? 'text-right' : 'text-left', model ? 'text-model' : lit ? 'font-bold text-fg-1' : 'text-fg-2', lit && 'font-bold')}>{text}</span>
        </span>
    );
}

export function TeamStats() {
    const { m, colors } = useGame();
    const [strength, setStrength] = React.useState<TeamStrength>('all');
    const [period, setPeriod] = React.useState<string>('all');
    const [adjusted, setAdjusted] = React.useState<'raw' | 'adj'>('raw');
    const [metric, setMetric] = React.useState<'totals' | 'shares'>('totals');
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
            const off = strength === 'all' && period === 'all' ? m.official?.pp[side] : null;
            if (off) return { n: Number(off.split('/')[0]) || 0, text: off };
            return { n: pp[side].g, text: `${pp[side].g} PPG` };
        }
        if (r.key === 'fo') {
            const tot = t.away.faceoffs + t.home.faceoffs;
            const n = t[side].faceoffs;
            return { n, text: metric === 'shares' && tot ? `${Math.round((n / tot) * 100)}%` : String(n) };
        }
        const n = t[side][r.key as keyof TeamTotals];
        const tot = t.away[r.key as keyof TeamTotals] + t.home[r.key as keyof TeamTotals];
        if (metric === 'shares') return { n, text: tot ? `${((n / tot) * 100).toFixed(1)}%` : '—' };
        const adj = adjusted === 'adj' && r.adjustable;
        return { n, text: r.xg || adj ? n.toFixed(r.xg ? 2 : 1) : String(Math.round(n)) };
    };

    return (
        <GameSection id="team" title="Team stats">
            <div className="panel overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 border-b border-line px-card py-2">
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
                            { value: 'shares', label: 'Shares' },
                        ]}
                    />
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_7.5rem_minmax(0,1fr)] items-center gap-y-1.5 px-card py-3 text-caption tabular-nums md:grid-cols-[minmax(0,1fr)_9rem_minmax(0,1fr)]">
                    <span className="pb-1 text-micro font-bold uppercase tracking-label" style={{ color: colors.away }}>
                        {m.teams.away.tri}
                    </span>
                    <span />
                    <span className="pb-1 text-right text-micro font-bold uppercase tracking-label" style={{ color: colors.home }}>
                        {m.teams.home.tri}
                    </span>
                    {ROWS.map(r => {
                        const a = value('away', r);
                        const h = value('home', r);
                        const tot = a.n + h.n;
                        const lead: Side | null = a.n === h.n ? null : a.n > h.n ? 'away' : 'home';
                        return (
                            <React.Fragment key={r.key}>
                                <Cell side="away" text={a.text} share={tot ? a.n / tot : 0} lit={lead === 'away'} model={r.xg} color={colors.away} />
                                <span className="text-center text-micro font-bold uppercase tracking-wide text-fg-2">{r.label}</span>
                                <Cell side="home" text={h.text} share={tot ? h.n / tot : 0} lit={lead === 'home'} model={r.xg} color={colors.home} />
                            </React.Fragment>
                        );
                    })}
                </div>
            </div>
        </GameSection>
    );
}
