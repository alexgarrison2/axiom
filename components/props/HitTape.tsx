import * as React from 'react';
import { cn } from '@/lib/utils';
import { shortDate, type Category, type Line, type LogRow } from './model';

export interface HitTapeProps {
    log: LogRow[];
    cat: Category;
    line: Line;
    /** Bars to draw (the newest `games`). */
    games?: number;
    size?: 'row' | 'compact' | 'detail';
    className?: string;
}

const SIZES = {
    row: { bar: 6, gap: 2, h: 32, top: 0, bottom: 0 },
    compact: { bar: 4, gap: 2, h: 30, top: 0, bottom: 0 },
    detail: { bar: 20, gap: 7, h: 84, top: 14, bottom: 16 },
} as const;

/**
 * A skater's recent games as bars against the line: one bar per game, oldest
 * to newest, lit cyan when the game cleared the line, dim when it did not.
 * Last season's games sit at reduced strength behind a seam. The dashed rule
 * is the line (k - 0.5), so a bar crossing it cashed the over.
 */
export function HitTape({ log, cat, line, games = 20, size = 'row', className }: HitTapeProps) {
    const s = SIZES[size];
    const rows = log.slice(-games);
    const values = rows.map(r => cat.value(r));
    const max = Math.max(line.k + 1, ...values, 3);
    const plot = s.h;
    const width = games * (s.bar + s.gap) - s.gap;
    const height = s.top + plot + s.bottom;
    const y = (v: number) => s.top + plot - (v / max) * plot;
    const offset = games - rows.length; // short logs are right-aligned (newest at the right edge)
    const seam = rows.findIndex(r => r[8] === 0);
    const hits = values.filter(v => v >= line.k).length;
    const label = rows.length
        ? `Last ${rows.length} games, ${cat.stat} ${line.label}: ${hits} of ${rows.length} over. Newest last: ${values.join(', ')}`
        : 'No games logged';

    return (
        <svg
            role="img"
            aria-label={label}
            viewBox={`0 0 ${width} ${height}`}
            width={width}
            height={height}
            className={cn('block shrink-0 overflow-visible', className)}
        >
            {rows.map((r, i) => {
                const v = values[i];
                const hit = v >= line.k;
                const x = (offset + i) * (s.bar + s.gap);
                const top = v > 0 ? y(v) : s.top + plot - 2;
                const prev = r[8] === 1;
                return (
                    <g key={`${r[0]}-${i}`} opacity={prev ? 0.5 : 1}>
                        <title>{`${shortDate(r[0])} ${r[2] ? 'vs' : '@'} ${r[1]}: ${v} ${cat.stat}${prev ? ' (last season)' : ''}`}</title>
                        <rect
                            x={x}
                            y={top}
                            width={s.bar}
                            height={s.top + plot - top}
                            rx={size === 'detail' ? 2 : 1}
                            className={cn(
                                'transition-[fill] duration-200 ease-out motion-reduce:transition-none',
                                hit ? 'fill-brand' : v > 0 ? 'fill-[var(--mute)]' : 'fill-[var(--line-strong)]',
                            )}
                        />
                        {size === 'detail' ? (
                            <>
                                <text x={x + s.bar / 2} y={top - 3} textAnchor="middle" className={cn('text-micro tabular-nums', hit ? 'fill-fg-1' : 'fill-fg-3')}>
                                    {v}
                                </text>
                                <text x={x + s.bar / 2} y={s.top + plot + 12} textAnchor="middle" className="fill-fg-3 text-micro uppercase">
                                    {r[1]}
                                </text>
                            </>
                        ) : null}
                    </g>
                );
            })}
            {seam > 0 ? (
                <line
                    x1={(offset + seam) * (s.bar + s.gap) - s.gap / 2}
                    x2={(offset + seam) * (s.bar + s.gap) - s.gap / 2}
                    y1={s.top - 2}
                    y2={s.top + plot + 2}
                    className="stroke-fg-3"
                    strokeWidth={1}
                />
            ) : null}
            {/* The line: a solid hairline that slides to the new threshold while the bars re-light. */}
            <line
                x1={-2}
                x2={width + 2}
                y1={0}
                y2={0}
                className="stroke-fg-1 transition-transform duration-200 ease-out motion-reduce:transition-none"
                strokeOpacity={0.7}
                strokeWidth={1}
                style={{ transform: `translateY(${y(line.k - 0.5)}px)` }}
            />
        </svg>
    );
}

export default HitTape;
