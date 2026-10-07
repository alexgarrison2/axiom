'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import type { Player } from '@/lib/game/types';

type Tip = { x: number; y: number; node: React.ReactNode; touch: boolean };

/** Optional side effects that follow the card (e.g. lighting the hovered row elsewhere). */
type TipHooks = { enter?: () => void; leave?: () => void };

/**
 * A card that follows the pointer over a chart mark. `bind(node)` spreads the
 * pointer handlers onto the mark; `tip` renders the card (portalled to body,
 * flipped away from the viewport edges). Touch: a tap pins the card beside
 * the finger; a tap elsewhere, the same tap again, a scroll or Escape lets go.
 */
export function useHoverTip() {
    const [tip, setTip] = React.useState<Tip | null>(null);
    const lastType = React.useRef('mouse');
    const owner = React.useRef<{ el: Element; leave?: () => void } | null>(null);
    const hide = React.useCallback(() => {
        owner.current?.leave?.();
        owner.current = null;
        setTip(null);
    }, []);
    const pinned = tip?.touch ?? false;
    React.useEffect(() => {
        if (!pinned) return;
        const y0 = window.scrollY;
        const off = (e: PointerEvent) => {
            if (!owner.current?.el.contains(e.target as Node)) hide();
        };
        const scroll = () => {
            if (Math.abs(window.scrollY - y0) > 24) hide();
        };
        const esc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') hide();
        };
        window.addEventListener('pointerdown', off, true);
        window.addEventListener('scroll', scroll, { passive: true });
        window.addEventListener('keydown', esc);
        return () => {
            window.removeEventListener('pointerdown', off, true);
            window.removeEventListener('scroll', scroll);
            window.removeEventListener('keydown', esc);
        };
    }, [pinned, hide]);
    const bind = (node: React.ReactNode, hooks?: TipHooks) => ({
        onPointerDown: (e: React.PointerEvent) => {
            lastType.current = e.pointerType;
        },
        onPointerEnter: (e: React.PointerEvent) => {
            if (e.pointerType !== 'mouse') return;
            setTip({ x: e.clientX, y: e.clientY, node, touch: false });
            hooks?.enter?.();
        },
        onPointerMove: (e: React.PointerEvent) => {
            if (e.pointerType === 'mouse') setTip({ x: e.clientX, y: e.clientY, node, touch: false });
        },
        onPointerLeave: (e: React.PointerEvent) => {
            if (e.pointerType !== 'mouse') return;
            setTip(null);
            hooks?.leave?.();
        },
        onClick: (e: React.MouseEvent) => {
            if (lastType.current === 'mouse') return;
            const el = e.currentTarget;
            if (owner.current?.el === el) {
                hide();
                return;
            }
            owner.current?.leave?.();
            owner.current = { el, leave: hooks?.leave };
            setTip({ x: e.clientX, y: e.clientY, node, touch: true });
            hooks?.enter?.();
        },
    });
    const el = tip && typeof document !== 'undefined' ? createPortal(<TipCard tip={tip} />, document.body) : null;
    return { bind, tip: el };
}

/** Pixel value of a root CSS length variable (the app bar and tab bar heights). */
function rootPx(name: string, fallback: number): number {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
    return Number.isFinite(v) ? v : fallback;
}

function TipCard({ tip }: { tip: Tip }) {
    const ref = React.useRef<HTMLDivElement>(null);
    const [size, setSize] = React.useState({ w: 260, h: 160 });
    React.useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        // A tapped card is placed by its layout size (the zoom-in entrance would measure 5% small).
        const r = tip.touch ? { width: el.offsetWidth, height: el.offsetHeight } : el.getBoundingClientRect();
        setSize(s => (Math.abs(r.width - s.w) > 1 || Math.abs(r.height - s.h) > 1 ? { w: r.width, h: r.height } : s));
    }, [tip]);
    const gap = 16;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    let left = tip.x + gap + size.w > vw - 8 ? Math.max(8, tip.x - gap - size.w) : tip.x + gap;
    let top = Math.min(Math.max(8, tip.y - size.h / 2), vh - size.h - 8);
    if (tip.touch) {
        // The layout viewport: on phones innerWidth can include a transient overflow.
        const cw = Math.min(vw, document.documentElement.clientWidth || vw);
        // Tapped: centred over the finger, above it (clear of the app bar and the sticky section rail) or else below
        // it (clear of the bottom tab bar), so the card never sits under the finger or the mark it describes.
        const minTop = rootPx('--appbar-h', 52) + 64;
        const maxBottom = vh - (vw < 768 ? rootPx('--tabbar-h', 56) + 24 : 8);
        left = Math.min(Math.max(8, tip.x - size.w / 2), cw - size.w - 8);
        const above = tip.y - 28 - size.h;
        const below = tip.y + 28;
        top = above >= minTop ? above : below + size.h <= maxBottom ? below : Math.max(minTop, Math.min(above, maxBottom - size.h));
    }
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
            {p?.headshot ? <img src={p.headshot} alt="" width={size} height={size} className="headshot h-full w-full" /> : null}
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
