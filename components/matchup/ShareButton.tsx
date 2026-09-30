'use client';

import { useState } from 'react';
import type { Prediction } from '@/types/prediction';
import { modelPair } from '@/lib/matchup/edge';

/** Share a link to this card (native share sheet, else copy to clipboard). */
export function ShareButton({ p, title, anchor }: { p: Prediction; title: string; anchor: string }) {
    const [msg, setMsg] = useState<string | null>(null);

    const share = async () => {
        const url = `${window.location.origin}/?date=${p.date}#${anchor}`;
        const m = modelPair(p);
        const text = m ? `${title}: model ${p.away.team.triCode} ${m.away}% · ${p.home.team.triCode} ${m.home}%` : title;
        try {
            if (typeof navigator.share === 'function' && window.matchMedia?.('(pointer: coarse)').matches) {
                await navigator.share({ title: `${title} · Pony xG`, text, url });
                return;
            }
            await navigator.clipboard.writeText(url);
            setMsg('Link copied');
        } catch (e) {
            if ((e as Error)?.name === 'AbortError') return;
            setMsg('Copy failed');
        }
        window.setTimeout(() => setMsg(null), 2000);
    };

    return (
        <span className="relative z-10 inline-flex items-center">
            <button
                type="button"
                onClick={share}
                aria-label={`Share ${title}`}
                title="Share this game"
                className="inline-flex h-7 w-7 items-center justify-center rounded-control text-fg-3 transition-colors hover:bg-surface-2 hover:text-fg-1 coarse:-my-2 coarse:h-11 coarse:w-11"
            >
                <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5">
                    <path d="M8 10V2.5M5 5l3-3 3 3M3.5 8.5v4.5h9V8.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </button>
            <span role="status" aria-live="polite" className={msg ? 'absolute right-0 top-full z-20 mt-1 whitespace-nowrap rounded-chip border border-line-strong bg-surface-3 px-2 py-1 text-caption font-semibold text-fg-1 shadow-card' : 'sr-only'}>
                {msg}
            </span>
        </span>
    );
}

export default ShareButton;
