'use client';

import * as React from 'react';
import { Dialog } from '@/components/ui/dialog';
import { FilterChip } from '@/components/ui/filter-chip';
import { FilterSheet } from '@/components/ui/filter-sheet';
import { InfoTip } from '@/components/ui/info-tip';
import { KpiTile } from '@/components/ui/kpi-tile';
import { ScrollRegion } from '@/components/ui/scroll-region';
import { Segmented } from '@/components/ui/segmented';
import { SortHeader, type SortDirection } from '@/components/ui/sort-header';
import { StatChip } from '@/components/ui/stat-chip';
import { WinBar, marketBandFromOdds } from '@/components/ui/win-bar';
import { TEAM_CODES, TEAM_PALETTE, teamTextColor } from '@/components/ui/team-color';

function Block({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
    return (
        <section id={id} aria-labelledby={`${id}-h`} className="hud-panel min-w-0 p-5">
            <h2 id={`${id}-h`} className="hud-label mb-4">
                {title}
            </h2>
            {children}
        </section>
    );
}

const ROWS = [
    { team: 'CAR', gp: 1, pts: 2, xgf: 58.2 },
    { team: 'EDM', gp: 1, pts: 2, xgf: 54.1 },
    { team: 'FLA', gp: 1, pts: 0, xgf: 41.8 },
    { team: 'VAN', gp: 1, pts: 0, xgf: 45.9 },
];

export default function Kit() {
    const [view, setView] = React.useState<'division' | 'wildcard' | 'league'>('division');
    const [chips, setChips] = React.useState({ home: true, away: false, l10: false });
    const [sort, setSort] = React.useState<{ key: 'pts' | 'xgf'; dir: SortDirection }>({ key: 'pts', dir: 'desc' });
    const active = Object.values(chips).filter(Boolean).length;
    const rows = [...ROWS].sort((a, b) => (sort.dir === 'asc' ? a[sort.key] - b[sort.key] : b[sort.key] - a[sort.key]));
    const toggleSort = (key: 'pts' | 'xgf') => setSort(s => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));

    return (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Block id="kit-winbar" title="WinBar">
                <div className="space-y-6">
                    <WinBar away="FLA" home="CAR" pAway={0.369} marketBand={marketBandFromOdds(-120, -110)} />
                    <WinBar away="VAN" home="EDM" pAway={0.281} size="lg" />
                    <WinBar away="CHI" home="VGK" pAway={0.08} size="sm" />
                </div>
            </Block>

            <Block id="kit-chips" title="StatChip">
                <div className="flex flex-wrap gap-2">
                    <StatChip label="L10" value="7-2-1" tone="pos" />
                    <StatChip label="PP" value="#4" rankBar={{ rank: 4, of: 32 }} />
                    <StatChip label="L10" value="1-0-0" state="small" n={1} />
                    <StatChip label="PP" value="#4" state="prior" seasonTag="2025-26" />
                    <StatChip label="H2H" value="2-1" state="prior" />
                    <StatChip label="GSAx" value="−0.21" tone="neg" />
                </div>
                <p className="mt-4 flex items-center gap-1 text-body-sm text-fg-2">
                    Model % <InfoTip term="model-pct" /> · Market % <InfoTip term="market-pct" /> · <InfoTip term="fair-odds" showLabel />
                </p>
            </Block>

            <Block id="kit-controls" title="Segmented · FilterChip · FilterSheet">
                <Segmented
                    label="Standings view"
                    value={view}
                    onChange={setView}
                    options={[
                        { value: 'division', label: 'Division' },
                        { value: 'wildcard', label: 'Wild card' },
                        { value: 'league', label: 'League' },
                    ]}
                />
                <div className="mt-4 flex flex-wrap items-center gap-2">
                    <FilterChip selected={chips.home} onSelectedChange={v => setChips(c => ({ ...c, home: v }))}>
                        Home
                    </FilterChip>
                    <FilterChip selected={chips.away} onSelectedChange={v => setChips(c => ({ ...c, away: v }))}>
                        Away
                    </FilterChip>
                    <FilterChip selected={chips.l10} count={10} onSelectedChange={v => setChips(c => ({ ...c, l10: v }))}>
                        Last 10
                    </FilterChip>
                    <FilterSheet activeCount={active} onReset={() => setChips({ home: false, away: false, l10: false })} applyLabel="Show games">
                        <fieldset>
                            <legend className="hud-label mb-2">Location</legend>
                            <div className="flex flex-wrap gap-2">
                                <FilterChip selected={chips.home} onSelectedChange={v => setChips(c => ({ ...c, home: v }))}>
                                    Home
                                </FilterChip>
                                <FilterChip selected={chips.away} onSelectedChange={v => setChips(c => ({ ...c, away: v }))}>
                                    Away
                                </FilterChip>
                            </div>
                        </fieldset>
                    </FilterSheet>
                </div>
            </Block>

            <Block id="kit-kpi" title="KpiTile">
                <div className="grid gap-3 sm:grid-cols-2">
                    <KpiTile
                        label="Log loss"
                        value="0.6823"
                        delta={{ value: 0.0081, baseline: 'market', better: 'lower', format: v => `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(4)}` }}
                        sub="n = 410 live games"
                        info={<InfoTip term="log-loss" />}
                        spark={[0.69, 0.688, 0.684, 0.686, 0.683, 0.682]}
                    />
                    <KpiTile label="Record" value="0-0" sub="No 2026-27 games graded yet" empty />
                </div>
            </Block>

            <Block id="kit-table" title="SortHeader · ScrollRegion">
                <ScrollRegion label="Sample standings">
                    <table className="w-full min-w-[480px] text-body-sm">
                        <thead>
                            <tr className="border-b border-line">
                                <th scope="col" className="px-2 py-1 text-left text-micro uppercase text-fg-2">
                                    Team
                                </th>
                                <th scope="col" className="px-2 py-1 text-right text-micro uppercase text-fg-2">
                                    GP
                                </th>
                                <SortHeader align="right" direction={sort.key === 'pts' ? sort.dir : null} onSort={() => toggleSort('pts')}>
                                    PTS
                                </SortHeader>
                                <SortHeader align="right" direction={sort.key === 'xgf' ? sort.dir : null} onSort={() => toggleSort('xgf')}>
                                    xGF%
                                </SortHeader>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(r => (
                                <tr key={r.team} className="border-b border-line/50">
                                    <th scope="row" className="px-2 py-2 text-left font-semibold text-fg-1">
                                        {r.team}
                                    </th>
                                    <td className="px-2 py-2 text-right text-fg-2">{r.gp}</td>
                                    <td className="px-2 py-2 text-right text-fg-1">{r.pts}</td>
                                    <td className="px-2 py-2 text-right text-fg-1">{r.xgf.toFixed(1)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </ScrollRegion>
            </Block>

            <Block id="kit-dialog" title="Dialog">
                <Dialog
                    title="Odds movement"
                    description="How the moneyline moved since it opened."
                    trigger={
                        <button type="button" className="inline-flex min-h-10 items-center rounded-control border border-line-strong px-4 text-body-sm font-semibold text-fg-1 hover:bg-surface-2">
                            Open dialog
                        </button>
                    }
                >
                    <p className="text-body text-fg-2">Dialog content. Tab stays inside; Esc closes and returns focus to the trigger.</p>
                </Dialog>
            </Block>

            <Block id="kit-teams" title="Team colours (clash-safe palette)">
                <ul className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
                    {TEAM_CODES.map(tri => (
                        <li
                            key={tri}
                            className="flex h-9 items-center justify-center rounded-chip text-caption font-bold"
                            style={{ backgroundColor: TEAM_PALETTE[tri].primary, color: teamTextColor(tri) }}
                        >
                            {tri}
                        </li>
                    ))}
                </ul>
            </Block>
        </div>
    );
}
