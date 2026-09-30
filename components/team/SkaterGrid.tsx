'use client';

import * as React from 'react';
import { Segmented } from '@/components/ui/segmented';
import { InfoTip } from '@/components/ui/info-tip';
import { cn } from '@/lib/utils';
import { SEASON_ID } from '@/lib/season';
import { mmss, shortDate } from '@/utils/team-stats/format';
import type { Pctl, SeasonLine, SkaterCardData } from '@/utils/team-stats/team-types';

interface SkaterGridProps {
    skaters: SkaterCardData[];
    lineup: Record<string, string[]> | null;
    team: string;
    teamColor: string;
    currentLabel: string;
    prevLabel: string;
    ratingsLabel: string;
    currentSeasonGames: number;
    prevSeasonGames: number;
}

type Which = 'current' | 'last';
type SortBy = 'lineup' | 'impact' | 'pts' | 'toi';

const NEG: [number, number, number] = [255, 110, 128];
const MID: [number, number, number] = [169, 180, 194];
const POS: [number, number, number] = [92, 240, 160];
function pctColor(p: number) {
    const t = Math.max(0, Math.min(100, p)) / 100;
    const [a, b, u] = t < 0.5 ? [NEG, MID, t * 2] : [MID, POS, (t - 0.5) * 2];
    const c = a.map((x, i) => Math.round(x + (b[i] - x) * u));
    return `rgb(${c[0]} ${c[1]} ${c[2]})`;
}

const LINE_LABEL: Record<string, string> = { f1: 'Line 1', f2: 'Line 2', f3: 'Line 3', f4: 'Line 4', d1: 'Pair 1', d2: 'Pair 2', d3: 'Pair 3' };
const POS_LABEL: Record<string, string> = { C: 'C', L: 'LW', R: 'RW', D: 'D' };

/**
 * Current-roster skater cards. Counting stats come from one season's NHL
 * boxscores (This season / Last season toggle, always labelled); ratings come
 * from the player model, labelled with the season they describe. Players new
 * to the club are tagged and their ratings (earned elsewhere) are shown as —.
 */
export default function SkaterGrid(props: SkaterGridProps) {
    const { skaters, lineup, currentLabel, prevLabel, ratingsLabel } = props;
    const anyCurrent = skaters.some(s => (s.current?.gp ?? 0) > 0);
    const [which, setWhich] = React.useState<Which>(anyCurrent ? 'current' : 'last');
    const [sortBy, setSortBy] = React.useState<SortBy>(lineup ? 'lineup' : 'impact');
    const [pos, setPos] = React.useState<'all' | 'f' | 'd'>('all');
    const seasonGames = which === 'current' ? props.currentSeasonGames : props.prevSeasonGames;
    const label = which === 'current' ? currentLabel : prevLabel;

    const line = (s: SkaterCardData) => (which === 'current' ? s.current : s.last);
    const sorted = React.useMemo(() => {
        const list = skaters.filter(s => pos === 'all' || (pos === 'd' ? s.pos === 'D' : s.pos !== 'D'));
        const key = (s: SkaterCardData) => {
            if (sortBy === 'pts') return line(s)?.pts ?? -1;
            if (sortBy === 'toi') return line(s)?.toi ?? -1;
            return s.isNew ? -99 : (s.impact?.score.v ?? -99);
        };
        return [...list].sort((a, b) => key(b) - key(a) || a.name.localeCompare(b.name));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [skaters, sortBy, pos, which]);

    const byId = new Map(skaters.map(s => [s.id, s]));
    const inLineup = new Set(lineup ? Object.values(lineup).flat() : []);

    const card = (s: SkaterCardData, slot?: string) => (
        <SkaterCard key={s.id} s={s} line={line(s)} seasonLabel={label} ratingsLabel={ratingsLabel} team={props.team} teamColor={props.teamColor} seasonGames={seasonGames} slot={slot} />
    );

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
                <Segmented
                    label="Counting stats season"
                    value={which}
                    onChange={setWhich}
                    options={[
                        { value: 'current', label: `This season (${currentLabel})` },
                        { value: 'last', label: `Last season (${prevLabel})` },
                    ]}
                />
                <Segmented
                    label="Order"
                    size="sm"
                    value={sortBy}
                    onChange={setSortBy}
                    options={[
                        ...(lineup ? [{ value: 'lineup' as const, label: 'Lineup' }] : []),
                        { value: 'impact', label: 'Impact' },
                        { value: 'pts', label: 'Points' },
                        { value: 'toi', label: 'Ice time' },
                    ]}
                />
                {sortBy !== 'lineup' ? (
                    <Segmented
                        label="Position"
                        size="sm"
                        value={pos}
                        onChange={setPos}
                        options={[
                            { value: 'all', label: 'All' },
                            { value: 'f', label: 'Forwards' },
                            { value: 'd', label: 'Defence' },
                        ]}
                    />
                ) : null}
            </div>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-fg-2">
                <span>
                    GP, goals, assists, shots and TOI: <span className="font-mono font-semibold text-fg-1">{label}</span> regular season (NHL boxscores).
                </span>
                <span className="inline-flex items-center gap-1">
                    <span className="rounded-[3px] bg-fg-3/15 px-1 font-mono text-micro font-semibold text-fg-2">Ratings: {ratingsLabel}</span>
                    <InfoTip term="player-impact" />
                </span>
                <span className="inline-flex items-center gap-2">
                    <Swatch className="bg-fg-1/80" /> played <Swatch className="bg-warn/80" /> missed <Swatch className="bg-playoff/80" /> other team <Swatch className="bg-fg-3/30" /> not with team / to play
                </span>
            </p>

            {which === 'current' && !anyCurrent ? (
                <p role="status" className="rounded-control border border-dashed border-line-strong px-4 py-3 text-body-sm text-fg-2">
                    No {currentLabel} games in the boxscores yet: counting stats read 0.{' '}
                    <button type="button" onClick={() => setWhich('last')} className="font-semibold text-brand hover:underline">
                        Show {prevLabel}
                    </button>
                </p>
            ) : null}

            {sortBy === 'lineup' && lineup ? (
                <div className="flex flex-col gap-5">
                    {Object.entries(lineup).map(([slot, ids]) =>
                        ids.length ? (
                            <section key={slot} aria-label={LINE_LABEL[slot] ?? slot}>
                                <h3 className="hud-label mb-2 flex items-center gap-2">
                                    {LINE_LABEL[slot] ?? slot}
                                    <span aria-hidden="true" className="h-px flex-1 bg-line" />
                                </h3>
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                    {ids.map(id => byId.get(id)).filter((s): s is SkaterCardData => !!s).map(s => card(s, slot))}
                                </div>
                            </section>
                        ) : null,
                    )}
                    {skaters.some(s => !inLineup.has(s.id)) ? (
                        <section aria-label="Rest of the roster">
                            <h3 className="hud-label mb-2 flex items-center gap-2">
                                Rest of the roster
                                <span aria-hidden="true" className="h-px flex-1 bg-line" />
                            </h3>
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                {sorted.filter(s => !inLineup.has(s.id)).map(s => card(s))}
                            </div>
                        </section>
                    ) : null}
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{sorted.map(s => card(s))}</div>
            )}
        </div>
    );
}

