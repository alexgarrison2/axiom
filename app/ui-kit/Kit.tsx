'use client';

import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Crest, TeamTag } from '@/components/ui/crest';
import { Dialog } from '@/components/ui/dialog';
import { FilterChip } from '@/components/ui/filter-chip';
import { FilterSheet } from '@/components/ui/filter-sheet';
import { FreshnessBadge } from '@/components/ui/freshness-badge';
import { InfoTip } from '@/components/ui/info-tip';
import { KpiTile } from '@/components/ui/kpi-tile';
import { ScrollRegion } from '@/components/ui/scroll-region';
import { Segmented } from '@/components/ui/segmented';
import { SortHeader, type SortDirection } from '@/components/ui/sort-header';
import { SeasonTag, StatChip } from '@/components/ui/stat-chip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { WinBar, WinBarLegend, marketProbFromOdds } from '@/components/ui/win-bar';
import { TEAM_CODES, TEAM_PALETTE, clashSafePair, teamTextColor } from '@/components/ui/team-color';

function Block({ id, title, children, wide }: { id: string; title: string; children: React.ReactNode; wide?: boolean }) {
    return (
        <section id={id} aria-labelledby={`${id}-h`} className={`panel min-w-0 p-card ${wide ? 'lg:col-span-2' : ''}`}>
            <h2 id={`${id}-h`} className="label mb-4">
                {title}
            </h2>
            {children}
        </section>
    );
}

