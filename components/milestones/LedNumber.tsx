'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * A number in the wordmark's scoreboard-LED cells (see LedWord): a 5 x 7 dot
 * matrix per digit, every cell drawn so the unlit ones read as the panel.
 * Lights left to right the first time it scrolls into view (CSS `led-on`,
 * skipped under reduced motion). Decorative: put the number in text beside it.
 */

const DIGITS: Record<string, string[]> = {
    '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
    '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
    '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
    '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
    '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
    '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
    '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
    '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
    '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
    '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
    '.': ['.', '.', '.', '.', '.', '.', '#'],
    ',': ['.', '.', '.', '.', '.', '#', '#'],
};

const PITCH = 11.66;
const CELL = 10;

export function LedNumber({ value, className, still = false }: { value: string; className?: string; /** Never animates (dense lists). */ still?: boolean }) {
    const ref = React.useRef<SVGSVGElement>(null);
    // Lit by default (server HTML, no JS, reduced motion); once hydrated it waits
    // dimmed below the fold and lights up when it scrolls into view.
    const [phase, setPhase] = React.useState<'static' | 'wait' | 'on'>('static');
    React.useEffect(() => {
        const el = ref.current;
        if (still || !el || typeof IntersectionObserver === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        setPhase('wait');
        const io = new IntersectionObserver(([e]) => {
            if (e.isIntersecting) {
                setPhase('on');
                io.disconnect();
            }
        }, { threshold: 0.5 });
        io.observe(el);
        return () => io.disconnect();
    }, [still]);

    const cells: { c: number; r: number; on: boolean }[] = [];
    let col = 0;
    for (const ch of value) {
        const g = DIGITS[ch];
        if (!g) continue;
        const w = g[0].length;
        g.forEach((row, r) => [...row].forEach((x, c) => cells.push({ c: col + c, r, on: x === '#' })));
        col += w + 1;
    }
    const cols = Math.max(1, col - 1);
    return (
        <svg
            ref={ref}
            viewBox={`${-PITCH / 2} ${-PITCH / 2} ${cols * PITCH} ${7 * PITCH}`}
            className={cn('block h-12 w-auto overflow-visible', className)}
            aria-hidden="true"
            focusable="false"
        >
            {cells.map(({ c, r, on }, i) =>
                on ? (
                    <rect
                        key={i}
                        x={c * PITCH - CELL / 2}
                        y={r * PITCH - CELL / 2}
                        width={CELL}
                        height={CELL}
                        rx={1.8}
                        fill="#F5F7FA"
                        stroke="#0F9EA0"
                        strokeWidth={still ? 0.6 : 1.6}
                        style={phase === 'on' ? { animation: `led-on 420ms ease-out ${60 + c * 22}ms both` } : phase === 'wait' ? { opacity: 0.12 } : undefined}
                    />
                ) : (
                    <rect key={i} x={c * PITCH - CELL / 2} y={r * PITCH - CELL / 2} width={CELL} height={CELL} rx={1.8} fill="var(--line)" opacity={0.4} />
                ),
            )}
        </svg>
    );
}

export default LedNumber;
