'use client';

import * as React from 'react';
import Link from 'next/link';
import { teamPalette } from '@/components/ui/team-color';
import { cn } from '@/lib/utils';
import type { GsPart } from '@/lib/game/analytics';
import { ORDER, PARTS, signed, stack } from '@/lib/pony/parts';

/**
 * The night in Pony Scores under a slate: the five best and five toughest
 * skaters of the finished games (10+ minutes) and the best goalie, each linked
 * to his page and to the game. Reads public/data/pony/<season>_days.json.
 */

type Player = [string, string, string, number | null, string | null, string];
interface DaysDoc {
    players: Record<string, Player>;
    days: Record<string, { top: (string | number)[][]; bottom: (string | number)[][]; goalie: (string | number)[] | null }>;
}

const seasonOf = (date: string) => {
    const y = Number(date.slice(0, 4));
    const start = Number(date.slice(5, 7)) >= 7 ? y : y - 1;
    return `${start}${start + 1}`;
};

const docs = new Map<string, Promise<DaysDoc | null>>();
function load(season: string) {
    if (!docs.has(season)) {
        docs.set(
            season,
            fetch(`/data/pony/${season}_days.json`)
                .then(r => (r.ok ? (r.json() as Promise<DaysDoc>) : null))
                .catch(() => null),
        );
    }
    return docs.get(season)!;
}

function Row({ r, rank, players, reach }: { r: (string | number)[]; rank: number; players: Record<string, Player>; reach: number }) {
    const [game, id, team, opp, ps] = r as [number, number, string, string, number];
    const parts = Object.fromEntries(ORDER.map((k, i) => [k, Number(r[5 + i])])) as Record<GsPart, number>;
    const p = players[String(id)];
    const x = (v: number) => 50 + (v / reach) * 48;
    return (
        // Phone-width panels give the name the room: a shorter bar (same scale, same parts) and tighter gaps.
        <li className="grid grid-cols-[1rem_2rem_minmax(0,1fr)_2.5rem_3.25rem] items-center gap-x-2 py-1.5 [@container(min-width:18rem)]:grid-cols-[1.25rem_2.25rem_minmax(0,1fr)_3.5rem_3.5rem] [@container(min-width:26rem)]:grid-cols-[1.25rem_2.25rem_minmax(0,1fr)_5.5rem_3.5rem] [@container(min-width:26rem)]:gap-x-2.5">
            <span className="text-right text-micro tabular-nums text-fg-3">{rank}</span>
            <span className="block h-8 w-8 overflow-hidden rounded-full border-2 bg-surface-2 [@container(min-width:18rem)]:h-9 [@container(min-width:18rem)]:w-9" style={{ borderColor: teamPalette(team).primary }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- NHL headshot */}
                {p?.[4] ? <img src={p[4]} alt="" width={36} height={36} loading="lazy" className="headshot h-full w-full" /> : null}
            </span>
            <span className="min-w-0 leading-tight">
                {/* Touch: the name's target also covers the headshot and the row's top padding; the game line keeps its own. */}
                <Link
                    href={`/players/${id}`}
                    className="block font-bold text-fg-1 underline-offset-4 hover:text-brand hover:underline coarse:relative coarse:after:absolute coarse:after:-left-10 coarse:after:-top-1.5 coarse:after:bottom-0 coarse:after:right-0 coarse:after:content-['']"
                >
                    <span className="block truncate">{p ? `${p[0].charAt(0)}. ${p[1]}` : id}</span>
                </Link>
                <Link
                    href={`/games/${game}`}
                    className="flex items-center gap-1 whitespace-nowrap text-micro text-fg-3 hover:text-fg-1 coarse:relative coarse:after:absolute coarse:after:-bottom-1.5 coarse:after:left-0 coarse:after:right-0 coarse:after:top-0 coarse:after:content-['']"
                >
                    {/* eslint-disable-next-line @next/next/no-img-element -- team logo */}
                    <img src={`/logos/${team}.svg`} alt="" width={14} height={14} className="h-3.5 w-3.5" />
                    {team} vs {opp}
                </Link>
            </span>
            <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="block h-2.5 w-full" aria-hidden="true">
                <rect x={0} y={0} width={100} height={10} fill="var(--track)" />
                {stack(parts, x).map(s => (
                    <rect key={s.k} x={s.x} y={1} width={Math.max(0, s.w - 0.5)} height={8} fill={PARTS[s.k].color} />
                ))}
                <line x1={50} x2={50} y1={0} y2={10} className="stroke-fg-3" vectorEffect="non-scaling-stroke" />
            </svg>
            <span className={cn('text-right font-display text-body font-bold tabular-nums', ps < 0 ? 'text-fg-2' : 'text-fg-1')}>{signed(ps)}</span>
        </li>
    );
}

