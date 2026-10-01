'use client';

import type { Prediction } from '@/types/prediction';
import { finalLabel, liveClock, type LiveGame, type Phase } from '@/lib/matchup/lifecycle';
import { finalWords } from '@/lib/matchup/format';
import { GameTime } from './GameTime';
import { NetworkBadges } from './NetworkBadges';

/** Top-left of the card: puck drop + network, the LIVE clock, or FINAL. */
export function StatusLine({ p, phase, live }: { p: Prediction; phase: Phase; live: LiveGame | null }) {
    if (phase === 'live') {
        const sog = live && live.away.sog != null && live.home.sog != null ? `SOG ${live.away.sog}–${live.home.sog}` : null;
        return (
            <span className="flex min-w-0 items-center gap-2.5">
                <span aria-hidden="true" className="live-dot motion-safe:animate-pulse" />
                <span className="sr-only">Live, </span>
                <span className="text-body-sm font-bold uppercase tracking-[0.14em] cq-md:tracking-[0.22em] text-pos">{liveClock(live)}</span>
                {sog ? <span className="text-micro tracking-wide text-fg-3">{sog}</span> : null}
            </span>
        );
    }
    if (phase === 'final') {
        return <span className="text-body-sm font-bold uppercase tracking-[0.14em] text-fg-3 cq-md:tracking-[0.24em]">{finalWords(finalLabel(live))}</span>;
    }
    return (
        <span className="flex min-w-0 items-center gap-2.5">
            <GameTime iso={p.startTimeUtc} className="whitespace-nowrap text-body-sm font-bold uppercase tracking-[0.14em] cq-md:tracking-[0.22em] text-fg-1" />
            <NetworkBadges tv={p.tvBroadcasts ?? (p.tvNetwork ? [{ network: p.tvNetwork, market: 'N', team: null, country: 'US' }] : [])} />
        </span>
    );
}

export default StatusLine;
