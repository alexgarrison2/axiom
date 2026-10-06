'use client';

import * as React from 'react';
import { deltaE } from '@/components/ui/color';
import { clashSafePair, teamPalette } from '@/components/ui/team-color';
import { nameLabels } from '@/lib/game/analytics';
import type { GameEvent, GameModel, Player, Side } from '@/lib/game/types';

interface GameCtx {
    m: GameModel;
    colors: Record<Side, string>;
    byId: Map<number, Player>;
    /** Last name, or initial + last name where two players in the game share one. */
    label: (id: number | null | undefined) => string;
    /** The event the reader stopped on (pulse step, goal row, rink mark); flagged in every section. */
    selected: number | null;
    select: (id: number | null) => void;
    /** Goals and penalties in time order: the pulse steps through these. */
    keyEvents: GameEvent[];
}

const Ctx = React.createContext<GameCtx | null>(null);

const PK_ORANGE = '#ff8a3d';

/**
 * Side colours for the game page. The site-wide clash check lets two warm
 * primaries through (FLA red vs ANA orange); split cells and dim trailing bars
 * need more separation, and neither side may read as the penalty-kill orange.
 */
function gameColors(away: string, home: string): Record<Side, string> {
    const base = clashSafePair(away, home);
    let a = base.away;
    let h = base.home;
    if (deltaE(h, PK_ORANGE) < 25) h = teamPalette(home).alt;
    if (deltaE(a, PK_ORANGE) < 25) a = teamPalette(away).alt;
    if (deltaE(a, h) < 45) {
        const alt = teamPalette(home).alt;
        if (deltaE(a, alt) >= deltaE(teamPalette(away).alt, h)) h = alt;
        else a = teamPalette(away).alt;
    }
    return { away: a, home: h };
}

export function GameProvider({ m, children }: { m: GameModel; children: React.ReactNode }) {
    const [selected, setSelected] = React.useState<number | null>(null);
    const value = React.useMemo<GameCtx>(() => {
        const labels = nameLabels(m.players);
        return {
            m,
            colors: gameColors(m.teams.away.tri, m.teams.home.tri),
            byId: new Map(m.players.map(p => [p.id, p])),
            label: id => (id != null ? (labels.get(id) ?? '—') : '—'),
            selected,
            select: setSelected,
            keyEvents: m.events.filter(e => e.type === 'goal' || e.type === 'penalty'),
        };
    }, [m, selected]);
    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useGame(): GameCtx {
    const v = React.useContext(Ctx);
    if (!v) throw new Error('useGame outside GameProvider');
    return v;
}

/** Section frame: heading on the shared rhythm, anchor for the rail. */
export function GameSection({ id, title, aside, children }: { id: string; title: string; aside?: React.ReactNode; children: React.ReactNode }) {
    return (
        <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-[calc(var(--appbar-h)+var(--vv-top,0px)+60px)]">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
                <h2 id={`${id}-h`} className="font-display text-h2 font-bold uppercase leading-none tracking-wide text-fg-1">
                    {title}
                </h2>
                {aside ? <div className="flex flex-wrap items-center gap-2">{aside}</div> : null}
            </div>
            {children}
        </section>
    );
}
