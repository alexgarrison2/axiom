'use client';

import { useEffect, useId, useState } from 'react';
import type { Prediction } from '@/types/prediction';
import type { DetailsState } from './DetailsLoading';
import type { GameImplication } from '@/utils/implications';
import type { Phase } from '@/lib/matchup/lifecycle';
import { cn } from '@/lib/utils';
import { Segmented } from '@/components/ui/segmented';
import { loadGameDetails } from '@/lib/client-data';
import { WhyPanel } from './WhyPanel';
import { FormPanel } from './FormPanel';
import { LineupsPanel } from './LineupsPanel';
import { OddsPanel } from './OddsPanel';
import { MatchupPanel } from './MatchupPanel';

export type Tab = 'form' | 'lines' | 'matchup' | 'odds' | 'why';

export interface DetailsProps {
    p: Prediction;
    phase: Phase;
    implication: GameImplication | null;
    playoffOdds: Record<string, number>;
    onCollapse?: () => void;
    /** Controlled tab (the pane keeps it across games). */
    tab?: Tab;
    onTab?: (t: Tab) => void;
}

const TABS: { value: Tab; label: string }[] = [
    { value: 'form', label: 'Form' },
    { value: 'lines', label: 'Lines' },
    { value: 'matchup', label: 'Matchup' },
    { value: 'odds', label: 'Odds' },
    { value: 'why', label: 'Why' },
];

/**
 * Expanded card body, mounted only while the card is open. Heavy data
 * (lineups, goalies, injuries, recent games, news) comes from one memoized
 * request shared by every card.
 */
export default function Details({ p, phase, implication, onCollapse, tab: tabProp, onTab }: DetailsProps) {
    const [tabState, setTabState] = useState<Tab>('form');
    const tab = tabProp ?? tabState;
    const setTab = onTab ?? setTabState;
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
            <Segmented label={`${game} details`} options={TABS} value={tab} onChange={setTab} size="sm" block optionClassName="px-1.5 tracking-[0.06em] cq-md:px-3 cq-md:tracking-[0.12em]" />
            {/* No inner scroll box: the page scrolls, so a thumb never gets caught in a nested scroller. */}
            <div
                id={panelId}
                role="region"
                aria-label={`${TABS.find(t => t.value === tab)?.label ?? 'Details'}: ${game}`}
                className={cn('overflow-x-clip', tab === 'matchup' && 'mx-auto max-w-[52rem]')}
            >
                {tab === 'form' ? <FormPanel p={p} state={state} /> : null}
                {tab === 'lines' ? <LineupsPanel p={p} state={state} /> : null}
                {tab === 'matchup' ? <MatchupPanel p={p} state={state} /> : null}
                {tab === 'odds' ? <OddsPanel p={p} phase={phase} /> : null}
                {tab === 'why' ? <WhyPanel p={p} phase={phase} state={state} implication={implication} /> : null}
            </div>
            {onCollapse ? (
                <button
                    type="button"
                    onClick={onCollapse}
                    aria-label={`Collapse ${game}`}
                    className="mx-auto inline-flex h-7 w-12 items-center justify-center rounded-control text-fg-3 transition-colors hover:bg-surface-2 hover:text-fg-1 coarse:h-11"
                >
                    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4">
                        <path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </button>
            ) : null}
        </div>
    );
}