/** A props table: name · type · note (2-4 words). */
function Api({ rows }: { rows: [string, string, string][] }) {
    return (
        <ScrollRegion label="Props" className="mt-5">
            <table className="table-dense min-w-[520px]">
                <thead>
                    <tr>
                        <th scope="col" className="text-left">
                            Prop
                        </th>
                        <th scope="col" className="text-left">
                            Type
                        </th>
                        <th scope="col" className="text-left">
                            Does
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map(([p, t, d]) => (
                        <tr key={p}>
                            <th scope="row" className="text-left font-bold text-brand">
                                {p}
                            </th>
                            <td className="text-fg-2">{t}</td>
                            <td className="text-fg-3">{d}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </ScrollRegion>
    );
}

const PALETTE: [string, string, string][] = [
    ['bg', '#05070b', 'bg-bg'],
    ['panel', '#0b1019→#070a10', 'panel'],
    ['line', '#152031', 'bg-line'],
    ['ink', '#e8eef8', 'bg-ink'],
    ['dim', '#6f7b91', 'bg-dim'],
    ['mute', '#3b475c', 'bg-mute'],
    ['cyan', '#29e7ff', 'bg-cyan'],
    ['green', '#3dff8f', 'bg-green'],
    ['magenta', '#ff4fd8', 'bg-magenta'],
    ['amber', '#ffc53d', 'bg-amber'],
    ['red', '#ff5470', 'bg-red'],
];

const ROWS = [
    { team: 'CAR', gp: 1, pts: 2, xgf: 58.2 },
    { team: 'EDM', gp: 1, pts: 2, xgf: 54.1 },
    { team: 'FLA', gp: 1, pts: 0, xgf: 41.8 },
    { team: 'VAN', gp: 1, pts: 0, xgf: 45.9 },
];

const STAMP = new Date(Date.now() - 4 * 60_000).toISOString();

export default function Kit() {
    const [day, setDay] = React.useState<'yesterday' | 'tonight' | 'thu'>('tonight');
    const [view, setView] = React.useState<'division' | 'wildcard' | 'league'>('division');
    const [chips, setChips] = React.useState({ home: true, away: false });
    const [sort, setSort] = React.useState<{ key: 'pts' | 'xgf'; dir: SortDirection }>({ key: 'pts', dir: 'desc' });
    const active = Object.values(chips).filter(Boolean).length;
    const rows = [...ROWS].sort((a, b) => (sort.dir === 'asc' ? a[sort.key] - b[sort.key] : b[sort.key] - a[sort.key]));
    const toggleSort = (key: 'pts' | 'xgf') => setSort(s => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }));
    const nyiTor = clashSafePair('NYI', 'TOR');

    return (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Block id="kit-tokens" title="Tokens" wide>
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                    {PALETTE.map(([name, hex, cls]) => (
                        <li key={name} className="tile flex items-center gap-2.5 !p-2">
                            <span aria-hidden="true" className={`h-7 w-7 shrink-0 rounded-chip border border-line ${cls}`} />
                            <span className="min-w-0">
                                <span className="block text-micro font-bold uppercase tracking-wide text-fg-1">{name}</span>
                                <span className="block truncate text-micro text-fg-3">{hex}</span>
                            </span>
                        </li>
                    ))}
                </ul>
                <div className="mt-5 grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                        <p className="label">Chakra Petch · display</p>
                        <p className="font-display text-display font-bold uppercase">Wed · Sep 30</p>
                        <p className="font-display text-[18px] font-bold tracking-[0.02em] text-pos">Sorokin</p>
                        <p className="num-pct text-[26px]">
                            61<sup className="ml-px align-[0.6em] text-[0.5em]">%</sup>
                        </p>
                    </div>
                    <div className="space-y-2">
                        <p className="label">JetBrains Mono · everything else</p>
                        <p className="text-caption font-bold tracking-[0.24em]">7:00 PM</p>
                        <p className="text-[15px] font-bold text-fg-3">+117 · −138</p>
                        <p className="num-score text-[40px] leading-none">
                            6 <span className="text-[28px] text-fg-3">–</span> <span className="text-fg-3">5</span>
                        </p>
                        <p className="text-micro text-fg-3">24-10-3 · .915 · 2.41</p>
                    </div>
                </div>
            </Block>

            <Block id="kit-winbar" title="WinBar" wide>
                <div className="flex justify-end">
                    <WinBarLegend />
                </div>
                <div className="mt-4 grid gap-x-6 gap-y-7 md:grid-cols-2">
                    <div>
                        <p className="label mb-2">lg · market + model</p>
                        <WinBar away="NYI" home="TOR" pAway={0.48} market={marketProbFromOdds(112, -133)} model={0.61} />
                    </div>
                    <div>
                        <p className="label mb-2">lg · favourite glows</p>
                        <WinBar away="PIT" home="PHI" pAway={0.45} market={0.44} model={0.47} />
                    </div>
                    <div>
                        <p className="label mb-2">lg · dimmed (final)</p>
                        <WinBar away="VAN" home="EDM" pAway={0.27} market={0.25} model={0.29} dimmed />
                    </div>
                    <div>
                        <p className="label mb-2">md · codes</p>
                        <WinBar away="LAK" home="COL" pAway={0.36} size="md" showCodes />
                    </div>
                    <div>
                        <p className="label mb-2">sm</p>
                        <WinBar away="BOS" home="NSH" pAway={0.58} size="sm" market={0.55} />
                    </div>
                    <div>
                        <p className="label mb-2">sliver</p>
                        <WinBar away="CHI" home="VGK" pAway={0.08} size="md" />
                    </div>
                </div>
                <Api
                    rows={[
                        ['away / home', 'string', 'Tricodes'],
                        ['pAway', 'number 0–1', 'Fill split (forecast)'],
                        ['market', 'number | null', 'White tick, vig-free'],
                        ['model', 'number | null', 'Magenta diamond, raw model'],
                        ['size', "'sm' | 'md' | 'lg'", '28 / 40 / 50px (lg default)'],
                        ['dimmed', 'boolean', 'Finals'],
                        ['animate', 'boolean', 'Grow-in once (default on)'],
                        ['showCodes', 'boolean', 'Tricode beside %'],
                        ['awayColor / homeColor', 'hex', 'ΔE-checked overrides'],
                        ['label', 'string', 'Screen-reader name'],
                        ['<WinBarLegend />', '—', 'Once per page'],
                        ['marketProbFromOdds()', '(away, home) → p', 'De-vigged market p'],
                    ]}
                />
            </Block>

            <Block id="kit-chips" title="Chips">
                <div role="group" aria-label="Slate day" className="flex flex-wrap gap-2.5">
                    <FilterChip selected={day === 'yesterday'} count={5} onSelectedChange={() => setDay('yesterday')}>
                        Yesterday
                    </FilterChip>
                    <FilterChip selected={day === 'tonight'} count={3} onSelectedChange={() => setDay('tonight')}>
                        Tonight
                    </FilterChip>
                    <FilterChip selected={day === 'thu'} count={8} onSelectedChange={() => setDay('thu')}>
                        Thu
                    </FilterChip>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                    <StatChip label="L10" value="7-2-1" tone="pos" />
                    <StatChip label="PP" value="#4" rankBar={{ rank: 4, of: 32 }} />
                    <StatChip label="L10" value="1-0-0" state="small" n={1} />
                    <StatChip label="PP" value="#4" state="prior" seasonTag="2025-26" />
                    <StatChip label="H2H" value="2-1" state="prior" />
                    <StatChip label="GSAx" value="−0.21" tone="neg" />
                    <SeasonTag />
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Badge>TNT</Badge>
                    <Badge variant="warn">B2B</Badge>
                    <Badge variant="brand">Live</Badge>
                    <Badge variant="pos">✓ Pick</Badge>
                    <Badge variant="destructive">✕ Pick</Badge>
                    <Badge variant="model">◆ 61 NYI</Badge>
                </div>
                <p className="mt-4 flex items-center gap-1 text-caption text-fg-3">
                    Model % <InfoTip term="model-pct" /> · Market % <InfoTip term="market-pct" /> · <InfoTip term="fair-odds" showLabel />
                </p>
            </Block>

            <Block id="kit-controls" title="Segmented · Tabs · Buttons">
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
                <Tabs defaultValue="goalies" className="mt-4">
                    <TabsList aria-label="Matchup detail">
                        <TabsTrigger value="goalies">Goalies</TabsTrigger>
                        <TabsTrigger value="lines">Lines</TabsTrigger>
                        <TabsTrigger value="odds">Odds</TabsTrigger>
                        <TabsTrigger value="why">Why</TabsTrigger>
                    </TabsList>
                    <TabsContent value="goalies" className="grid grid-cols-3 gap-2.5">
                        <KpiTile label="Sorokin" value="+0.21" sub="GSAx/gm" />
                        <KpiTile label="Stolarz" value="+0.09" sub="GSAx/gm" />
                        <KpiTile label="Rest" value="2d · 0d" sub="NYI · TOR" />
                    </TabsContent>
                    <TabsContent value="lines" className="text-caption text-fg-3">
                        —
                    </TabsContent>
                    <TabsContent value="odds" className="text-caption text-fg-3">
                        —
                    </TabsContent>
                    <TabsContent value="why" className="text-caption text-fg-3">
                        —
                    </TabsContent>
                </Tabs>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Button>Primary</Button>
                    <Button variant="outline">Outline</Button>
                    <Button variant="secondary">Secondary</Button>
                    <Button variant="ghost">Ghost</Button>
                    <FilterSheet activeCount={active} onReset={() => setChips({ home: false, away: false })} applyLabel="Show games">
                        <fieldset>
                            <legend className="label mb-2">Location</legend>
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

            <Block id="kit-card" title="Card · Crest · KpiTile">
                <Card wash={nyiTor} interactive>
                    <CardHeader>
                        <CardTitle>7:30 PM</CardTitle>
                        <Badge variant="warn">B2B</Badge>
                    </CardHeader>
                    <CardContent className="flex items-center justify-between">
                        <span className="flex items-center gap-2 sm:gap-3">
                            <Crest tri="NYI" size={56} className="h-10 w-10 sm:h-14 sm:w-14" />
                            <span className="glow-green font-display text-[15px] font-bold sm:text-[18px]">SOROKIN</span>
                        </span>
                        <span className="text-caption text-fg-3">@</span>
                        <span className="flex items-center gap-3">
                            <span className="font-display text-[15px] font-bold text-fg-2 sm:text-[18px]">STOLARZ</span>
                            <Crest tri="TOR" size={56} className="h-10 w-10 sm:h-14 sm:w-14" />
                        </span>
                    </CardContent>
                    <CardFooter className="text-[15px] font-bold text-fg-3">
                        <span>+112</span>
                        <span className="glow-magenta text-caption tracking-[0.12em]">◆ 61 NYI</span>
                        <span>−133</span>
                    </CardFooter>
                </Card>
                <div className="mt-3 grid grid-cols-2 gap-2.5">
                    <KpiTile
                        label="Log loss"
                        value="0.6823"
                        delta={{ value: 0.0081, baseline: 'market', better: 'lower', format: v => `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(4)}` }}
                        sub="n=410"
                        spark={[0.69, 0.688, 0.684, 0.686, 0.683, 0.682]}
                    />
                    <KpiTile label="Record" value="0-0" empty />
                </div>
            </Block>

            <Block id="kit-table" title="Table · SortHeader · TeamTag">
                <ScrollRegion label="Sample standings">
                    <table className="table-dense min-w-[420px]">
                        <thead>
                            <tr>
                                <th scope="col" className="text-left">
                                    Team
                                </th>
                                <th scope="col" className="text-right">
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
                                <tr key={r.team}>
                                    <th scope="row" className="text-left">
                                        <TeamTag tri={r.team} />
                                    </th>
                                    <td className="text-right text-fg-2">{r.gp}</td>
                                    <td className="text-right font-bold text-fg-1">{r.pts}</td>
                                    <td className={`text-right ${r.xgf >= 55 ? 'text-pos' : r.xgf <= 45 ? 'text-neg' : 'text-fg-1'}`}>{r.xgf.toFixed(1)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </ScrollRegion>
            </Block>

            <Block id="kit-dialog" title="Dialog · Live">
                <div className="flex flex-wrap items-center gap-4">
                    <Dialog title="Odds movement" description="How the moneyline moved since it opened." trigger={<Button variant="outline">Open dialog</Button>}>
                        <p className="text-caption text-fg-3">—</p>
                    </Dialog>
                    <FreshnessBadge generatedAt={STAMP} />
                    <span className="inline-flex items-center gap-2 text-caption font-bold tracking-[0.14em] text-pos">
                        <span aria-hidden="true" className="live-dot" />
                        2ND 14:22
                    </span>
                    <span className="glow-green font-display text-[18px] font-bold">Confirmed</span>
                    <span className="font-display text-[18px] font-bold text-pos opacity-75">Likely</span>
                    <span className="font-display text-[18px] font-bold text-fg-2">Projected</span>
                </div>
            </Block>

            <Block id="kit-teams" title="Team colours">
                <ul className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
                    {TEAM_CODES.map(tri => (
                        <li
                            key={tri}
                            className="flex h-8 items-center justify-center rounded-chip text-micro font-bold"
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