export function PonyNight({ date }: { date: string }) {
    const [doc, setDoc] = React.useState<DaysDoc | null>(null);
    React.useEffect(() => {
        let live = true;
        load(seasonOf(date)).then(d => live && setDoc(d));
        return () => {
            live = false;
        };
    }, [date]);
    const day = doc?.days[date];
    if (!doc || !day || (!day.top.length && !day.goalie)) return null;
    let reach = 1;
    for (const r of [...day.top, ...day.bottom]) {
        let pos = 0;
        let neg = 0;
        for (let i = 5; i < 13; i++) {
            const v = Number(r[i]);
            if (v > 0) pos += v;
            else neg -= v;
        }
        reach = Math.max(reach, pos, neg);
    }
    const g = day.goalie;
    const gp = g ? doc.players[String(g[1])] : null;
    return (
        <section aria-labelledby="pony-night-h" className="mt-6 flex flex-col gap-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <h2 id="pony-night-h" className="heading-section">
                    Pony score
                </h2>
                <Link href={`/players/pony?from=${date}&to=${date}&season=${seasonOf(date)}`} className="text-micro uppercase tracking-label text-fg-3 underline-offset-4 hover:text-fg-1 hover:underline coarse:relative coarse:after:absolute coarse:after:-inset-x-2 coarse:after:-inset-y-3.5 coarse:after:content-['']">
                    Full night
                </Link>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
                {[
                    ['Top', day.top],
                    ['Bottom', day.bottom],
                ].map(([title, list]) => (
                    <div key={title as string} className="panel px-card py-3 [container-type:inline-size]">
                        <p className="label mb-1">{title as string}</p>
                        <ol className="divide-y divide-line/60">
                            {(list as (string | number)[][]).map((r, i) => (
                                <Row key={`${r[0]}-${r[1]}`} r={r} rank={i + 1} players={doc.players} reach={reach} />
                            ))}
                        </ol>
                    </div>
                ))}
            </div>
            {g && gp ? (
                <p className="panel flex flex-wrap items-center gap-x-3 gap-y-1 px-card py-2.5 text-caption">
                    <span className="label">Goalie</span>
                    <Link href={`/players/${g[1]}`} className="font-bold text-goalie underline-offset-4 hover:underline coarse:relative coarse:after:absolute coarse:after:-inset-y-2.5 coarse:after:inset-x-0 coarse:after:content-['']">
                        {gp[0]} {gp[1]}
                    </Link>
                    <Link href={`/games/${g[0]}`} className="text-fg-3 hover:text-fg-1 coarse:relative coarse:after:absolute coarse:after:-inset-y-2.5 coarse:after:inset-x-0 coarse:after:content-['']">
                        {g[2]} vs {g[3]} · {Number(g[5]) - Number(g[6])} saves on {g[5]}
                    </Link>
                    <span className="ml-auto font-display text-body font-bold tabular-nums text-fg-1">
                        {signed(Number(g[4]))} <span className="text-micro font-normal uppercase tracking-label text-fg-3">GSAx</span>
                    </span>
                </p>
            ) : null}
        </section>
    );
}
