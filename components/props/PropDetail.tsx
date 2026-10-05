import * as React from 'react';
import { TeamLogo } from '@/components/views/TeamLogo';
import { cn } from '@/lib/utils';
import { GameLog } from './GameLog';
import {
    american,
    attemptsPer,
    edge,
    extFor,
    fairAmerican,
    lastN,
    mean,
    pct,
    prevRate,
    seasonLabel,
    seasonRate,
    seasonStart,
    shortDate,
    summarize,
    vsLog,
    type Category,
    type GoalieInfo,
    type PlayerDetail,
    type PropPlayer,
    type PropsDoc,
    type Rate,
    type Row,
} from './model';

const fmt = (r: Rate) => (r.n ? `${Math.round((r.hits / r.n) * 100)}%` : '—');
const pctText = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const minutes = (min: number | null) => (min == null ? '—' : min.toFixed(1));
const signed = (v: number, digits = 1) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(digits)}`;

function RateText({ r }: { r: Rate }) {
    const p = pct(r);
    return (
        <span className={cn(p == null ? 'text-fg-disabled' : r.n < 5 ? 'text-fg-3' : p >= 0.6 ? 'text-fg-1' : 'text-fg-2')}>
            {fmt(r)}
            {r.n ? <span className="ml-1 text-micro text-fg-3">{r.n}</span> : null}
        </span>
    );
}

/** A trend triangle, green up / red down when the move clears `min`, dim otherwise. */
function Trend({ delta, min, children }: { delta: number | null; min: number; children: React.ReactNode }) {
    if (delta == null) return null;
    const strong = Math.abs(delta) >= min;
    return (
        <span className={cn('inline-flex items-center gap-1', !strong ? 'text-fg-3' : delta > 0 ? 'text-pos' : 'text-neg')}>
            {strong ? (
                <svg viewBox="0 0 8 8" className="h-2 w-2" aria-hidden="true">
                    <path d={delta > 0 ? 'M4 1.5 7 6H1z' : 'M4 6.5 1 2h6z'} fill="currentColor" />
                </svg>
            ) : null}
            {children}
        </span>
    );
}

function Fact({ label, title, value, sub, loading }: { label: string; title: string; value: React.ReactNode; sub?: React.ReactNode; loading?: boolean }) {
    return (
        <div className="min-w-0" title={title}>
            <dt className="label truncate">{label}</dt>
            <dd className="mt-1 text-base font-bold leading-5 text-fg-1">{loading ? <span className="inline-block h-4 w-10 animate-pulse rounded-chip bg-surface-3" /> : value}</dd>
            {sub ? <dd className="mt-0.5 truncate text-micro text-fg-3">{sub}</dd> : null}
        </div>
    );
}

function Section({ title, aside, children, className }: { title: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
    return (
        <section className={cn('min-w-0', className)}>
            <h3 className="label mb-2 flex items-baseline justify-between gap-3">
                <span className="flex items-center gap-1.5">{title}</span>
                {aside ? <span className="truncate normal-case tracking-normal text-fg-3">{aside}</span> : null}
            </h3>
            {children}
        </section>
    );
}

function Mate({ m, cat, line, tag }: { m: PropPlayer; cat: Category; line: Row['line']; tag: string }) {
    const p1 = m.book?.p1;
    const l10 = lastN(m, cat, cat.lines.find(l => l.key === line.key) ?? cat.lines[0], 10);
    const att = attemptsPer(m, 10).avg;
    return (
        <li className="flex items-center gap-2 border-t border-line py-1.5 first:border-t-0">
            <span className="w-9 shrink-0 text-micro uppercase text-fg-3">{tag}</span>
            <TeamLogo tri={m.team} size={16} />
            <span className="min-w-0 flex-1 truncate text-fg-1">{m.name}</span>
            <span className="w-10 text-right text-micro text-fg-2" title="Shot attempts per game, last 10">
                {att != null ? att.toFixed(1) : '—'}
            </span>
            <span className="w-10 text-right text-micro text-fg-2" title={`${cat.stat} ${line.label}, last 10`}>
                {fmt(l10)}
            </span>
            <span className="w-12 text-right" title="1+ point: book price (pony xG when unposted)">
                {p1?.over != null ? <span className="text-fg-1">{american(p1.over)}</span> : m.fair?.p1 != null ? <span className="text-model">{fairAmerican(m.fair.p1)}</span> : <span className="text-fg-disabled">—</span>}
            </span>
        </li>
    );
}

function GoalieLine({ g }: { g: GoalieInfo | null | undefined }) {
    if (!g) return <span className="text-fg-3">Not posted</span>;
    return (
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <span className="truncate text-fg-1">{g.name}</span>
            {g.status ? <span className={cn('text-micro uppercase', g.status === 'Confirmed' ? 'text-goalie' : 'text-fg-3')}>{g.status}</span> : null}
            {g.gsax != null ? (
                <span className="text-micro text-model" title="pony xG goals saved above expected per game (regressed); positive = a tougher night">
                    GSAx {signed(g.gsax, 2)}/g
                </span>
            ) : null}
        </span>
    );
}

export interface PropDetailProps {
    r: Row;
    cat: Category;
    doc: PropsDoc;
    /** This player's detail; undefined while props_detail.json loads, null when it failed or has no entry. */
    detail: PlayerDetail | null | undefined;
    seasons: { cur: string; prev: string };
}

/**
 * The opened row: deployment and volume facts, the 20-game log with attempts,
 * TOI and xG under every bar, every line in the category, linemates, his record
 * against tonight's opponent and the matchup.
 */
export function PropDetail({ r, cat, doc, detail, seasons }: PropDetailProps) {
    const { p, line } = r;
    const loading = detail === undefined;
    const byId = new Map(doc.players.map(x => [x.id, x]));
    const mates = p.mates.map(id => byId.get(id)).filter((m): m is PropPlayer => !!m);
    const ppMates = p.pp ? doc.players.filter(m => m.team === p.team && m.pp === p.pp && m.id !== p.id && !p.mates.includes(m.id)) : [];
    const game = p.game != null ? doc.games.find(g => g.id === p.game) : null;
    const side = game ? (game.home === p.team ? 'home' : 'away') : null;
    const oppSide = side === 'home' ? 'away' : 'home';
    const opp = p.opp ? doc.teams[p.opp] : null;
    const teamXg = game && side ? game[`${side}_xg`] : null;
    const curStart = seasonStart(doc.slate_date);

    // Volume and deployment, recent vs the 20-game baseline.
    const ext = extFor(p, detail);
    const att5 = attemptsPer(p, 5);
    const att20 = attemptsPer(p, 20);
    const att10 = attemptsPer(p, 10);
    const toi5 = mean(p.log.slice(-5).map(x => x[3]));
    const toi20 = mean(p.log.slice(-20).map(x => x[3]));
    const pp5 = mean(ext.slice(-5).map(x => x?.[4]));
    const pp20 = mean(ext.slice(-20).map(x => x?.[4]));
    const xg10 = mean(ext.slice(-10).map(x => x?.[5]));
    // Finishing: goals against pony xG over the last 20 games the shot scrape covers.
    const scored = p.log.map((x, i) => [x[4], ext[i]?.[5]] as const).slice(-20).filter(([, xg]) => xg != null);
    const g20 = scored.reduce((a, [g]) => a + g, 0);
    const xg20 = scored.reduce((a, [, xg]) => a + (xg ?? 0), 0);
    const xgGames = scored.length;

    // Venue split on tonight's line, both seasons.
    const venue = p.home == null ? null : p.home ? 'h' : 'a';
    const split = (k: 'h' | 'a') => {
        const s = detail?.ha[k];
        return s ? { hits: s[line.key] ?? 0, n: s.n } : { hits: 0, n: 0 };
    };

    // History against tonight's opponent.
    const vs = vsLog(p, detail, curStart);
    const vsSum = summarize(vs, cat, line);
    const allAvg = mean(p.log.map(x => cat.value(x)));

    const rest = game?.rest;
    const ownRest = side && rest ? rest[side] : null;
    const oppRest = side && rest ? rest[oppSide] : null;
    const prevGames = p.log.slice(-20).filter(x => x[8] === 1).length;

    return (
        <div className="flex flex-col gap-6 p-4 md:p-5">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4 xl:grid-cols-8">
                <Fact
                    label="Role"
                    title="Tonight's line and power-play unit (DailyFaceoff)"
                    value={p.unit ? `${p.unit}${p.pp ? ` · PP${p.pp}` : ''}` : p.pp ? `PP${p.pp}` : '—'}
                    sub={p.move === 'up' ? <span className="text-warn">Moved up</span> : p.move === 'down' ? <span className="text-fg-2">Moved down</span> : p.unit ? 'Same line' : 'Not on a posted line'}
                />
                <Fact
                    label="TOI L5"
                    title="Average time on ice, last 5 games, against the last 20"
                    value={minutes(toi5)}
                    sub={toi5 != null && toi20 != null ? <Trend delta={toi5 - toi20} min={1}>{`${signed(toi5 - toi20)} min vs L20`}</Trend> : null}
                />
                <Fact
                    label="PP TOI L5"
                    title="Average power-play time on ice, last 5 games, against the last 20"
                    loading={loading}
                    value={minutes(pp5)}
                    sub={pp5 != null && pp20 != null ? <Trend delta={pp5 - pp20} min={0.5}>{`${signed(pp5 - pp20)} vs L20`}</Trend> : null}
                />
                <Fact
                    label="ATT/G L5"
                    title="Shot attempts per game (on net, missed and blocked), last 5 against the last 20"
                    value={att5.avg != null ? att5.avg.toFixed(1) : '—'}
                    sub={att5.avg != null && att20.avg != null ? <Trend delta={att5.avg - att20.avg} min={0.75}>{`${signed(att5.avg - att20.avg)} vs L20`}</Trend> : null}
                />
                <Fact
                    label="On net L10"
                    title="Share of shot attempts that reached the net, last 10 games"
                    value={pctText(att10.onNet)}
                    sub={att10.avg != null ? `${att10.avg.toFixed(1)} att/g` : null}
                />
                <Fact
                    label="ixG/G L10"
                    title="pony xG of his unblocked attempts per game, last 10"
                    loading={loading}
                    value={xg10 != null ? <span className="text-model">{xg10.toFixed(2)}</span> : '—'}
                    sub={xgGames ? `G ${g20} · xG ${xg20.toFixed(1)} L${xgGames}` : null}
                />
                <Fact
                    label={venue === 'a' ? 'Road' : 'Home'}
                    title={`${cat.stat} ${line.label} at tonight's venue, ${seasons.prev} and ${seasons.cur}`}
                    loading={loading}
                    value={venue ? fmt(split(venue)) : '—'}
                    sub={venue ? `${split(venue).hits}/${split(venue).n} · ${venue === 'a' ? 'home' : 'road'} ${fmt(split(venue === 'a' ? 'h' : 'a'))}` : null}
                />
                <Fact
                    label={p.opp ? `vs ${p.opp}` : 'vs Opp'}
                    title={`${cat.stat} ${line.label} against tonight's opponent, last ${vs.length} meetings`}
                    loading={loading && !!p.opp}
                    value={vsSum.n ? fmt(vsSum) : '—'}
                    sub={vsSum.n ? `${vsSum.hits}/${vsSum.n} · avg ${vsSum.avg?.toFixed(1)}` : p.opp ? 'No meetings' : 'No game tonight'}
                />
            </dl>

            <div className="grid gap-6 xl:grid-cols-[auto_minmax(0,1fr)] xl:gap-8">
                <Section
                    title={
                        <>
                            {cat.stat} log · last {Math.min(20, p.log.length)}
                        </>
                    }
                    aside={
                        <span className="flex items-center gap-3 text-micro">
                            {prevGames ? <span>{prevGames} from {seasons.prev}</span> : null}
                            {cat.key === 'sog' ? (
                                <span className="flex items-center gap-1">
                                    <span className="inline-block h-2.5 w-2 rounded-[1px] border border-line-strong" aria-hidden="true" /> attempts
                                </span>
                            ) : null}
                            {cat.key === 'g' ? (
                                <span className="flex items-center gap-1">
                                    <span className="inline-block h-0.5 w-2.5 bg-model" aria-hidden="true" /> xG
                                </span>
                            ) : null}
                        </span>
                    }
                >
                    <div className="-mx-4 overflow-x-auto px-4 scrollbar-hide md:mx-0 md:px-0">
                        <GameLog log={p.log} ext={ext} cat={cat} line={line} />
                    </div>
                </Section>

                <Section title="Lines">
                    <table className="w-full text-caption tabular-nums">
                        <thead>
                            <tr className="text-micro uppercase text-fg-3">
                                <th scope="col" className="py-1 text-left font-medium">
                                    {cat.stat}
                                </th>
                                <th scope="col" className="py-1 text-right font-medium">
                                    L5
                                </th>
                                <th scope="col" className="py-1 text-right font-medium">
                                    L10
                                </th>
                                <th scope="col" className="hidden py-1 text-right font-medium sm:table-cell">
                                    L20
                                </th>
                                <th scope="col" className="py-1 text-right font-medium">
                                    {seasons.cur}
                                </th>
                                <th scope="col" className="hidden py-1 text-right font-medium sm:table-cell">
                                    {seasons.prev}
                                </th>
                                <th scope="col" className="py-1 text-right font-medium">
                                    Book
                                </th>
                                <th scope="col" className="py-1 text-right font-medium">
                                    Fair
                                </th>
                                <th scope="col" className="py-1 text-right font-medium">
                                    Edge
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {cat.lines.map(l => {
                                const b = p.book?.[l.key];
                                const f = p.fair?.[l.key];
                                const e = edge(p, l);
                                return (
                                    <tr key={l.key} className={cn('border-t border-line', l.key === line.key && 'text-fg-1')}>
                                        <th scope="row" className={cn('py-1.5 text-left font-medium uppercase', l.key === line.key ? 'text-brand' : 'text-fg-2')}>
                                            {l.label}
                                        </th>
                                        <td className="py-1.5 text-right">
                                            <RateText r={lastN(p, cat, l, 5)} />
                                        </td>
                                        <td className="py-1.5 text-right">
                                            <RateText r={lastN(p, cat, l, 10)} />
                                        </td>
                                        <td className="hidden py-1.5 text-right sm:table-cell">
                                            <RateText r={lastN(p, cat, l, 20)} />
                                        </td>
                                        <td className="py-1.5 text-right">
                                            <RateText r={seasonRate(p, l)} />
                                        </td>
                                        <td className="hidden py-1.5 text-right sm:table-cell">
                                            <RateText r={prevRate(p, l)} />
                                        </td>
                                        <td className="py-1.5 text-right text-fg-1">{b ? american(b.over) : <span className="text-fg-disabled">—</span>}</td>
                                        <td className="py-1.5 text-right text-model" title={f != null ? `${Math.round(f * 100)}%` : undefined}>
                                            {fairAmerican(f)}
                                        </td>
                                        <td className={cn('py-1.5 text-right', e == null ? 'text-fg-disabled' : e > 0 ? 'text-pos' : 'text-neg')}>
                                            {e == null ? '—' : `${e > 0 ? '+' : ''}${(e * 100).toFixed(1)}`}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </Section>
            </div>

            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3 xl:gap-8">
                <Section title={p.unit ? `${p.unit} line` : 'Linemates'} aside={<span className="text-micro uppercase">Att/g · L10 · 1+ pts</span>}>
                    {mates.length || ppMates.length ? (
                        <ul className="text-caption tabular-nums">
                            {mates.map(m => (
                                <Mate key={m.id} m={m} cat={cat} line={line} tag={p.unit ?? ''} />
                            ))}
                            {ppMates.map(m => (
                                <Mate key={m.id} m={m} cat={cat} line={line} tag={`PP${p.pp}`} />
                            ))}
                        </ul>
                    ) : (
                        <p className="text-caption text-fg-3">Not on a posted line</p>
                    )}
                </Section>

                <Section
                    title={
                        p.opp ? (
                            <>
                                vs <TeamLogo tri={p.opp} size={16} /> {p.opp}
                            </>
                        ) : (
                            'vs Opp'
                        )
                    }
                    aside={
                        vsSum.n ? (
                            <span className="text-micro">
                                avg {vsSum.avg?.toFixed(1)} vs {allAvg?.toFixed(1)} L20
                                {detail?.vs_n && detail.vs_n > vs.length ? ` · last ${vs.length} of ${detail.vs_n}` : ''}
                            </span>
                        ) : null
                    }
                >
                    {!p.opp ? (
                        <p className="text-caption text-fg-3">No game tonight</p>
                    ) : loading ? (
                        <div className="h-24 animate-pulse rounded-control bg-surface-3/60" />
                    ) : !vs.length ? (
                        <p className="text-caption text-fg-3">No meetings on record</p>
                    ) : (
                        <table className="w-full text-caption tabular-nums">
                            <thead>
                                <tr className="text-micro uppercase text-fg-3">
                                    <th scope="col" className="py-1 text-left font-medium">
                                        Date
                                    </th>
                                    <th scope="col" className="py-1 text-right font-medium">
                                        {cat.stat}
                                    </th>
                                    <th scope="col" className="py-1 text-right font-medium">
                                        G-A
                                    </th>
                                    {cat.key !== 'sog' ? (
                                        <th scope="col" className="py-1 text-right font-medium">
                                            SOG
                                        </th>
                                    ) : null}
                                    <th scope="col" className="py-1 text-right font-medium">
                                        Att
                                    </th>
                                    <th scope="col" className="py-1 text-right font-medium">
                                        TOI
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {[...vs].reverse().map(g => {
                                    const v = cat.value(g);
                                    const hit = v >= line.k;
                                    return (
                                        <tr key={g[0]} className={cn('border-t border-line', g[8] === 1 && 'text-fg-2')}>
                                            <th scope="row" className="py-1 text-left font-normal">
                                                <span className={g[8] === 1 ? 'text-fg-2' : 'text-fg-1'}>{shortDate(g[0])}</span>
                                                <span className="ml-1.5 text-micro text-fg-3">
                                                    {seasonLabel(g[0])} {g[2] ? 'H' : 'A'}
                                                </span>
                                            </th>
                                            <td className={cn('py-1 text-right font-semibold', hit ? 'text-brand' : 'text-fg-2')}>{v}</td>
                                            <td className="py-1 text-right text-fg-2">
                                                {g[4]}-{g[5]}
                                            </td>
                                            {cat.key !== 'sog' ? <td className="py-1 text-right text-fg-2">{g[6]}</td> : null}
                                            <td className="py-1 text-right text-fg-2">{g[9] ?? '—'}</td>
                                            <td className="py-1 text-right text-fg-3">{minutes(g[3])}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </Section>

                <Section title="Matchup" className="md:col-span-2 xl:col-span-1">
                    {game && p.opp ? (
                        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-caption">
                            <dt className="label pt-0.5">{p.opp} allow</dt>
                            <dd className="flex flex-wrap items-baseline gap-x-3 text-fg-1">
                                {opp ? (
                                    <>
                                        <span>
                                            {opp.sa.toFixed(1)} SOG <span className={cn('text-micro', opp.sa_rank <= 8 ? 'font-semibold text-warn' : 'text-fg-3')}>#{opp.sa_rank}</span>
                                        </span>
                                        <span>
                                            {opp.ga.toFixed(2)} GA <span className={cn('text-micro', opp.ga_rank <= 8 ? 'font-semibold text-warn' : 'text-fg-3')}>#{opp.ga_rank}</span>
                                        </span>
                                    </>
                                ) : (
                                    '—'
                                )}
                            </dd>
                            <dt className="label pt-0.5">Goalie</dt>
                            <dd className="min-w-0">
                                <GoalieLine g={game.goalies?.[oppSide]} />
                            </dd>
                            <dt className="label pt-0.5">Team xG</dt>
                            <dd className="flex items-baseline gap-3">
                                <span className="text-model">{teamXg != null ? teamXg.toFixed(2) : '—'}</span>
                                {game.total ? <span className="text-micro text-fg-3">Total {game.total}</span> : null}
                            </dd>
                            <dt className="label pt-0.5">Rest</dt>
                            <dd className="flex flex-wrap items-baseline gap-x-3 text-fg-2">
                                <RestDays team={p.team} days={ownRest} />
                                <RestDays team={p.opp} days={oppRest} />
                            </dd>
                        </dl>
                    ) : (
                        <p className="text-caption text-fg-3">No game tonight</p>
                    )}
                </Section>
            </div>
            {detail === null ? <p className="text-micro text-fg-3">Game detail unavailable. Try again after the next hourly update.</p> : null}
        </div>
    );
}

function RestDays({ team, days }: { team: string; days: number | null | undefined }) {
    if (days == null) return null;
    return (
        <span>
            {team} {days === 1 ? <span className="font-semibold text-warn">B2B</span> : <span className="text-fg-1">{days - 1}d off</span>}
        </span>
    );
}

export default PropDetail;
