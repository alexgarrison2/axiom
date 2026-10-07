'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import type { Player } from '@/lib/game/types';

type Box = { l: number; t: number; r: number; b: number };
type Tip = { x: number; y: number; node: React.ReactNode; touch: boolean; mark?: Box };

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
    // The scroll position a pinned card belongs to; the card may move the page a little to make room (rebase).
    const y0 = React.useRef(0);
    const rebase = React.useCallback(() => {
        y0.current = window.scrollY;
    }, []);
    React.useEffect(() => {
        if (!pinned) return;
        y0.current = window.scrollY;
        const off = (e: PointerEvent) => {
            if (!owner.current?.el.contains(e.target as Node)) hide();
        };
        const scroll = () => {
            if (Math.abs(window.scrollY - y0.current) > 24) hide();
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
            const r = el.getBoundingClientRect();
            setTip({ x: e.clientX, y: e.clientY, node, touch: true, mark: { l: r.left, t: r.top, r: r.right, b: r.bottom } });
            hooks?.enter?.();
        },
    });
    const el = tip && typeof document !== 'undefined' ? createPortal(<TipCard tip={tip} rebase={rebase} />, document.body) : null;
    return { bind, tip: el };
}

/** Pixel value of a root CSS length variable (the app bar and tab bar heights). */
function rootPx(name: string, fallback: number): number {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
    return Number.isFinite(v) ? v : fallback;
}

/** Where a tapped card goes, given the finger (y) and the mark, both already shifted by any nudge. */
function touchSpots(x: number, y: number, mk: Box, w: number, h: number, cw: number, minTop: number, maxBottom: number) {
    const clampX = (v: number) => Math.min(Math.max(8, v), cw - w - 8);
    const clampY = (v: number) => Math.max(minTop, Math.min(v, maxBottom - h));
    const g = 12;
    // Above, below, then beside it (the roomier side); the one covering the mark least wins, in that order.
    const cands = [
        { l: clampX(x - w / 2), t: clampY(Math.min(y - 28, mk.t - g) - h) },
        { l: clampX(x - w / 2), t: clampY(Math.max(y + 28, mk.b + g)) },
        mk.l > cw - mk.r ? { l: clampX(mk.l - g - w), t: clampY((mk.t + mk.b) / 2 - h / 2) } : { l: clampX(mk.r + g), t: clampY((mk.t + mk.b) / 2 - h / 2) },
    ];
    const cover = (c: { l: number; t: number }) => Math.max(0, Math.min(c.l + w, mk.r) - Math.max(c.l, mk.l)) * Math.max(0, Math.min(c.t + h, mk.b) - Math.max(c.t, mk.t));
    const best = cands.reduce((a, c) => (cover(c) < cover(a) ? c : a));
    return { ...best, covered: cover(best) > 0 };
}

function TipCard({ tip, rebase }: { tip: Tip; rebase: () => void }) {
    // Page scroll the card asked for (when it fits neither beside nor around the mark), so the mark moved up or down by this.
    const [nudged, setNudged] = React.useState<{ tip: Tip; d: number } | null>(null);
    const nudge = nudged?.tip === tip ? nudged.d : 0;
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
    const touchGeom = () => {
        // The layout viewport: on phones innerWidth can include a transient overflow.
        const cw = Math.min(vw, document.documentElement.clientWidth || vw);
        // Clear of the app bar and the sticky section rail above, and of the bottom tab bar below.
        const minTop = rootPx('--appbar-h', 52) + 64;
        const maxBottom = vh - (vw < 768 ? rootPx('--tabbar-h', 56) + 24 : 8);
        // The tapped mark (a row can be wider than the screen: then just a fingertip around the tap).
        const raw = tip.mark && tip.mark.r - tip.mark.l < cw * 0.6 ? tip.mark : { l: tip.x - 14, t: tip.y - 14, r: tip.x + 14, b: tip.y + 14 };
        return { cw, minTop, maxBottom, raw };
    };
    // Nowhere to put it without covering the mark (short screens): scroll the page just enough that it fits above or below.
    const measured = React.useRef<Tip | null>(null);
    React.useLayoutEffect(() => {
        if (!tip.touch || measured.current === tip || !ref.current) return;
        if (Math.abs(ref.current.offsetHeight - size.h) > 1) return;
        measured.current = tip;
        const { cw, minTop, maxBottom, raw } = touchGeom();
        if (!touchSpots(tip.x, tip.y, raw, size.w, size.h, cw, minTop, maxBottom).covered) return;
        const down = raw.b + 12 + size.h - maxBottom; // scroll down: the mark rises, the card fits below
        const up = minTop - (raw.t - 12 - size.h); // scroll up: the mark drops, the card fits above
        const okDown = raw.t - down >= minTop;
        const okUp = raw.b + up <= maxBottom;
        const d = okDown && (!okUp || down <= up) ? down : okUp ? -up : 0;
        if (!d) return;
        const before = window.scrollY;
        window.scrollBy({ top: d, behavior: 'instant' as ScrollBehavior });
        rebase();
        setNudged({ tip, d: window.scrollY - before });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- touchGeom reads only tip and the window
    }, [tip, size, rebase]);
    if (tip.touch) {
        const { cw, minTop, maxBottom, raw } = touchGeom();
        const mk = { l: raw.l, r: raw.r, t: raw.t - nudge, b: raw.b - nudge };
        const spot = touchSpots(tip.x, tip.y - nudge, mk, size.w, size.h, cw, minTop, maxBottom);
        left = spot.l;
        top = spot.t;
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
