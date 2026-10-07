'use client';

import * as React from 'react';
import { GameProvider } from '@/components/game/GameContext';
import { GameScore } from '@/components/game/GameScore';
import { Goalies } from '@/components/game/Goalies';
import { Lines } from '@/components/game/Lines';
import { Shots } from '@/components/game/Shots';
import { Skaters } from '@/components/game/Skaters';
import { TeamStats } from '@/components/game/TeamStats';
import { Units } from '@/components/game/Units';
import { XgBreakdown } from '@/components/game/XgBreakdown';
import { Zones } from '@/components/game/Zones';
import { cn } from '@/lib/utils';
import { mergeSeason } from '@/lib/game/season';
import type { GameModel } from '@/lib/game/types';
import { ALL_TEAMS, conferenceOf, DIVISIONS, divisionOf } from '@/lib/pony/teams';

/**
 * The game page's views over a stretch of a team's season: every game is
 * fetched once (/api/game-pack/[id], cached at the edge), the picked games
 * are merged into one model (lib/game/season.ts) and the same sections the
 * game page uses draw it. Filters: dates, game-number range, venue, result,
 * opponent (team, division, conference), last N.
 */

export interface SeasonGame {
    id: number;
    num: number;
    date: string;
    opp: string;
    home: boolean;
    gf: number;
    ga: number;
    result: 'W' | 'L' | 'OTL';
}

const SELECT =
    'h-8 min-w-0 rounded-control border border-line bg-surface-1 px-2 text-caption uppercase tracking-wide text-fg-1 hover:border-line-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand coarse:h-11 max-md:text-base max-md:normal-case max-md:tracking-normal';

const packs = new Map<number, Promise<GameModel | null>>();
function pack(id: number) {
    if (!packs.has(id)) {
        packs.set(
            id,
            fetch(`/api/game-pack/${id}`)
                .then(r => (r.ok ? (r.json() as Promise<GameModel>) : null))
                .catch(() => null),
        );
    }
    return packs.get(id)!;
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
    return (
        <label className={cn('flex min-w-0 flex-col gap-1', className)}>
            <span className="text-micro uppercase tracking-label text-fg-3">{label}</span>
            {children}
        </label>
    );
}

interface Filters {
    from: string;
    to: string;
    lo: number;
    hi: number;
    venue: 'all' | 'home' | 'road';
    result: 'all' | 'W' | 'L' | 'OTL';
    vs: string;
    last: number;
}

