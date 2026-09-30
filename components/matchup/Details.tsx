'use client';

import { useEffect, useId, useState } from 'react';
import type { Prediction } from '@/types/prediction';
import type { DetailsState } from './DetailsLoading';
import type { GameImplication } from '@/utils/implications';
import type { Phase } from '@/lib/matchup/lifecycle';
import { Segmented } from '@/components/ui/segmented';
import { loadGameDetails } from '@/lib/client-data';
import { PreviewPanel } from './PreviewPanel';
import { GoaliesPanel } from './GoaliesPanel';
import { LineupsPanel } from './LineupsPanel';
import { OddsPanel } from './OddsPanel';

type Tab = 'preview' | 'goalies' | 'lineups' | 'odds';

export interface DetailsProps {
    p: Prediction;
    phase: Phase;
    implication: GameImplication | null;
    playoffOdds: Record<string, number>;
    onCollapse: () => void;
}

/**
 * Expanded card body, mounted only while the card is open. Heavy data
 * (lineups, goalies, injuries, recent games, news) comes from one memoized
 * request shared by every card.
 */
export default function Details({ p, phase, implication, playoffOdds, onCollapse }: DetailsProps) {
    const [tab, setTab] = useState<Tab>('preview');
    const [state, setState] = useState<DetailsState>({ status: 'loading' });
    const panelId = useId();

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

    const tabs: { value: Tab; label: string }[] = [
        { value: 'preview', label: 'Preview' },
        { value: 'goalies', label: 'Goalies' },
        { value: 'lineups', label: 'Lineups' },
        { value: 'odds', label: 'Odds' },
    ];

    return (
        <div className="flex flex-col gap-3 border-t border-line bg-bg/30 px-4 pb-3 pt-3 cq-md:px-5">
            <Segmented label={`${p.away.team.commonName} at ${p.home.team.commonName} details`} options={tabs} value={tab} onChange={setTab} size="sm" block />
            <div id={panelId} role="region" aria-label={tabs.find(t => t.value === tab)?.label} className="max-h-[600px] overflow-y-auto overscroll-contain [scrollbar-width:thin]">
                {tab === 'preview' ? <PreviewPanel p={p} phase={phase} state={state} implication={implication} playoffOdds={playoffOdds} /> : null}
                {tab === 'goalies' ? <GoaliesPanel p={p} state={state} /> : null}
                {tab === 'lineups' ? <LineupsPanel p={p} state={state} /> : null}
                {tab === 'odds' ? <OddsPanel p={p} phase={phase} /> : null}
            </div>
            <button
                type="button"
                onClick={onCollapse}
                className="mx-auto inline-flex min-h-9 items-center gap-1.5 rounded-control px-3 text-caption font-semibold text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg-1 coarse:min-h-11"
            >
                <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5">
                    <path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Collapse
            </button>
        </div>
    );
}