function Swatch({ className }: { className: string }) {
    return <span aria-hidden="true" className={cn('inline-block h-1.5 w-3 rounded-sm', className)} />;
}

function SkaterCard({
    s, line, seasonLabel, ratingsLabel, team, teamColor, seasonGames, slot,
}: {
    s: SkaterCardData;
    line: SeasonLine | null;
    seasonLabel: string;
    ratingsLabel: string;
    team: string;
    teamColor: string;
    seasonGames: number;
    slot?: string;
}) {
    const imp = s.isNew ? null : s.impact;
    const [imgOk, setImgOk] = React.useState(true);
    const stats: [string, React.ReactNode][] = [
        ['GP', line?.gp ?? 0],
        ['G', line?.g ?? 0],
        ['A', line?.a ?? 0],
        ['PTS', line?.pts ?? 0],
        ['SOG', line?.sog ?? 0],
        ['TOI', line && line.gp ? mmss(line.toi) : '—'],
    ];
    return (
        <article aria-labelledby={`sk-${s.id}`} className="relative flex flex-col overflow-hidden rounded-card border border-line bg-surface-1 shadow-card">
            <div aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5" style={{ background: `linear-gradient(90deg, ${s.isNew ? 'rgb(var(--playoff-rgb))' : teamColor}, transparent 75%)` }} />
            <div className="flex items-stretch gap-2 px-3 pt-3">
                <div className="relative -mb-1 h-16 w-14 shrink-0 overflow-hidden">
                    {imgOk ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={`https://assets.nhle.com/mugs/nhl/${SEASON_ID}/${team}/${s.id}.png`}
                            alt=""
                            loading="lazy"
                            width={56}
                            height={64}
                            onError={() => setImgOk(false)}
                            className="absolute bottom-0 left-0 h-[120%] w-auto max-w-none object-contain"
                        />
                    ) : (
                        <span className="flex h-full w-full items-end justify-center text-title font-black text-fg-3">{s.number ?? ''}</span>
                    )}
                </div>
                <div className="min-w-0 flex-1 py-0.5">
                    <h4 id={`sk-${s.id}`} className="truncate text-title font-bold leading-tight text-fg-1">
                        {s.name}
                    </h4>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-fg-2">
                        <span className="rounded-chip bg-surface-3 px-1.5 py-0.5 font-semibold text-fg-1">{POS_LABEL[s.pos] ?? s.pos}</span>
                        {s.number != null ? <span className="tabular-nums">#{s.number}</span> : null}
                        {s.age ? <span>{s.age}y</span> : null}
                        {s.shoots ? <span>shoots {s.shoots}</span> : null}
                        {s.isNew ? (
                            <span className="rounded-chip bg-playoff/15 px-1.5 py-0.5 font-semibold text-playoff">
                                New{s.from ? ` · from ${s.from}` : ''}
                            </span>
                        ) : null}
                        {s.injury ? <span className="rounded-chip bg-neg/15 px-1.5 py-0.5 font-semibold text-neg">{s.injury.status}{s.injury.returnDate ? ` · ~${shortDate(s.injury.returnDate)}` : ''}</span> : null}
                    </p>
                </div>
                <div className="flex shrink-0 flex-col items-end">
                    <span className="text-micro text-fg-3">Impact</span>
                    <span
                        className="mt-0.5 min-w-[3.5rem] rounded-control px-2 py-1 text-center text-title font-black tabular-nums"
                        style={imp ? { color: pctColor(imp.score.p), background: 'rgb(var(--surface-3-rgb))' } : undefined}
                    >
                        {imp ? `${imp.score.v >= 0 ? '+' : '−'}${Math.abs(imp.score.v).toFixed(2)}` : '—'}
                    </span>
                    <span className="mt-0.5 text-micro tabular-nums text-fg-3">{imp ? `${imp.score.p}th pct` : s.isNew ? 'not yet rated here' : 'unrated'}</span>
                </div>
            </div>

            <dl className="mt-3 grid grid-cols-6 border-y border-line text-center">
                {stats.map(([k, v]) => (
                    <div key={k} className="py-2">
                        <dt className="text-micro text-fg-3">{k}</dt>
                        <dd className="text-body font-semibold tabular-nums text-fg-1">{v}</dd>
                    </div>
                ))}
            </dl>
            <p className="px-3 pt-1.5 text-micro text-fg-3">
                <span className="font-mono">{seasonLabel}</span> totals{slot ? ` · ${LINE_LABEL[slot]}` : ''}
            </p>

            <div className="grid grid-cols-3 gap-px px-3 pt-2">
                <Metric label="xGF/60" m={imp?.xgf60} />
                <Metric label="xGA/60" m={imp?.xga60} />
                <Metric label="xG%" m={imp?.xgPct} fmt={v => `${(v * 100).toFixed(1)}%`} />
                <Metric label="iXG/60" m={imp?.ixg60} />
                <Metric label="Rel xG%" m={imp?.rel} fmt={v => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1)}`} />
                <Metric label="Pen ±/60" m={imp?.pen} fmt={v => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`} />
            </div>
            <p className="px-3 pb-1 pt-1 text-micro text-fg-3">
                Ratings: <span className="font-mono">{ratingsLabel}</span>
                {s.isNew && s.impact ? ` · with ${s.impact.team ?? 'previous team'}: ${s.impact.score.v >= 0 ? '+' : '−'}${Math.abs(s.impact.score.v).toFixed(2)}` : ''}
                {imp ? ` · EV ${mmss(imp.evToi)} · PP ${mmss(imp.ppToi)} · PK ${mmss(imp.pkToi)}` : ''}
            </p>

            <Availability avail={line?.avail ?? ''} total={seasonGames} label={seasonLabel} />
        </article>
    );
}

