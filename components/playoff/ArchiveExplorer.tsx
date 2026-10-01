'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { Segmented } from '@/components/ui/segmented';
import { clashSafePair } from '@/components/ui/team-color';
import { Crest } from '@/components/ui/crest';
import { cn } from '@/lib/utils';
import { scrollIntoViewSafe } from '@/lib/scroll';
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
            if (top > window.innerHeight * 0.6 || top < 0) scrollIntoViewSafe(el, { block: 'start' });
            el.focus({ preventScroll: true });
        });
    };

    const rounds = (conf: 'East' | 'West') =>
        [1, 2, 3].map(r => ({ round: r, series: archive.series.filter(s => s.conference === conf && s.round === r).sort((a, b) => a.letter.localeCompare(b.letter)) }));

    const tile = (s: ArchiveSeries) => <SeriesTile key={s.letter} series={s} selected={s.letter === selected} onSelect={choose} />;
    const current = byLetter.get(selected);

    return (
        <div className="flex flex-col gap-6">
            <section aria-labelledby="bracket-title" className="flex flex-col gap-3">
                <h2 id="bracket-title" className="heading-section">
                    Bracket
                </h2>

                {/* Phones/tablets: one section at a time. */}
                <div className="flex flex-col gap-3 lg:hidden">
                    <Segmented
                        label="Bracket section"
                        block
                        size="sm"
                        value={section}
                        onChange={setSection}
                        options={[
                            { value: 'West', label: 'West' },
                            { value: 'East', label: 'East' },
                            { value: 'Final', label: 'Final' },
                        ]}
                    />
                    {section === 'Final' ? (
                        final ? <div className="flex flex-col gap-1.5"><h3 className="label">Stanley Cup Final</h3>{tile(final)}</div> : <p className="label">Final —</p>
                    ) : (
                        rounds(section).map(r =>
                            r.series.length ? (
                                <div key={r.round} className="flex flex-col gap-1.5">
                                    <h3 className="label">{r.series[0].roundLabel}</h3>
                                    <div className="grid gap-2 sm:grid-cols-2">{r.series.map(tile)}</div>
                                </div>
                            ) : null,
                        )
                    )}
                </div>

                {/* Desktop: West → Final ← East. */}
                <div className="hidden grid-cols-7 gap-2 lg:grid">
                    {[...rounds('West'), { round: 4, series: final ? [final] : [] }, ...rounds('East').reverse()].map((r, i) => (
                        <div key={i} className="flex flex-col">
                            <p className="label mb-1.5 text-center">
                                {r.round === 4 ? 'Final' : `${i < 3 ? 'W' : 'E'} · ${r.round === 3 ? 'CF' : `R${r.round}`}`}
                            </p>
                            <div className="flex flex-1 flex-col justify-around gap-2">{r.series.map(tile)}</div>
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
            <span className="flex h-7 items-center gap-2">
                <Crest tri={team.tri} size={26} className={cn('drop-shadow-none', lost && 'opacity-50 grayscale')} />
                <span className={cn('font-bold', lost ? 'text-fg-3' : 'text-fg-1')}>{team.tri}</span>
                <span className="text-micro text-fg-3">{team.seed}</span>
                <span className={cn('num-score ml-auto text-title', won ? 'text-fg-1' : 'text-fg-3')}>{wins}</span>
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
                'flex w-full flex-col rounded-[10px] border px-2.5 py-1 text-left transition-colors coarse:py-2',
                selected ? 'border-brand/70 bg-brand/[0.06] shadow-[0_0_14px_rgb(var(--brand-rgb)/0.18)]' : 'border-line bg-[image:var(--panel-gradient)] hover:border-line-strong',
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
        requestAnimationFrame(() => scrollIntoViewSafe(analysisRef.current, { block: 'nearest' }));
    };

    return (
        <article
            aria-labelledby={`series-${s.letter}-title`}
            className="panel team-wash flex flex-col gap-4 p-card"
            style={{ '--ac': colors.away, '--hc': colors.home } as React.CSSProperties}
        >
            <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <h2 id={`series-${s.letter}-title`} className="flex items-center gap-3">
                    <span className="sr-only">
                        {s.roundLabel}
                        {s.conference ? `, ${s.conference}` : ''}:{' '}
                    </span>
                    <Crest tri={s.top.tri} size={48} />
                    <span className="num-score text-[28px] leading-none text-fg-1 md:text-[34px]">
                        <span className="font-display text-title font-semibold tracking-[0.04em]">{s.top.tri}</span> {s.topWins}
                        <span className="px-1.5 text-fg-3">–</span>
                        {s.bottomWins} <span className="font-display text-title font-semibold tracking-[0.04em]">{s.bottom.tri}</span>
                    </span>
                    <Crest tri={s.bottom.tri} size={48} />
                </h2>
                <p className="label">
                    {s.roundLabel}
                    {s.conference ? ` · ${s.conference}` : ''} · {s.top.seed} v {s.bottom.seed}
                </p>
                <p className={cn('label ml-auto rounded-chip border px-2 py-0.5', s.winner ? 'border-brand/45 text-brand' : 'border-line-strong text-fg-2')}>{seriesStatusText(s)}</p>
            </header>

            <div className="grid items-start gap-5 lg:grid-cols-2">
                <section aria-labelledby={`games-${s.letter}`} className="flex flex-col gap-1.5">
                    <h3 id={`games-${s.letter}`} className="label">
                        Games
                    </h3>
                    <ol className="flex flex-col overflow-hidden rounded-[10px] border border-line">
                        {played.map(g => (
                            <GameRow key={g.id} game={g} open={analysisId === String(g.id)} onOpen={() => open(String(g.id))} controls={`analysis-${s.letter}`} />
                        ))}
                        {upcoming.map(g => (
                            <li key={g.id} className="flex h-8 items-center gap-3 border-t border-dashed border-line-strong px-3 text-caption text-fg-2 first:border-t-0">
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
                            className="self-start rounded-control border border-line-strong px-3 py-1.5 text-micro font-medium uppercase tracking-[0.14em] text-fg-1 transition-colors hover:border-brand hover:text-brand coarse:min-h-11"
                        >
                            {analysisId === 'series' ? 'Hide series map' : 'Series shot map'}
                        </button>
                    ) : null}
                </section>
                <div className="flex min-w-0 flex-col gap-4">
                    <section aria-labelledby={`numbers-${s.letter}`} className="flex flex-col gap-2">
                        <h3 id={`numbers-${s.letter}`} className="label">
                            Series totals
                        </h3>
                        <SeriesNumbers series={s} colors={[colors.away, colors.home]} />
                    </section>
                    <section aria-labelledby={`h2h-${s.letter}`} className="flex flex-col gap-2">
                        <h3 id={`h2h-${s.letter}`} className="label">
                            Regular season
                        </h3>
                        <H2HGameLog games={h2h} t1={s.top.tri} t2={s.bottom.tri} seasonLabel={archive.seasonLabel} />
                    </section>
                </div>
            </div>

            <div id={`analysis-${s.letter}`} ref={analysisRef} className="scroll-mt-[calc(var(--appbar-h)+12px)]">
                {analysisId ? <GameAnalysis year={archive.year} games={s.games} initialGameId={analysisId} teamNames={teamNames} /> : null}
            </div>
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
        <li className={cn('flex min-h-8 flex-wrap items-center gap-x-3 border-t border-line/60 px-3 text-caption first:border-t-0 even:bg-line/35', open && '!bg-brand/[0.06]')}>
            <span className="w-7 font-bold text-fg-1">G{g.n}</span>
            <span className="hidden w-24 text-fg-3 sm:inline">{fmtGameDate(g.date)}</span>
            <span className="flex items-center gap-1.5 tabular-nums">
                <Crest tri={g.away} size={22} className="drop-shadow-none" />
                <span className={cn(!homeWon ? 'font-bold text-fg-1' : 'text-fg-2')}>
                    {g.away} {g.away_score}
                </span>
                <span className="text-fg-3">@</span>
                <Crest tri={g.home} size={22} className="drop-shadow-none" />
                <span className={cn(homeWon ? 'font-bold text-fg-1' : 'text-fg-2')}>
                    {g.home} {g.home_score}
                </span>
                {g.decision && g.decision !== 'REG' ? <span className="text-micro text-fg-3">{g.decision}</span> : null}
                {g.state === 'live' ? (
                    <span className="inline-flex items-center gap-1 text-micro font-semibold text-pos">
                        <span aria-hidden="true" className="live-dot" />
                        LIVE
                    </span>
                ) : null}
            </span>
            {g.analysis ? (
                <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={controls}
                    onClick={onOpen}
                    className="ml-auto inline-flex min-h-8 items-center gap-1 text-micro font-medium uppercase tracking-[0.14em] text-brand hover:underline coarse:min-h-11"
                >
                    {open ? 'Hide' : 'Shot map ▸'}
                    <span className="sr-only"> for game {g.n}</span>
                </button>
            ) : null}
        </li>
    );
}

function SeriesNumbers({ series: s, colors }: { series: ArchiveSeries; colors: [string, string] }) {
    const a = s.totals[s.top.tri];
    const b = s.totals[s.bottom.tri];
    if (!a || !b) return <p className="label">—</p>;
    const rows: { label: string; title?: string; a: number; b: number; fmt?: (v: number) => string; da?: string; db?: string }[] = [
        { label: 'Goals', a: a.goals, b: b.goals },
        { label: 'xG', title: 'Expected goals', a: a.xg, b: b.xg, fmt: v => v.toFixed(1) },
        { label: 'SOG', title: 'Shots on goal', a: a.sog, b: b.sog },
        { label: 'Attempts', title: 'Shot attempts', a: a.attempts, b: b.attempts },
        { label: 'PP', title: 'Power-play goals / opportunities', a: a.ppGoals, b: b.ppGoals, da: `${a.ppGoals}/${a.ppOpps}`, db: `${b.ppGoals}/${b.ppOpps}` },
        { label: 'Hits', a: a.hits, b: b.hits },
    ];
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-caption font-bold text-fg-1">
                <span className="flex items-center gap-1.5">
                    <Crest tri={s.top.tri} size={22} className="drop-shadow-none" />
                    {s.top.tri}
                </span>
                <span className="flex items-center gap-1.5">
                    {s.bottom.tri}
                    <Crest tri={s.bottom.tri} size={22} className="drop-shadow-none" />
                </span>
            </div>
            {rows.map(r => {
                const total = r.a + r.b || 1;
                const f = r.fmt ?? ((v: number) => String(v));
                return (
                    <div key={r.label} className="flex flex-col gap-0.5">
                        <div className="flex items-baseline justify-between text-caption">
                            <span className={cn('tabular-nums', r.a > r.b ? 'font-bold text-fg-1' : 'text-fg-2')}>{r.da ?? f(r.a)}</span>
                            <span className="text-micro uppercase tracking-[0.12em] text-fg-3">
                                {r.title ? (
                                    <abbr title={r.title} className="no-underline">
                                        {r.label}
                                    </abbr>
                                ) : (
                                    r.label
                                )}
                            </span>
                            <span className={cn('tabular-nums', r.b > r.a ? 'font-bold text-fg-1' : 'text-fg-2')}>{r.db ?? f(r.b)}</span>
                        </div>
                        <div aria-hidden="true" className="flex h-1.5 overflow-hidden rounded-full bg-track">
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
