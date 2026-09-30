'use client';

import type { Prediction } from '@/types/prediction';
import { finalLabel, liveClock, modelCorrect, type LiveGame, type Phase } from '@/lib/matchup/lifecycle';
import { GameTime } from './GameTime';
import { cn } from '@/lib/utils';

/** Top-left of the card: puck drop, a LIVE clock, or the final with the model's grade. */
export function StatusLine({ p, phase, live }: { p: Prediction; phase: Phase; live: LiveGame | null }) {
    if (phase === 'live') {
        const sog = live && live.away.sog != null && live.home.sog != null ? `SOG ${live.away.sog}–${live.home.sog}` : null;
        return (
            <span className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-chip bg-neg px-1.5 py-0.5 text-micro font-black uppercase tracking-wider text-bg">
                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-bg motion-safe:animate-pulse" />
                    Live
                </span>
                <span className="text-body-sm font-bold tabular-nums text-fg-1">{liveClock(live)}</span>
                {sog ? <span className="text-caption tabular-nums text-fg-2">{sog}</span> : null}
            </span>
        );
    }
    if (phase === 'final') {
        const ok = modelCorrect(p, live);
        return (
            <span className="flex flex-wrap items-center gap-2">
                <span className="text-body-sm font-black uppercase tracking-wide text-fg-1">{finalLabel(live)}</span>
                {ok != null ? (
                    <span
                        className={cn(
                            'inline-flex items-center gap-1 rounded-chip border px-1.5 py-0.5 text-micro font-bold',
                            ok ? 'border-pos/40 bg-pos/10 text-pos' : 'border-neg/40 bg-neg/10 text-neg',
                        )}
                    >
                        Model {ok ? '✓' : '✗'}
                        <span className="sr-only">{ok ? ' pick was right' : ' pick was wrong'}</span>
                    </span>
                ) : null}
            </span>
        );
    }
    return (
        <span className="flex items-center gap-2">
            <GameTime iso={p.startTimeUtc} className="text-body-sm font-bold tabular-nums text-fg-1" />
            {p.tvNetwork ? <span className="rounded-chip border border-line px-1.5 py-px text-micro font-semibold text-fg-2">{p.tvNetwork}</span> : null}
            {p.gameType === '03' ? <span className="rounded-chip bg-playoff/15 px-1.5 py-px text-micro font-bold uppercase text-playoff">Playoffs</span> : null}
        </span>
    );
}

export default StatusLine;