function Metric({ label, m, fmt = v => v.toFixed(2) }: { label: string; m?: Pctl; fmt?: (v: number) => string }) {
    return (
        <div className="flex items-baseline justify-between gap-1 rounded-chip px-1.5 py-1">
            <span className="text-micro text-fg-3">{label}</span>
            <span className="text-caption font-semibold tabular-nums" style={m ? { color: pctColor(m.p) } : undefined}>
                {m ? fmt(m.v) : <span className="text-fg-3">—</span>}
            </span>
        </div>
    );
}

function Availability({ avail, total, label }: { avail: string; total: number; label: string }) {
    const played = avail.split('').filter(c => c === '1').length;
    const missed = avail.split('').filter(c => c === '0').length;
    const other = avail.split('').filter(c => c === 'o').length;
    const slots = [...avail.split(''), ...Array.from({ length: Math.max(0, total - avail.length) }, () => '-')];
    return (
        <div className="px-3 pb-3 pt-2">
            <div aria-hidden="true" className="flex gap-px">
                {slots.map((c, i) => (
                    <span
                        key={i}
                        className={cn(
                            'h-1.5 flex-1 rounded-[1px]',
                            c === '1' ? 'bg-fg-1/80' : c === '0' ? 'bg-warn/80' : c === 'o' ? 'bg-playoff/80' : 'bg-fg-3/25',
                        )}
                    />
                ))}
            </div>
            <p className="sr-only">
                {label}: played {played} of the team&apos;s {avail.length} games{other ? `, ${other} for another team` : ''}
                {missed ? `, missed ${missed}` : ''}.
            </p>
        </div>
    );
}
