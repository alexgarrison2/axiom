'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { Segmented } from '@/components/ui/segmented';
import { clashSafePair } from '@/components/ui/team-color';
import { TeamLogo } from '@/components/views/TeamLogo';
import { cn } from '@/lib/utils';
import H2HGameLog from './H2HGameLog';
import { seriesStatusText, type ArchiveGame, type ArchiveSeries, type PlayoffArchive } from './types';

// The shot map / box score code only loads when someone opens a game.
const GameAnalysis = dynamic(() => import('./GameAnalysis'), {
    ssr: false,
    loading: () => <div className="h-64 rounded-control border border-line bg-surface-2/40" aria-busy="true" />,
});

type Section = 'West' | 'East' | 'Final';

function hashFor(letter: string) {
    return `series-${letter.toLowerCase()}`;
}

export default function ArchiveExplorer({ archive }: { archive: PlayoffArchive }) {
    const byLetter = React.useMemo(() => new Map(archive.series.map(s => [s.letter, s])), [archive.series]);
    const final = archive.series.find(s => s.round === 4);
    const [selected, setSelected] = React.useState<string>(final?.letter ?? archive.series[0]?.letter ?? '');
    const [section, setSection] = React.useState<Section>('Final');
    const detailRef = React.useRef<HTMLDivElement>(null);

    // Deep links: /playoffs/20252026#series-b
    React.useEffect(() => {
        const read = () => {
            const m = window.location.hash.match(/^#series-([a-z])$/i);
            const s = m ? byLetter.get(m[1].toUpperCase()) : undefined;
            if (s) {
                setSelected(s.letter);
                setSection(s.round === 4 ? 'Final' : s.conference ?? 'West');
            }
        };
        read();
        window.addEventListener('hashchange', read);
        return () => window.removeEventListener('hashchange', read);
    }, [byLetter]);

    const choose = (s: ArchiveSeries) => {
        setSelected(s.letter);
        try {
            window.history.replaceState(null, '', `#${hashFor(s.letter)}`);
        } catch {
            /* ignore */
        }
        requestAnimationFrame(() => {
            const el = detailRef.current;
            if (!el) return;
            const top = el.getBoundingClientRect().top;
            if (top > window.innerHeight * 0.6 || top < 0) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            el.focus({ preventScroll: true });
        });
    };

    const rounds = (conf: 'East' | 'West') =>
        [1, 2, 3].map(r => ({ round: r, series: archive.series.filter(s => s.conference === conf && s.round === r).sort((a, b) => a.letter.localeCompare(b.letter)) }));

    const tile = (s: ArchiveSeries) => <SeriesTile key={s.letter} series={s} selected={s.letter === selected} onSelect={choose} />;
    const current = byLetter.get(selected);

    return (
        <div className="flex flex-col gap-8">
            <section aria-labelledby="bracket-title" className="flex flex-col gap-4">
                <h2 id="bracket-title" className="text-h2 font-black uppercase italic tracking-tight text-fg-1">
                    The bracket
                </h2>

                {/* Phones/tablets: one section at a time. */}
                <div className="flex flex-col gap-4 lg:hidden">
                    <Segmented
                        label="Bracket section"
                        block
                        value={section}
                        onChange={setSection}
                        options={[
                            { value: 'West', label: 'West' },
                            { value: 'East', label: 'East' },
                            { value: 'Final', label: 'Final' },
                        ]}
                    />
                    {section === 'Final' ? (
                        final ? <div className="flex flex-col gap-2"><h3 className="hud-label">Stanley Cup Final</h3>{tile(final)}</div> : <p className="text-body-sm text-fg-3">The Final hasn&apos;t started.</p>
                    ) : (
                        rounds(section).map(r =>
                            r.series.length ? (
                                <div key={r.round} className="flex flex-col gap-2">
                                    <h3 className="hud-label">{r.series[0].roundLabel}</h3>
                                    <div className="grid gap-2 sm:grid-cols-2">{r.series.map(tile)}</div>
                                </div>
                            ) : null,
                        )
                    )}
                </div>

                {/* Desktop: West → Final ← East. */}
                <div className="hidden grid-cols-7 gap-3 lg:grid">
                    {[...rounds('West'), { round: 4, series: final ? [final] : [] }, ...rounds('East').reverse()].map((r, i) => (
                        <div key={i} className="flex flex-col">
                            <p className="hud-label mb-2 text-center">
                                {r.round === 4 ? 'Final' : `${i < 3 ? 'West' : 'East'} · ${r.round === 3 ? 'Conf. final' : `Round ${r.round}`}`}
                            </p>
                            <div className="flex flex-1 flex-col justify-around gap-3">{r.series.map(tile)}</div>
                        </div>
                    ))}
                </div>
            </section>

            <div ref={detailRef} tabIndex={-1} id="series-detail" className="scroll-mt-[calc(var(--appbar-h)+12px)] outline-none">
                {current ? <SeriesDetail key={current.letter} series={current} archive={archive} /> : null}
            </div>
        </div>
    );
}

function SeriesTile({ series: s, selected, onSelect }: { series: ArchiveSeries; selected: boolean; onSelect: (s: ArchiveSeries) => void }) {
    const row = (team: ArchiveSeries['top'], wins: number) => {
        const won = s.winner === team.tri;
        const lost = !!s.winner && !won;
        return (
            <span className="flex items-center gap-2">
                <TeamLogo tri={team.tri} size={22} className={cn(lost && 'opacity-50 grayscale')} />
                <span className={cn('font-bold', lost ? 'text-fg-3' : 'text-fg-1')}>{team.tri}</span>
                <span className="font-mono text-micro text-fg-3">{team.seed}</span>
                <span className={cn('ml-auto text-title font-black tabular-nums', won ? 'text-fg-1' : 'text-fg-3')}>{wins}</span>
            </span>
        );
    };
    return (
        <button
            type="button"
            aria-pressed={selected}
            aria-label={`${s.roundLabel}${s.conference ? `, ${s.conference}` : ''}: ${s.top.tri} vs ${s.bottom.tri}. ${seriesStatusText(s)}`}
            onClick={() => onSelect(s)}
            className={cn(
                'flex w-full flex-col gap-1 rounded-control border px-3 py-2 text-left transition-colors',
                selected ? 'border-playoff/70 bg-playoff/10 shadow-[inset_0_0_0_1px_rgb(var(--playoff-rgb)/0.6)]' : 'border-line bg-surface-1 hover:bg-surface-2',
            )}
        >
            {row(s.top, s.topWins)}
            {row(s.bottom, s.bottomWins)}
        </button>
    );
}

function SeriesDetail({ series: s, archive }: { series: ArchiveSeries; archive: PlayoffArchive }) {
    const [analysisId, setAnalysisId] = React.useState<string | null>(null);
    const analysisRef = React.useRef<HTMLDivElement>(null);
    const played = s.games.filter(g => g.state !== 'scheduled');
    const upcoming = s.winner ? [] : s.games.filter(g => g.state === 'scheduled');
    const teamNames = Object.fromEntries(Object.entries(archive.teams).map(([k, v]) => [k, v.short]));
    const colors = clashSafePair(s.top.tri, s.bottom.tri);
    const h2h = archive.h2h[`${s.top.tri}_${s.bottom.tri}`] ?? archive.h2h[`${s.bottom.tri}_${s.top.tri}`] ?? [];
    const open = (id: string) => {
        setAnalysisId(prev => (prev === id ? null : id));
        requestAnimationFrame(() => analysisRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
    };

    return (
        <article aria-labelledby={`series-${s.letter}-title`} className="hud-panel flex flex-col gap-6 p-4 md:p-6">
            <header className="flex flex-col gap-3">
                <p className="hud-label text-playoff">
                    {s.roundLabel}
                    {s.conference ? ` · ${s.conference}` : ''}
                </p>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                    <h2 id={`series-${s.letter}-title`} className="flex items-center gap-3 text-h2 font-black tracking-tight text-fg-1">
                        <TeamLogo tri={s.top.tri} size={40} />
                        <span className="tabular-nums">
                            {s.top.tri} {s.topWins}
                            <span className="px-1.5 text-fg-3">–</span>
                            {s.bottomWins} {s.bottom.tri}
                        </span>
                        <TeamLogo tri={s.bottom.tri} size={40} />
                    </h2>
                    <p className={cn('rounded-full px-3 py-1 text-body-sm font-bold', s.winner ? 'bg-playoff/15 text-fg-1' : 'bg-surface-3 text-fg-2')}>{seriesStatusText(s)}</p>
                </div>
                <p className="text-body-sm text-fg-2">
                    ({s.top.seed}) {archive.teams[s.top.tri]?.name ?? s.top.tri} vs ({s.bottom.seed}) {archive.teams[s.bottom.tri]?.name ?? s.bottom.tri}
                </p>
            </header>

            <section aria-labelledby={`games-${s.letter}`} className="flex flex-col gap-2">
                <h3 id={`games-${s.letter}`} className="hud-label">
                    Games
                </h3>
                <ol className="flex flex-col gap-1.5">
                    {played.map(g => (
                        <GameRow key={g.id} game={g} open={analysisId === String(g.id)} onOpen={() => open(String(g.id))} controls={`analysis-${s.letter}`} />
                    ))}
                    {upcoming.map(g => (
                        <li key={g.id} className="flex items-center gap-3 rounded-control border border-dashed border-line-strong px-3 py-2 text-body-sm text-fg-2">
                            <span className="w-8 font-bold text-fg-1">G{g.n}</span>
                            <span>{fmtGameDate(g.date)}</span>
                            <span>
                                {g.away} @ {g.home}
                            </span>
                        </li>
                    ))}
                </ol>
                {played.some(g => g.analysis) && played.length > 1 ? (
                    <button
                        type="button"
                        aria-expanded={analysisId === 'series'}
                        aria-controls={`analysis-${s.letter}`}
                        onClick={() => open('series')}
                        className="self-start rounded-control border border-line-strong px-3 py-2 text-body-sm font-semibold text-fg-1 transition-colors hover:bg-surface-2 coarse:min-h-11"
                    >
                        {analysisId === 'series' ? 'Hide series analysis' : 'Shot map for the whole series'}
                    </button>
                ) : null}
            </section>

            <div id={`analysis-${s.letter}`} ref={analysisRef} className="scroll-mt-[calc(var(--appbar-h)+12px)]">
                {analysisId ? <GameAnalysis year={archive.year} games={s.games} initialGameId={analysisId} teamNames={teamNames} /> : null}
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
                <section aria-labelledby={`numbers-${s.letter}`} className="flex flex-col gap-3">
                    <h3 id={`numbers-${s.letter}`} className="hud-label">
                        Series by the numbers
                    </h3>
                    <SeriesNumbers series={s} colors={[colors.away, colors.home]} />
                </section>
                <section aria-labelledby={`h2h-${s.letter}`} className="flex flex-col gap-3">
                    <h3 id={`h2h-${s.letter}`} className="hud-label">
                        Regular-season meetings
                    </h3>
                    <H2HGameLog games={h2h} t1={s.top.tri} t2={s.bottom.tri} seasonLabel={archive.seasonLabel} />
                </section>
            </div>
            {s.winner ? <p className="text-caption text-fg-3">Pre-series model odds weren&apos;t archived, so completed series show results only.</p> : null}
        </article>
    );
}

function fmtGameDate(date: string) {
    const d = new Date(`${date}T12:00:00Z`);
    return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function GameRow({ game: g, open, onOpen, controls }: { game: ArchiveGame; open: boolean; onOpen: () => void; controls: string }) {
    const homeWon = (g.home_score ?? 0) > (g.away_score ?? 0);
    return (
        <li className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 rounded-control border px-3 py-2 text-body-sm', open ? 'border-playoff/60 bg-playoff/5' : 'border-line bg-surface-2/40')}>
            <span className="w-8 font-bold text-fg-1">G{g.n}</span>
            <span className="w-24 text-fg-3">{fmtGameDate(g.date)}</span>
            <span className="flex items-center gap-1.5 tabular-nums">
                <TeamLogo tri={g.away} size={18} />
                <span className={cn(!homeWon ? 'font-bold text-fg-1' : 'text-fg-2')}>
                    {g.away} {g.away_score}
                </span>
                <span className="text-fg-3">@</span>
                <TeamLogo tri={g.home} size={18} />
                <span className={cn(homeWon ? 'font-bold text-fg-1' : 'text-fg-2')}>
                    {g.home} {g.home_score}
                </span>
                {g.decision && g.decision !== 'REG' ? <span className="rounded-chip bg-surface-3 px-1.5 text-micro font-semibold text-fg-2">{g.decision}</span> : null}
                {g.state === 'live' ? <span className="rounded-chip bg-neg/15 px-1.5 text-micro font-semibold text-neg">LIVE</span> : null}
            </span>
            {g.analysis ? (
                <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={controls}
                    onClick={onOpen}
                    className="ml-auto inline-flex min-h-9 items-center gap-1 rounded-control px-2.5 font-semibold text-brand transition-colors hover:bg-surface-3 coarse:min-h-11"
                >
                    {open ? 'Hide analysis' : 'Shot map & box score'}
                    <span className="sr-only"> for game {g.n}</span>
                </button>
            ) : null}
        </li>
    );
}

function SeriesNumbers({ series: s, colors }: { series: ArchiveSeries; colors: [string, string] }) {
    const a = s.totals[s.top.tri];
    const b = s.totals[s.bottom.tri];
    if (!a || !b) return <p className="text-body-sm text-fg-3">No team totals recorded.</p>;
    const rows: { label: string; a: number; b: number; fmt?: (v: number) => string; note?: string }[] = [
        { label: 'Goals', a: a.goals, b: b.goals },
        { label: 'Expected goals', a: a.xg, b: b.xg, fmt: v => v.toFixed(1) },
        { label: 'Shots on goal', a: a.sog, b: b.sog },
        { label: 'Shot attempts', a: a.attempts, b: b.attempts },
        { label: 'Power-play goals', a: a.ppGoals, b: b.ppGoals, note: `${a.ppGoals}/${a.ppOpps} vs ${b.ppGoals}/${b.ppOpps}` },
        { label: 'Hits', a: a.hits, b: b.hits },
    ];
    return (
        <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between text-caption font-semibold text-fg-2">
                <span className="flex items-center gap-1.5">
                    <TeamLogo tri={s.top.tri} size={16} />
                    {s.top.tri}
                </span>
                <span className="flex items-center gap-1.5">
                    {s.bottom.tri}
                    <TeamLogo tri={s.bottom.tri} size={16} />
                </span>
            </div>
            {rows.map(r => {
                const total = r.a + r.b || 1;
                const f = r.fmt ?? ((v: number) => String(v));
                return (
                    <div key={r.label} className="flex flex-col gap-1">
                        <div className="flex items-baseline justify-between text-body-sm">
                            <span className={cn('tabular-nums', r.a > r.b ? 'font-bold text-fg-1' : 'text-fg-2')}>{f(r.a)}</span>
                            <span className="text-caption text-fg-3">{r.note ? `${r.label} (${r.note})` : r.label}</span>
                            <span className={cn('tabular-nums', r.b > r.a ? 'font-bold text-fg-1' : 'text-fg-2')}>{f(r.b)}</span>
                        </div>
                        <div aria-hidden="true" className="flex h-1.5 overflow-hidden rounded-full bg-fg-3/15">
                            <span style={{ width: `${(r.a / total) * 100}%`, backgroundColor: colors[0] }} />
                            <span className="w-0.5 bg-bg" />
                            <span style={{ width: `${(r.b / total) * 100}%`, backgroundColor: colors[1] }} />
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
