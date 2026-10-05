'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { GameModel } from '@/lib/game/types';
import { GameProvider, GameSection } from './GameContext';
import { Goalies } from './Goalies';
import { Goals } from './Goals';
import { Lines } from './Lines';
import { Matchups } from './Matchups';
import { Pulse } from './Pulse';
import { ScoreBand } from './ScoreBand';
import { Shots } from './Shots';
import { Skaters } from './Skaters';
import { TeamStats } from './TeamStats';
import { Units } from './Units';
import { XgBreakdown } from './XgBreakdown';
import { Zones } from './Zones';

/** One fixed order, every game. */
const SECTIONS = [
    { id: 'story', label: 'Story' },
    { id: 'goals', label: 'Goals' },
    { id: 'shots', label: 'Shots' },
    { id: 'xg', label: 'xG' },
    { id: 'team', label: 'Team' },
    { id: 'skaters', label: 'Skaters' },
    { id: 'units', label: 'Units' },
    { id: 'goalies', label: 'Goalies' },
    { id: 'lines', label: 'Lines' },
    { id: 'matchups', label: 'Matchups' },
    { id: 'zones', label: 'Zones' },
] as const;

/** The last section whose heading has passed a line a third of the way down the screen. */
function useActiveSection(): string {
    const [active, setActive] = React.useState<string>('story');
    React.useEffect(() => {
        let frame = 0;
        const update = () => {
            frame = 0;
            const line = window.innerHeight / 3;
            let cur: string = SECTIONS[0].id;
            for (const s of SECTIONS) {
                const el = document.getElementById(s.id);
                if (el && el.getBoundingClientRect().top <= line) cur = s.id;
            }
            // At the bottom of the page the last section wins even if its heading never reaches the line.
            if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) cur = SECTIONS[SECTIONS.length - 1].id;
            setActive(cur);
        };
        const onScroll = () => {
            if (!frame) frame = requestAnimationFrame(update);
        };
        update();
        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onScroll);
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener('scroll', onScroll);
            window.removeEventListener('resize', onScroll);
        };
    }, []);
    return active;
}

/** While the game is live, re-render from the server every 30s (the feeds are cached for 30s). */
function LiveRefresh({ live }: { live: boolean }) {
    const router = useRouter();
    React.useEffect(() => {
        if (!live) return;
        const id = window.setInterval(() => {
            if (document.visibilityState === 'visible') router.refresh();
        }, 30_000);
        return () => window.clearInterval(id);
    }, [live, router]);
    return null;
}

function Rail({ active }: { active: string }) {
    return (
        <>
            {/* Desktop: a sticky contents rail. */}
            <nav aria-label="Game sections" className="hidden lg:block">
                <ol className="sticky top-[calc(var(--appbar-h)+var(--vv-top,0px)+16px)] flex flex-col gap-0.5 border-l border-line">
                    {SECTIONS.map(s => (
                        <li key={s.id}>
                            <a
                                href={`#${s.id}`}
                                aria-current={active === s.id ? 'location' : undefined}
                                className={cn(
                                    '-ml-px flex min-h-8 items-center border-l-2 pl-3 text-micro font-medium uppercase tracking-label transition-colors',
                                    active === s.id ? 'border-brand text-brand' : 'border-transparent text-fg-3 hover:text-fg-1',
                                )}
                            >
                                {s.label}
                            </a>
                        </li>
                    ))}
                </ol>
            </nav>
            {/* Phones and tablets: a sticky chip bar under the app bar. */}
            <nav aria-label="Game sections" className="sticky top-[calc(var(--appbar-h)+var(--vv-top,0px))] z-20 -mx-4 border-b border-line bg-bg/95 px-4 py-2 backdrop-blur md:-mx-6 md:px-6 lg:hidden">
                <ol className="flex gap-1.5 overflow-x-auto scrollbar-hide">
                    {SECTIONS.map(s => (
                        <li key={s.id} className="shrink-0">
                            <a
                                href={`#${s.id}`}
                                aria-current={active === s.id ? 'location' : undefined}
                                className={cn(
                                    'inline-flex min-h-8 items-center rounded-full border px-3 text-micro font-medium uppercase tracking-chip coarse:min-h-10',
                                    active === s.id ? 'border-brand/60 text-brand' : 'border-line text-fg-3',
                                )}
                            >
                                {s.label}
                            </a>
                        </li>
                    ))}
                </ol>
            </nav>
        </>
    );
}

export function GameView({ m }: { m: GameModel }) {
    const active = useActiveSection();
    const started = m.state !== 'pre';
    return (
        <GameProvider m={m}>
            <LiveRefresh live={m.state === 'live'} />
            <div className="flex flex-col gap-5">
                <ScoreBand />
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-[8.5rem_minmax(0,1fr)] lg:gap-8">
                    <Rail active={active} />
                    <div className="flex min-w-0 flex-col gap-10">
                        <GameSection id="story" title="Story">
                            {started ? <Pulse /> : <p className="panel p-card label">Puck drop at the time above</p>}
                        </GameSection>
                        {started ? (
                            <>
                                <Goals />
                                <Shots />
                                <XgBreakdown />
                                <TeamStats />
                                <Skaters />
                                <Units />
                                <Goalies />
                                <Lines />
                                <Matchups />
                                <Zones />
                            </>
                        ) : null}
                    </div>
                </div>
            </div>
        </GameProvider>
    );
}

export default GameView;
