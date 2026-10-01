'use client';

import * as React from 'react';
import { Segmented } from '@/components/ui/segmented';
import { SeasonTag, shortSeasonTag } from '@/components/ui/stat-chip';
import { cn } from '@/lib/utils';
import { SEASON_ID } from '@/lib/season';
import { injuryCode, mmss, shortDate } from '@/utils/team-stats/format';
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
type SortBy = 'lineup' | 'net' | 'pts' | 'toi';

// Percentile ramp: --neg → neutral → --pos (every stop ≥5:1 on the panel).
const NEG: [number, number, number] = [255, 84, 112];
const MID: [number, number, number] = [169, 180, 194];
const POS: [number, number, number] = [61, 255, 143];
function pctColor(p: number) {
    const t = Math.max(0, Math.min(100, p)) / 100;
    const [a, b, u] = t < 0.5 ? [NEG, MID, t * 2] : [MID, POS, (t - 0.5) * 2];
    const c = a.map((x, i) => Math.round(x + (b[i] - x) * u));
    return `rgb(${c[0]} ${c[1]} ${c[2]})`;
}

const LINE_LABEL: Record<string, string> = { f1: 'Line 1', f2: 'Line 2', f3: 'Line 3', f4: 'Line 4', d1: 'Pair 1', d2: 'Pair 2', d3: 'Pair 3' };
const POS_LABEL: Record<string, string> = { C: 'C', L: 'LW', R: 'RW', D: 'D' };
const GRID = 'grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 min-[1760px]:grid-cols-5';
const sgn = (v: number, d = 2) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`;

/**
 * Current-roster skater cards. Counting stats come from one season's NHL
 * boxscores (season toggle); NET / OFF / DEF are the current RAPM ratings
 * (they follow the player, so a newcomer shows his own); the on-ice rates
 * come from the player model's season and carry its tag.
 */
export default function SkaterGrid(props: SkaterGridProps) {
    const { skaters, lineup, currentLabel, prevLabel, ratingsLabel } = props;
    const anyCurrent = skaters.some(s => (s.current?.gp ?? 0) > 0);
    const [which, setWhich] = React.useState<Which>(anyCurrent ? 'current' : 'last');
    const [sortBy, setSortBy] = React.useState<SortBy>(lineup ? 'lineup' : 'net');
    const [pos, setPos] = React.useState<'all' | 'f' | 'd'>('all');
    const seasonGames = which === 'current' ? props.currentSeasonGames : props.prevSeasonGames;
    const label = which === 'current' ? currentLabel : prevLabel;

    const line = (s: SkaterCardData) => (which === 'current' ? s.current : s.last);
    const sorted = React.useMemo(() => {
        const list = skaters.filter(s => pos === 'all' || (pos === 'd' ? s.pos === 'D' : s.pos !== 'D'));
        const key = (s: SkaterCardData) => {
            if (sortBy === 'pts') return line(s)?.pts ?? -1;
            if (sortBy === 'toi') return line(s)?.toi ?? -1;
            return s.rating?.net ?? -99;
        };
        return [...list].sort((a, b) => key(b) - key(a) || a.name.localeCompare(b.name));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [skaters, sortBy, pos, which]);

    const byId = new Map(skaters.map(s => [s.id, s]));
    const inLineup = new Set(lineup ? Object.values(lineup).flat() : []);
    const ratingsTag = shortSeasonTag(ratingsLabel);
    // On-ice rates are one season's model output; tag them whenever that
    // season differs from the counting-stats season on screen.
    const ratingsPrior = !!ratingsLabel && ratingsLabel !== label;

    const card = (s: SkaterCardData) => (
        <SkaterCard
            key={s.id}
            s={s}
            line={line(s)}
            seasonLabel={label}
            prior={which === 'last'}
            ratingsTag={ratingsPrior ? ratingsTag : undefined}
            ratingsLabel={ratingsLabel}
            team={props.team}
            teamColor={props.teamColor}
            seasonGames={seasonGames}
        />
    );

    return (
        <div className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
                <Segmented
                    label="Counting stats season"
                    size="sm"
                    value={which}
                    onChange={setWhich}
                    options={[
                        { value: 'current', label: shortSeasonTag(currentLabel) ?? currentLabel, ariaLabel: `This season (${currentLabel})` },
                        { value: 'last', label: shortSeasonTag(prevLabel) ?? prevLabel, ariaLabel: `Last season (${prevLabel})` },
                    ]}
                />
                <Segmented
                    label="Order"
                    size="sm"
                    value={sortBy}
                    onChange={setSortBy}
                    options={[
                        ...(lineup ? [{ value: 'lineup' as const, label: 'Lines' }] : []),
                        { value: 'net', label: 'NET' },
                        { value: 'pts', label: 'PTS' },
                        { value: 'toi', label: 'TOI' },
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
                            { value: 'f', label: 'F' },
                            { value: 'd', label: 'D' },
                        ]}
                    />
                ) : null}
                <span aria-hidden="true" className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-micro uppercase tracking-wide text-fg-3">
                    <Swatch className="bg-fg-1/80" label="GP" />
                    <Swatch className="bg-warn/80" label="Out" />
                    <Swatch className="bg-brand/60" label="Other" />
                    {ratingsPrior ? (
                        <span className="inline-flex items-center gap-1">
                            Rates <SeasonTag>{ratingsTag}</SeasonTag>
                        </span>
                    ) : null}
                </span>
            </div>

            {sortBy === 'lineup' && lineup ? (
                <div className="flex flex-col gap-3">
                    {Object.entries(lineup).map(([slot, ids]) =>
                        ids.length ? (
                            <section key={slot} aria-label={LINE_LABEL[slot] ?? slot}>
                                <h3 className="label mb-1.5 flex items-center gap-2">
                                    {LINE_LABEL[slot] ?? slot}
                                    <span aria-hidden="true" className="h-px flex-1 bg-line" />
                                </h3>
                                <div className={GRID}>{ids.map(id => byId.get(id)).filter((s): s is SkaterCardData => !!s).map(s => card(s))}</div>
                            </section>
                        ) : null,
                    )}
                    {skaters.some(s => !inLineup.has(s.id)) ? (
                        <section aria-label="Extras">
                            <h3 className="label mb-1.5 flex items-center gap-2">
                                Extras
                                <span aria-hidden="true" className="h-px flex-1 bg-line" />
                            </h3>
                            <div className={GRID}>{sorted.filter(s => !inLineup.has(s.id)).map(s => card(s))}</div>
                        </section>
                    ) : null}
                </div>
            ) : (
                <div className={GRID}>{sorted.map(s => card(s))}</div>
            )}
        </div>
    );
}

function Swatch({ className, label }: { className: string; label: string }) {
    return (
        <span className="inline-flex items-center gap-1">
            <span className={cn('inline-block h-1.5 w-3 rounded-sm', className)} />
            {label}
        </span>
    );
}

function SkaterCard({
    s, line, seasonLabel, prior, ratingsTag, ratingsLabel, team, teamColor, seasonGames,
}: {
    s: SkaterCardData;
    line: SeasonLine | null;
    seasonLabel: string;
    prior: boolean;
    ratingsTag?: string;
    ratingsLabel: string;
    team: string;
    teamColor: string;
    seasonGames: number;
}) {
    const imp = s.rates;
    const rt = s.rating;
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
        <article aria-labelledby={`sk-${s.id}`} className="panel relative flex flex-col overflow-hidden">
            <div aria-hidden="true" className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, ${s.isNew ? 'rgb(var(--model-rgb))' : teamColor}, transparent 70%)` }} />
            <div className="flex items-stretch gap-2.5 px-3 pt-2.5">
                <div className="relative -mb-px h-[52px] w-11 shrink-0 overflow-hidden">
                    {imgOk ? (
                        // eslint-disable-next-line @next/next/no-img-element -- remote NHL headshot, no optimisation needed
                        <img
                            src={`https://assets.nhle.com/mugs/nhl/${SEASON_ID}/${team}/${s.id}.png`}
                            alt=""
                            loading="lazy"
                            width={44}
                            height={52}
                            onError={() => setImgOk(false)}
                            className="absolute bottom-0 left-0 h-[118%] w-auto max-w-none object-contain"
                        />
                    ) : (
                        <span className="flex h-full w-full items-end justify-center font-display text-[20px] font-bold text-fg-3">{s.number ?? ''}</span>
                    )}
                </div>
                <div className="min-w-0 flex-1">
                    <h4 id={`sk-${s.id}`} className="truncate font-display text-[15px] font-semibold uppercase leading-5 text-fg-1">
                        {s.name}
                    </h4>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-micro uppercase tracking-wide text-fg-3">
                        <span className="font-bold text-fg-1">{POS_LABEL[s.pos] ?? s.pos}</span>
                        {s.number != null ? <span>#{s.number}</span> : null}
                        {s.age ? <span>{s.age}Y</span> : null}
                        {s.isNew ? <span className="font-bold text-brand">New{s.from ? ` ${s.from}` : ''}</span> : null}
                        {s.injury ? (
                            <span className="font-bold text-neg" title={s.injury.status}>
                                {injuryCode(s.injury.status)}
                                {s.injury.returnDate ? ` ${shortDate(s.injury.returnDate)}` : ''}
                                <span className="sr-only"> ({s.injury.status})</span>
                            </span>
                        ) : null}
                    </p>
                </div>
                <div className="flex shrink-0 flex-col items-end" title="NET: EV xG per 60 above average (OFF + DEF)">
                    <span className="label">Net</span>
                    <span
                        className="font-display text-[22px] font-bold leading-7 tabular-nums"
                        style={rt && rt.pct != null && rt.evMin >= 250 ? { color: pctColor(rt.pct) } : { color: 'rgb(var(--text-3-rgb))' }}
                    >
                        {rt ? sgn(rt.net) : '—'}
                    </span>
                    {rt?.pct != null ? <span className="text-micro tabular-nums text-fg-3">P{rt.pct}</span> : null}
                    {rt && !rt.rated ? <span className="sr-only">rookie prior</span> : null}
                </div>
            </div>

            <dl className="mt-2 grid grid-cols-6 border-y border-line text-center">
                {stats.map(([k, v]) => (
                    <div key={k} className="py-1">
                        <dt className="text-micro uppercase tracking-wide text-fg-3">{k}</dt>
                        <dd className={cn('text-caption font-bold tabular-nums', prior ? 'text-fg-2' : 'text-fg-1')}>{v}</dd>
                    </div>
                ))}
            </dl>
            <span className="sr-only">{seasonLabel} regular season</span>

            {rt ? (
                <p className="flex items-center gap-3 px-3 pt-1.5 text-micro uppercase tabular-nums text-fg-3">
                    <span title="Offence: EV xG for per 60 above average">
                        Off <span className="font-bold text-fg-2">{sgn(rt.off)}</span>
                    </span>
                    <span title="Defence: EV xG against per 60 prevented vs average">
                        Def <span className="font-bold text-fg-2">{sgn(rt.def)}</span>
                    </span>
                    <span title="Even-strength minutes behind the rating" className="ml-auto">
                        {rt.evMin.toLocaleString('en-US')} EV min
                    </span>
                </p>
            ) : null}

            {imp ? (
                <div data-ratings-season={ratingsLabel} data-prior={ratingsTag ? '' : undefined}>
                    <span className="sr-only">{ratingsLabel} on-ice rates</span>
                    <div className="grid grid-cols-3 gap-x-2 px-3 pt-1.5">
                        <Metric label="xGF/60" m={imp.xgf60} faded={!!ratingsTag} />
                        <Metric label="xGA/60" m={imp.xga60} faded={!!ratingsTag} />
                        <Metric label="xG%" m={imp.xgPct} faded={!!ratingsTag} fmt={v => (v * 100).toFixed(1)} />
                        <Metric label="ixG/60" m={imp.ixg60} faded={!!ratingsTag} />
                        <Metric label="Rel xG" m={imp.rel} faded={!!ratingsTag} fmt={v => sgn(v * 100, 1)} />
                        <Metric label="Pen/60" m={imp.pen} faded={!!ratingsTag} fmt={v => sgn(v)} />
                    </div>
                    <p className="flex items-center gap-3 px-3 pt-1 text-micro uppercase tabular-nums text-fg-3">
                        <span>
                            EV <span className={ratingsTag ? undefined : 'text-fg-2'}>{mmss(imp.evToi)}</span>
                        </span>
                        <span>
                            PP <span className={ratingsTag ? undefined : 'text-fg-2'}>{mmss(imp.ppToi)}</span>
                        </span>
                        <span>
                            PK <span className={ratingsTag ? undefined : 'text-fg-2'}>{mmss(imp.pkToi)}</span>
                        </span>
                        {ratingsTag ? (
                            <SeasonTag className="ml-auto">{ratingsTag}</SeasonTag>
                        ) : null}
                    </p>
                </div>
            ) : null}

            <Availability avail={line?.avail ?? ''} total={seasonGames} label={seasonLabel} />
        </article>
    );
}

/** One on-ice rate, coloured by league percentile; prior-season values stay muted. */
function Metric({ label, m, faded, fmt = v => v.toFixed(2) }: { label: string; m?: Pctl; faded?: boolean; fmt?: (v: number) => string }) {
    return (
        <div className="flex items-baseline justify-between gap-1 py-0.5">
            <span className="text-micro text-fg-3">{label}</span>
            <span className={cn('text-caption font-bold tabular-nums', faded && 'font-medium text-fg-3')} style={m && !faded ? { color: pctColor(m.p) } : undefined}>
                {m ? fmt(m.v) : <span className="text-fg-disabled">—</span>}
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
        <div className="px-3 pb-2.5 pt-2">
            <div aria-hidden="true" className="flex gap-px">
                {slots.map((c, i) => (
                    <span
                        key={i}
                        className={cn('h-1 flex-1 rounded-[1px]', c === '1' ? 'bg-fg-1/80' : c === '0' ? 'bg-warn/80' : c === 'o' ? 'bg-brand/60' : 'bg-line')}
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
