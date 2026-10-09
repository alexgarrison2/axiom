import Link from 'next/link';
import { teamPalette } from '@/components/ui/team-color';
import { cn } from '@/lib/utils';
import type { GsPart } from '@/lib/game/analytics';
import { ORDER, PARTS, signed, stack } from '@/lib/pony/parts';

/**
 * One player's game in a nightly list (the Pony night under a slate and the
 * Nights view of the leaderboard): rank, face, name over the game line, the
 * score's parts as one signed stack (a single GSAx bar for a goalie) and the
 * score. Rows of one list share `reach` so their bars compare.
 */

export interface NightEntry {
    game: number;
    player: number;
    /** "C. McDavid" */
    name: string;
    headshot: string | null;
    team: string;
    opp: string;
    ps: number;
    /** Skaters; null for a goalie (GSAx only). */
    parts: Record<GsPart, number> | null;
    /** Added to the game line when the list spans several nights ("Oct 8"). */
    when?: string;
    /** Added to the game line ("36 saves on 37"). */
    note?: string;
}

/** How far the stacks reach each side of zero, so a list shares one scale and spends the bar's width on what is there. */
export interface Reach {
    neg: number;
    pos: number;
}

export function reachOf(rows: NightEntry[]): Reach {
    let neg = 0.25;
    let pos = 0.25;
    for (const r of rows) {
        let p = Math.max(0, r.ps);
        let n = Math.max(0, -r.ps);
        if (r.parts) {
            p = 0;
            n = 0;
            for (const k of ORDER) {
                const v = r.parts[k];
                if (v > 0) p += v;
                else n -= v;
            }
        }
        pos = Math.max(pos, p);
        neg = Math.max(neg, n);
    }
    return { neg, pos };
}

export function NightRow({ r, rank, reach }: { r: NightEntry; rank: number; reach: Reach }) {
    const x = (v: number) => 1 + ((v + reach.neg) / (reach.neg + reach.pos)) * 98;
    return (
        // Phone-width panels give the name the room: a shorter bar (same scale, same parts) and tighter gaps.
        // Wider panels cap the name column and hand the rest to the bar.
        <li className="grid grid-cols-[1rem_2rem_minmax(0,1fr)_2.5rem_3.25rem] items-center gap-x-2 py-1.5 coarse:relative [@container(min-width:18rem)]:grid-cols-[1.25rem_2.25rem_minmax(0,1fr)_3.5rem_3.5rem] [@container(min-width:26rem)]:grid-cols-[1.25rem_2.25rem_minmax(7rem,1fr)_minmax(5.5rem,2fr)_3.5rem] [@container(min-width:26rem)]:gap-x-3">
            <span className="text-right text-micro tabular-nums text-fg-3">{rank}</span>
            <span className="block h-8 w-8 overflow-hidden rounded-full border-2 bg-surface-2 [@container(min-width:18rem)]:h-9 [@container(min-width:18rem)]:w-9" style={{ borderColor: teamPalette(r.team).primary }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- NHL headshot */}
                {r.headshot ? <img src={r.headshot} alt="" width={36} height={36} loading="lazy" className="headshot h-full w-full" /> : null}
            </span>
            <span className="min-w-0 leading-tight">
                {/* Touch: the whole row opens the player; the game line sits above it as its own target, a small gap under the name. */}
                <Link
                    href={`/players/${r.player}`}
                    className="block font-bold text-fg-1 underline-offset-4 hover:text-brand hover:underline coarse:after:absolute coarse:after:inset-0 coarse:after:content-['']"
                >
                    <span className="block truncate">{r.name}</span>
                </Link>
                <Link
                    href={`/games/${r.game}`}
                    className="flex min-w-0 items-center gap-1 whitespace-nowrap text-micro text-fg-3 hover:text-fg-1 coarse:relative coarse:z-10 coarse:mt-1 coarse:w-fit"
                >
                    {/* eslint-disable-next-line @next/next/no-img-element -- team logo */}
                    <img src={`/logos/${r.team}.svg`} alt="" width={14} height={14} className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">
                        {r.team} vs {r.opp}
                        {r.when ? ` · ${r.when}` : ''}
                        {r.note ? ` · ${r.note}` : ''}
                    </span>
                </Link>
            </span>
            <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="block h-2.5 w-full [@container(min-width:26rem)]:h-4" aria-hidden="true">
                <rect x={0} y={0} width={100} height={10} fill="var(--track)" />
                {r.parts ? (
                    stack(r.parts, x).map(s => <rect key={s.k} x={s.x} y={1} width={Math.max(0, s.w - 0.3)} height={8} fill={PARTS[s.k].color} />)
                ) : (
                    <rect x={Math.min(x(0), x(r.ps))} y={1} width={Math.abs(x(r.ps) - x(0))} height={8} fill="var(--goalie)" opacity={0.8} />
                )}
                <line x1={x(0)} x2={x(0)} y1={0} y2={10} className="stroke-fg-3" vectorEffect="non-scaling-stroke" />
            </svg>
            <span className={cn('text-right font-display text-body font-bold tabular-nums', r.ps < 0 ? 'text-fg-2' : 'text-fg-1')}>{signed(r.ps)}</span>
        </li>
    );
}
