'use client';

import { useEffect, useId, useState } from 'react';
import type { Prediction } from '@/types/prediction';
import type { DetailsState } from './DetailsLoading';
import type { GameImplication } from '@/utils/implications';
import type { Phase } from '@/lib/matchup/lifecycle';
import { Segmented } from '@/components/ui/segmented';
import { loadGameDetails } from '@/lib/client-data';
import { WhyPanel } from './WhyPanel';
import { GoaliesPanel } from './GoaliesPanel';
import { LineupsPanel } from './LineupsPanel';
import { OddsPanel } from './OddsPanel';

type Tab = 'goalies' | 'lines' | 'odds' | 'why';

export interface DetailsProps {
    p: Prediction;
    phase: Phase;
    implication: GameImplication | null;
    playoffOdds: Record<string, number>;
    onCollapse: () => void;
}

const TABS: { value: Tab; label: string }[] = [
    { value: 'goalies', label: 'Goalies' },
    { value: 'lines', label: 'Lines' },
    { value: 'odds', label: 'Odds' },
    { value: 'why', label: 'Why' },
];

/**
 * Expanded card body, mounted only while the card is open. Heavy data
 * (lineups, goalies, injuries, recent games, news) comes from one memoized
 * request shared by every card.
 */
export default function Details({ p, phase, implication, onCollapse }: DetailsProps) {
    const [tab, setTab] = useState<Tab>('goalies');
    const [state, setState] = useState<DetailsState>({ status: 'loading' });
    const panelId = useId();
    const game = `${p.away.team.commonName} at ${p.home.team.commonName}`;

    useEffect(() => {
        let live = true;
        loadGameDetails(p.id).then(
            data => live && setState({ status: 'ready', data }),
            () => live && setState({ status: 'error' }),
        );
        return () => {
            live = false;
        };
    }, [p.id]);

    return (
        <div className="relative flex flex-col gap-3 border-t border-dashed border-line px-3 pb-2 pt-3 cq-md:px-4">
            <Segmented label={`${game} details`} options={TABS} value={tab} onChange={setTab} size="sm" />
            <div
                id={panelId}
                role="region"
                aria-label={`${TABS.find(t => t.value === tab)?.label ?? 'Details'}: ${game}`}
                className="max-h-[640px] overflow-y-auto overscroll-contain [scrollbar-width:thin]"
            >
                {tab === 'goalies' ? <GoaliesPanel p={p} state={state} /> : null}
                {tab === 'lines' ? <LineupsPanel p={p} state={state} /> : null}
                {tab === 'odds' ? <OddsPanel p={p} phase={phase} /> : null}
                {tab === 'why' ? <WhyPanel p={p} phase={phase} state={state} implication={implication} /> : null}
            </div>
            <button
                type="button"
                onClick={onCollapse}
                aria-label="Collapse"
                className="mx-auto inline-flex h-7 w-12 items-center justify-center rounded-control text-fg-3 transition-colors hover:bg-surface-2 hover:text-fg-1 coarse:h-11"
            >
                <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4">
                    <path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </button>
        </div>
    );
}
