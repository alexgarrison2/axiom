import * as React from 'react';
import { TeamLogo } from '@/components/views/TeamLogo';
import { cn } from '@/lib/utils';
import { HitTape } from './HitTape';
import { american, edge, fairAmerican, lastN, pct, prevRate, seasonRate, type Category, type PropPlayer, type PropsDoc, type Rate, type Row } from './model';

const fmt = (r: Rate) => (r.n ? `${Math.round((r.hits / r.n) * 100)}%` : '—');

function RateText({ r }: { r: Rate }) {
    const p = pct(r);
    return (
        <span className={cn(p == null ? 'text-fg-disabled' : r.n < 5 ? 'text-fg-3' : p >= 0.6 ? 'text-fg-1' : 'text-fg-2')}>
            {fmt(r)}
            {r.n ? <span className="ml-1 text-micro text-fg-3">{r.n}</span> : null}
        </span>
    );
}

function Mate({ m, cat, line, tag }: { m: PropPlayer; cat: Category; line: Row['line']; tag: string }) {
    const p1 = m.book?.p1;
    const l10 = lastN(m, cat, cat.lines.find(l => l.key === line.key) ?? cat.lines[0], 10);
    return (
        <li className="flex items-center gap-2 py-1">
            <span className="w-9 shrink-0 text-micro uppercase text-fg-3">{tag}</span>
            <span className="min-w-0 flex-1 truncate text-fg-1">{m.name}</span>
            <span className="w-14 text-right text-micro text-fg-3" title={`${cat.stat} ${line.label}, last 10`}>
                {fmt(l10)}
            </span>
            <span className="w-16 text-right" title="1+ point: book price (pony xG when unposted)">
                {p1?.over != null ? <span className="text-fg-1">{american(p1.over)}</span> : m.fair?.p1 != null ? <span className="text-model">{fairAmerican(m.fair.p1)}</span> : <span className="text-fg-disabled">—</span>}
            </span>
        </li>
    );
}

/** The opened row: a labelled 20-game tape, every line in the category, linemates and matchup. */
export function PropDetail({ r, cat, doc, seasons }: { r: Row; cat: Category; doc: PropsDoc; seasons: { cur: string; prev: string } }) {
    const { p, line } = r;
    const byId = new Map(doc.players.map(x => [x.id, x]));
    const mates = p.mates.map(id => byId.get(id)).filter((m): m is PropPlayer => !!m);
    const ppMates = p.pp ? doc.players.filter(m => m.team === p.team && m.pp === p.pp && m.id !== p.id && !p.mates.includes(m.id)) : [];
    const opp = p.opp ? doc.teams[p.opp] : null;
    const game = p.game != null ? doc.games.find(g => g.id === p.game) : null;
    const teamXg = game ? (game.home === p.team ? game.home_xg : game.away_xg) : null;
    const prevGames = p.log.slice(-20).filter(x => x[8] === 1).length;

    return (
        <div className="grid gap-5 p-4 md:grid-cols-[auto_minmax(0,1fr)_minmax(0,18rem)] md:gap-8 md:p-5">
            <div className="min-w-0">
                <p className="label mb-2 flex items-center gap-2">
                    {cat.stat} · last {Math.min(20, p.log.length)}
                    {prevGames ? <span className="text-fg-3">· {prevGames} from {seasons.prev}</span> : null}
                </p>
                <div className="overflow-x-auto scrollbar-hide">
                    <HitTape log={p.log} cat={cat} line={line} size="detail" />
                </div>
            </div>

            <div className="min-w-0">
                <table className="w-full text-caption tabular-nums">
                    <caption className="label mb-2 text-left">Lines</caption>
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
                            <th scope="col" className="py-1 text-right font-medium">
                                L20
                            </th>
                            <th scope="col" className="py-1 text-right font-medium">
                                {seasons.cur}
                            </th>
                            <th scope="col" className="py-1 text-right font-medium">
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
                                    <td className="py-1.5 text-right">
                                        <RateText r={lastN(p, cat, l, 20)} />
                                    </td>
                                    <td className="py-1.5 text-right">
                                        <RateText r={seasonRate(p, l)} />
                                    </td>
                                    <td className="py-1.5 text-right">
                                        <RateText r={prevRate(p, l)} />
                                    </td>
                                    <td className="py-1.5 text-right text-fg-1">{b ? american(b.over) : <span className="text-fg-disabled">—</span>}</td>
                                    <td className="py-1.5 text-right text-model">{f != null ? `${Math.round(f * 100)}%` : '—'}</td>
                                    <td className={cn('py-1.5 text-right', e == null ? 'text-fg-disabled' : e > 0 ? 'text-pos' : 'text-neg')}>
                                        {e == null ? '—' : `${e > 0 ? '+' : ''}${(e * 100).toFixed(1)}`}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                {p.opp ? (
                    <dl className="mt-4 grid grid-cols-3 gap-3 text-caption">
                        <div>
                            <dt className="label">Opp</dt>
                            <dd className="mt-1 flex items-center gap-1.5 text-fg-1">
                                <TeamLogo tri={p.opp} size={18} />
                                {p.home ? 'vs' : '@'} {p.opp}
                            </dd>
                        </div>
                        {opp ? (
                            <div>
                                <dt className="label">{cat.oppRank === 'sa_rank' ? 'SOG allowed' : 'GA / game'}</dt>
                                <dd className="mt-1 text-fg-1">
                                    {cat.oppRank === 'sa_rank' ? opp.sa.toFixed(1) : opp.ga.toFixed(2)} <span className="text-micro text-fg-3">#{opp[cat.oppRank]}</span>
                                </dd>
                            </div>
                        ) : null}
                        <div>
                            <dt className="label">Team xG</dt>
                            <dd className="mt-1 text-model">{teamXg != null ? teamXg.toFixed(2) : '—'}</dd>
                        </div>
                    </dl>
                ) : null}
            </div>

            <div className="min-w-0">
                <p className="label mb-1 flex justify-between">
                    <span>Linemates</span>
                    <span className="text-fg-3">
                        L10 · 1+ PTS
                    </span>
                </p>
                {mates.length || ppMates.length ? (
                    <ul className="text-caption">
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
            </div>
        </div>
    );
}

export default PropDetail;
