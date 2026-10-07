'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * A word in the logo's scoreboard-LED lettering (the dot grid of the "pony xG"
 * wordmark in brand-mark.tsx): lowercase on a 3-wide, 4-high x-height with
 * descenders, one column between letters and two between words. The cells
 * light up left to right the first time the word scrolls into view (CSS
 * `led-on`, skipped under reduced motion).
 *
 * Decorative: give the surrounding heading its text.
 */

// [column, row] cells per glyph; row 0 is the x-height top, row 4 a descender.
const GLYPHS: Record<string, ReadonlyArray<readonly [number, number]>> = {
    // p, o, n, y: the brand mark's own cells.
    p: [[0, 0], [1, 0], [0, 1], [2, 1], [0, 2], [2, 2], [0, 3], [1, 3], [0, 4]],
    o: [[1, 0], [0, 1], [2, 1], [0, 2], [2, 2], [1, 3]],
    n: [[0, 0], [1, 0], [0, 1], [2, 1], [0, 2], [2, 2], [0, 3], [2, 3]],
    y: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2], [1, 3], [0, 4]],
    s: [[1, 0], [2, 0], [0, 1], [2, 2], [0, 3], [1, 3]],
    c: [[1, 0], [2, 0], [0, 1], [0, 2], [1, 3], [2, 3]],
    r: [[0, 0], [2, 0], [0, 1], [1, 1], [0, 2], [0, 3]],
    e: [[1, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 3], [2, 3]],
};

const PITCH = 11.66;
const CELL = 10;

export function LedWord({ text, className }: { text: string; className?: string }) {
    const ref = React.useRef<SVGSVGElement>(null);
    const [lit, setLit] = React.useState(false);
    React.useEffect(() => {
        const el = ref.current;
        if (!el || typeof IntersectionObserver === 'undefined') {
            setLit(true);
            return;
        }
        const io = new IntersectionObserver(([e]) => {
            if (e.isIntersecting) {
                setLit(true);
                io.disconnect();
            }
        }, { threshold: 0.6 });
        io.observe(el);
        return () => io.disconnect();
    }, []);

    const cells: { c: number; r: number }[] = [];
    let col = 0;
    for (const ch of text.toLowerCase()) {
        if (ch === ' ') {
            col += 3;
            continue;
        }
        for (const [c, r] of GLYPHS[ch] ?? []) cells.push({ c: col + c, r });
        col += 4;
    }
    const cols = Math.max(1, col - 1);
    const w = cols * PITCH;
    const h = 5 * PITCH;
    return (
        <svg ref={ref} viewBox={`${-PITCH / 2} ${-PITCH / 2} ${w} ${h}`} className={cn('block h-7 w-auto overflow-visible', className)} aria-hidden="true" focusable="false">
            {cells.map(({ c, r }, i) => (
                <rect
                    key={i}
                    x={c * PITCH - CELL / 2}
                    y={r * PITCH - CELL / 2}
                    width={CELL}
                    height={CELL}
                    rx={1.8}
                    fill="#F5F7FA"
                    stroke="#0F9EA0"
                    strokeWidth={1.6}
                    className="motion-reduce:!animate-none"
                    style={lit ? { animation: `led-on 420ms ease-out ${80 + c * 24}ms both` } : { opacity: 0.12 }}
                />
            ))}
        </svg>
    );
}

export default LedWord;