export function TeamBreakdown({ tri, games }: { tri: string; games: SeasonGame[] }) {
    const n = games.length;
    const init: Filters = { from: '', to: '', lo: 1, hi: n, venue: 'all', result: 'all', vs: 'all', last: 0 };
    const [f, setF] = React.useState<Filters>(init);
    const [models, setModels] = React.useState<Map<number, GameModel>>(new Map());
    const [failed, setFailed] = React.useState(0);
    const set = (patch: Partial<Filters>) => setF(x => ({ ...x, ...patch }));

    React.useEffect(() => setF({ from: '', to: '', lo: 1, hi: n, venue: 'all', result: 'all', vs: 'all', last: 0 }), [n, tri]);

    // Load every game of the season once, six at a time.
    React.useEffect(() => {
        let live = true;
        const queue = [...games];
        let bad = 0;
        const worker = async () => {
            for (let g = queue.shift(); g; g = queue.shift()) {
                const m = await pack(g.id);
                if (!live) return;
                if (m) setModels(prev => (prev.has(g!.id) ? prev : new Map(prev).set(g!.id, m)));
                else setFailed(++bad);
            }
        };
        void Promise.all(Array.from({ length: 6 }, worker));
        return () => {
            live = false;
        };
    }, [games]);

    const picked = React.useMemo(() => {
        let list = games.filter(g => {
            if (g.num < f.lo || g.num > f.hi) return false;
            if (f.from && g.date < f.from) return false;
            if (f.to && g.date > f.to) return false;
            if (f.venue === 'home' && !g.home) return false;
            if (f.venue === 'road' && g.home) return false;
            if (f.result !== 'all' && g.result !== f.result) return false;
            if (f.vs.startsWith('div:') && divisionOf(g.opp) !== f.vs.slice(4)) return false;
            if (f.vs.startsWith('conf:') && conferenceOf(g.opp) !== f.vs.slice(5)) return false;
            if (/^[A-Z]{3}$/.test(f.vs) && g.opp !== f.vs) return false;
            return true;
        });
        if (f.last) list = list.slice(-f.last);
        return list;
    }, [games, f]);

    const ready = picked.filter(g => models.has(g.id));
    const loading = models.size + failed < games.length;
    const merged = React.useMemo(() => {
        if (!ready.length || ready.length < picked.length - failed) return null;
        return mergeSeason(ready.map(g => models.get(g.id)!), tri);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready.length, picked, models.size, tri]);

    const rec = picked.reduce((a, g) => ({ ...a, [g.result]: a[g.result] + 1 }), { W: 0, L: 0, OTL: 0 } as Record<SeasonGame['result'], number>);
    const gf = picked.reduce((a, g) => a + g.gf, 0);
    const ga = picked.reduce((a, g) => a + g.ga, 0);
    const opps = [...new Set(games.map(g => g.opp))].sort();
    const dirty = JSON.stringify(f) !== JSON.stringify(init);

    if (!n) return <p className="panel p-card text-caption text-fg-3">No games yet this season.</p>;

    return (
        <div className="flex flex-col gap-8">
            <div className="panel z-20 flex flex-col gap-3 p-card lg:sticky lg:top-[calc(var(--appbar-h)+var(--vv-top,0px)+8px)] lg:shadow-[0_12px_32px_rgb(0_0_0/0.45)]">
                <div className="grid grid-cols-6 gap-x-2 gap-y-2 sm:grid-cols-4 sm:gap-x-3 lg:grid-cols-8">
                    <Field label="Games" className="max-sm:col-span-4">
                        <span className="flex items-center gap-1.5">
                            <select className={cn(SELECT, 'w-full')} value={f.lo} onChange={e => set({ lo: Number(e.target.value), hi: Math.max(f.hi, Number(e.target.value)) })} aria-label="From game">
                                {games.map(g => (
                                    <option key={g.id} value={g.num}>
                                        #{g.num}
                                    </option>
                                ))}
                            </select>
                            <span className="text-fg-3">–</span>
                            <select className={cn(SELECT, 'w-full')} value={f.hi} onChange={e => set({ hi: Number(e.target.value), lo: Math.min(f.lo, Number(e.target.value)) })} aria-label="To game">
                                {games.map(g => (
                                    <option key={g.id} value={g.num}>
                                        #{g.num}
                                    </option>
                                ))}
                            </select>
                        </span>
                    </Field>
                    <Field label="Last" className="max-sm:col-span-2">
                        <select className={SELECT} value={f.last} onChange={e => set({ last: Number(e.target.value) })}>
                            <option value={0}>All</option>
                            {[5, 10, 20, 40].filter(k => k < n).map(k => (
                                <option key={k} value={k}>
                                    Last {k}
                                </option>
                            ))}
                        </select>
                    </Field>
                    <Field label="Venue" className="max-sm:col-span-2">
                        <select className={SELECT} value={f.venue} onChange={e => set({ venue: e.target.value as Filters['venue'] })}>
                            <option value="all">All</option>
                            <option value="home">Home</option>
                            <option value="road">Road</option>
                        </select>
                    </Field>
                    <Field label="Result" className="max-sm:col-span-2">
                        <select className={SELECT} value={f.result} onChange={e => set({ result: e.target.value as Filters['result'] })}>
                            <option value="all">All</option>
                            <option value="W">Wins</option>
                            <option value="L">Losses</option>
                            <option value="OTL">OT / SO losses</option>
                        </select>
                    </Field>
                    <Field label="Versus" className="max-sm:col-span-2">
                        <select className={SELECT} value={f.vs} onChange={e => set({ vs: e.target.value })}>
                            <option value="all">Anyone</option>
                            <optgroup label="Conference">
                                <option value="conf:East">East</option>
                                <option value="conf:West">West</option>
                            </optgroup>
                            <optgroup label="Division">
                                {Object.keys(DIVISIONS).map(d => (
                                    <option key={d} value={`div:${d}`}>
                                        {d}
                                    </option>
                                ))}
                            </optgroup>
                            <optgroup label="Team">
                                {ALL_TEAMS.filter(t => opps.includes(t)).map(t => (
                                    <option key={t} value={t}>
                                        {t}
                                    </option>
                                ))}
                            </optgroup>
                        </select>
                    </Field>
                    <Field label="From" className="max-sm:col-span-3">
                        <input type="date" className={cn(SELECT, 'normal-case')} value={f.from} min={games[0]?.date} max={games[n - 1]?.date} onChange={e => set({ from: e.target.value })} />
                    </Field>
                    <Field label="To" className="max-sm:col-span-3">
                        <input type="date" className={cn(SELECT, 'normal-case')} value={f.to} min={games[0]?.date} max={games[n - 1]?.date} onChange={e => set({ to: e.target.value })} />
                    </Field>
                    <div className="flex items-end max-sm:col-span-6 max-sm:empty:hidden">
                        {dirty ? (
                            <button type="button" onClick={() => setF(init)} className="h-8 rounded-control px-2.5 text-micro uppercase tracking-label text-fg-3 hover:text-fg-1 coarse:h-11">
                                Clear filters
                            </button>
                        ) : null}
                    </div>
                </div>
                <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption tabular-nums">
                    <span className="font-semibold text-fg-1">
                        {picked.length} {picked.length === 1 ? 'game' : 'games'}
                    </span>
                    <span className="text-fg-2">
                        {rec.W}-{rec.L}-{rec.OTL}
                    </span>
                    <span className="text-fg-2">
                        GF {gf} · GA {ga}
                    </span>
                    {picked.length ? (
                        <span className="text-micro uppercase tracking-label text-fg-3">
                            #{picked[0].num} {picked[0].date} → #{picked[picked.length - 1].num} {picked[picked.length - 1].date}
                        </span>
                    ) : null}
                    {loading ? (
                        <span className="ml-auto flex items-center gap-2 text-micro uppercase tracking-label text-fg-3" aria-live="polite">
                            <span className="h-1 w-24 overflow-hidden rounded-full bg-track">
                                <span className="block h-full bg-brand transition-[width]" style={{ width: `${((models.size + failed) / n) * 100}%` }} />
                            </span>
                            Loading games {models.size + failed}/{n}
                        </span>
                    ) : null}
                </p>
            </div>

            {merged ? (
                <GameProvider key={`${tri}-${picked.map(g => g.id).join(',')}`} m={merged}>
                    <TeamStats />
                    <Skaters />
                    <GameScore />
                    <Units />
                    <Goalies />
                    <Lines />
                    <Zones />
                    <Shots />
                    <XgBreakdown />
                </GameProvider>
            ) : picked.length ? (
                <div className="panel flex h-64 items-center justify-center text-caption text-fg-3">Putting {picked.length} games together…</div>
            ) : (
                <p className="panel p-card text-caption text-fg-3">No games match these filters.</p>
            )}
        </div>
    );
}
