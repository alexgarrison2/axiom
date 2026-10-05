'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import type { Player } from '@/lib/game/types';

type Tip = { x: number; y: number; node: React.ReactNode };

/**
 * A card that follows the pointer over a chart mark. `bind(node)` spreads the
 * pointer handlers onto the mark; `tip` renders the card (portalled to body,
 * flipped away from the viewport edges). Touch: a tap shows it, the next tap
 * elsewhere replaces it.
 */
export function useHoverTip() {
    const [tip, setTip] = React.useState<Tip | null>(null);
    const bind = (node: React.ReactNode) => ({
        onPointerEnter: (e: React.PointerEvent) => setTip({ x: e.clientX, y: e.clientY, node }),
        onPointerMove: (e: React.PointerEvent) => setTip({ x: e.clientX, y: e.clientY, node }),
        onPointerLeave: () => setTip(null),
    });
    const el = tip && typeof document !== 'undefined' ? createPortal(<TipCard tip={tip} />, document.body) : null;
    return { bind, tip: el };
}

function TipCard({ tip }: { tip: Tip }) {
    const ref = React.useRef<HTMLDivElement>(null);
    const [size, setSize] = React.useState({ w: 260, h: 160 });
    React.useLayoutEffect(() => {
        const r = ref.current?.getBoundingClientRect();
        if (r) setSize(s => (Math.abs(r.width - s.w) > 1 || Math.abs(r.height - s.h) > 1 ? { w: r.width, h: r.height } : s));
    }, [tip]);
    const gap = 16;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    const left = tip.x + gap + size.w > vw - 8 ? Math.max(8, tip.x - gap - size.w) : tip.x + gap;
    const top = Math.min(Math.max(8, tip.y - size.h / 2), vh - size.h - 8);
    return (
        <div
            ref={ref}
            role="tooltip"
            className="pointer-events-none fixed z-50 w-max max-w-[18rem] rounded-card border border-line-strong bg-surface-1/95 p-3 text-caption tabular-nums shadow-[0_12px_32px_rgb(0_0_0/0.55)] backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95"
            style={{ left, top }}
        >
            {tip.node}
        </div>
    );
}

/** Headshot in a team-colour ring. */
export function TipFace({ p, color, size = 36 }: { p: Player | undefined; color: string; size?: number }) {
    return (
        <span className="block shrink-0 overflow-hidden rounded-full border-2 bg-surface-2" style={{ borderColor: color, width: size, height: size }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- NHL headshots are pre-sized PNGs */}
            {p?.headshot ? <img src={p.headshot} alt="" width={size} height={size} className="h-full w-full object-cover" /> : null}
        </span>
    );
}

/** Label / value row. */
export function TipRow({ k, children, className }: { k: React.ReactNode; children: React.ReactNode; className?: string }) {
    return (
        <div className={cn('flex items-baseline justify-between gap-4', className)}>
            <span className="text-micro uppercase tracking-label text-fg-3">{k}</span>
            <span className="text-fg-1">{children}</span>
        </div>
    );
}
