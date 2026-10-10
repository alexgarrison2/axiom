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
import { Faceoffs } from './Faceoffs';
import { Matchups } from './Matchups';
import { Pulse } from './Pulse';
import { CompactScore, ScoreBand } from './ScoreBand';
import { Scoreboard } from './Scoreboard';
import type { SlateGame } from '@/lib/game/fetch';
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
    { id: 'faceoffs', label: 'Faceoffs' },
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
function Rail({ active, score, edge }: { active: string; score: boolean; edge: SlateGame['edge'] }) {
    // Where the chips overflow (phones), keep the current one in view as the page scrolls.
    const list = React.useRef<HTMLOListElement>(null);
    // Its height, for headers that pin under it (PinnedTable); only while it is showing.
    const nav = React.useRef<HTMLElement>(null);
    React.useEffect(() => {
        const el = nav.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const root = document.documentElement;
        const ro = new ResizeObserver(() => root.style.setProperty('--game-rail-h', `${el.offsetHeight}px`));
        ro.observe(el);
        return () => {
            ro.disconnect();
            root.style.removeProperty('--game-rail-h');
        };
    }, []);
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
        <nav ref={nav} aria-label="Game sections" className="sticky top-[calc(var(--appbar-h)+var(--vv-top,0px))] z-20 -mx-4 flex flex-col gap-2 border-b border-line bg-bg/95 px-4 py-2 backdrop-blur md:-mx-6 md:flex-row md:items-center md:gap-4 md:px-6">
            {/* The score rides along once the score band has scrolled away: its own row on phones, left of the chips wider. */}
            {score ? (
                <div className="flex justify-center motion-safe:animate-in motion-safe:fade-in md:justify-start md:border-r md:border-line md:pr-4">
                    <CompactScore edge={edge} />
                </div>
            ) : null}
            <ol ref={list} className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto scrollbar-hide">
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

/** True once the element has scrolled up past the app bar (it is above the viewport's top band). */
function useScrolledPast<T extends HTMLElement>(): [React.RefObject<T | null>, boolean] {
    const ref = React.useRef<T>(null);
    const [past, setPast] = React.useState(false);
    React.useEffect(() => {
        const el = ref.current;
        if (!el || typeof IntersectionObserver === 'undefined') return;
        const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--appbar-h')) || 56;
        const io = new IntersectionObserver(([e]) => setPast(!e.isIntersecting && e.boundingClientRect.top < 0), { rootMargin: `-${Math.round(bar + 48)}px 0px 0px 0px` });
        io.observe(el);
        return () => io.disconnect();
    }, []);
    return [ref, past];
}

export function GameView({ m, slate = [] }: { m: GameModel; slate?: SlateGame[] }) {
    const active = useActiveSection();
    const started = m.state !== 'pre';
    const [bandRef, bandGone] = useScrolledPast<HTMLDivElement>();
    // This game's power play / empty net right now, from the same score feed as the scoreboard bar.
    const edge = m.state === 'live' ? (slate.find(g => g.id === m.id)?.edge ?? null) : null;
    return (
        <GameProvider m={m}>
            <LiveRefresh live={m.state === 'live'} />
            <div className="flex flex-col gap-5">
                <Scoreboard games={slate} current={m.id} />
                <div ref={bandRef}>
                    <ScoreBand edge={edge} />
                </div>
                <div className="flex flex-col gap-6">
                    {/* Before puck drop the story is the only section: no chips to dead anchors on phones and tablets. */}
                    {started ? (
                        <Rail active={active} score={bandGone} edge={edge} />
                    ) : (
                        <div className="hidden lg:block">
                            <Rail active={active} score={bandGone} edge={edge} />
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
                                <Faceoffs />
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
