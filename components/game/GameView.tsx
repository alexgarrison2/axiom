'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { GameModel } from '@/lib/game/types';
import { GameProvider, GameSection } from './GameContext';
import { GameScore } from './GameScore';
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
    { id: 'ponyscore', label: 'Pony score' },
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

/** Section chips in a sticky bar under the app bar, at every width (the page keeps its full width for the charts). */
function Rail({ active }: { active: string }) {
    // Where the chips overflow (phones), keep the current one in view as the page scrolls.
    const list = React.useRef<HTMLOListElement>(null);
    React.useEffect(() => {
        const ol = list.current;
        const chip = ol?.querySelector<HTMLElement>('[aria-current]');
        if (!ol || !chip || ol.scrollWidth <= ol.clientWidth) return;
        const l = chip.offsetLeft - ol.offsetLeft;
        if (l < ol.scrollLeft + 8 || l + chip.offsetWidth > ol.scrollLeft + ol.clientWidth - 8) {
            ol.scrollTo({ left: Math.max(0, l - (ol.clientWidth - chip.offsetWidth) / 2), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        }
    }, [active]);
    return (
        <nav aria-label="Game sections" className="sticky top-[calc(var(--appbar-h)+var(--vv-top,0px))] z-20 -mx-4 border-b border-line bg-bg/95 px-4 py-2 backdrop-blur md:-mx-6 md:px-6">
            <ol ref={list} className="flex gap-1.5 overflow-x-auto scrollbar-hide">
                {SECTIONS.map(s => (
                    <li key={s.id} className="shrink-0">
                        <a
                            href={`#${s.id}`}
                            aria-current={active === s.id ? 'location' : undefined}
                            className={cn(
                                'inline-flex min-h-8 items-center rounded-full border px-3 text-micro font-medium uppercase tracking-chip transition-colors coarse:min-h-10',
                                active === s.id ? 'border-brand/60 text-brand' : 'border-line text-fg-3 hover:border-line-strong hover:text-fg-1',
                            )}
                        >
                            {s.label}
                        </a>
                    </li>
                ))}
            </ol>
        </nav>
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
                <div className="flex flex-col gap-6">
                    {/* Before puck drop the story is the only section: no chips to dead anchors on phones and tablets. */}
                    {started ? (
                        <Rail active={active} />
                    ) : (
                        <div className="hidden lg:block">
                            <Rail active={active} />
                        </div>
                    )}
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
                                <GameScore />
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
