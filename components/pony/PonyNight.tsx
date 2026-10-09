'use client';

import * as React from 'react';
import Link from 'next/link';
import { NightRow, reachOf, type NightEntry } from '@/components/pony/NightRow';
import type { GsPart } from '@/lib/game/analytics';
import { ORDER, signed } from '@/lib/pony/parts';
import { useDataEpoch } from '@/lib/fresh';

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
/** A season's nights, fetched once per data epoch (a stale tab coming back fetches again). */
function load(season: string, epoch: number) {
    const k = `${season}@${epoch}`;
    if (!docs.has(k)) {
        docs.set(
            k,
            fetch(`/data/pony/${season}_days.json`, epoch ? { cache: 'no-cache' } : undefined)
                .then(r => (r.ok ? (r.json() as Promise<DaysDoc>) : null))
                .catch(() => null),
        );
    }
    return docs.get(k)!;
}

/** A stored row (skater_cols: game, player, team, opp, ps, then the parts) as a list entry. */
function entry(r: (string | number)[], players: Record<string, Player>): NightEntry {
    const [game, id, team, opp, ps] = r as [number, number, string, string, number];
    const p = players[String(id)];
    return {
        game,
        player: id,
        name: p ? `${p[0].charAt(0)}. ${p[1]}` : String(id),
        headshot: p?.[4] ?? null,
        team,
        opp,
        ps,
        parts: Object.fromEntries(ORDER.map((k, i) => [k, Number(r[5 + i])])) as Record<GsPart, number>,
    };
}

export function PonyNight({ date }: { date: string }) {
    const [doc, setDoc] = React.useState<DaysDoc | null>(null);
    const epoch = useDataEpoch();
    React.useEffect(() => {
        let live = true;
        load(seasonOf(date), epoch).then(d => live && setDoc(d));
        return () => {
            live = false;
        };
    }, [date, epoch]);
    const day = doc?.days[date];
    if (!doc || !day || (!day.top.length && !day.goalie)) return null;
    const lists = [
        ['Top', day.top.map(r => entry(r, doc.players))],
        ['Bottom', day.bottom.map(r => entry(r, doc.players))],
    ] as const;
    const reach = reachOf([...lists[0][1], ...lists[1][1]]);
    const g = day.goalie;
    const gp = g ? doc.players[String(g[1])] : null;
    return (
        <section aria-labelledby="pony-night-h" className="mt-6 flex flex-col gap-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <h2 id="pony-night-h" className="heading-section">
                    Pony score
                </h2>
                <Link href={`/players/pony?from=${date}&to=${date}&season=${seasonOf(date)}`} className="text-micro uppercase tracking-label text-fg-3 underline-offset-4 hover:text-fg-1 hover:underline coarse:-my-3.5 coarse:inline-flex coarse:min-h-11 coarse:items-center">
                    Full night
                </Link>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
                {lists.map(([title, list]) => (
                    <div key={title} className="panel px-card py-3 [container-type:inline-size]">
                        <p className="label mb-1">{title}</p>
                        <ol className="divide-y divide-line/60">
                            {list.map((r, i) => (
                                <NightRow key={`${r.game}-${r.player}`} r={r} rank={i + 1} reach={reach} />
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
