import * as React from 'react';
import { cn } from '@/lib/utils';
import { shortDate, type Category, type ExtRow, type Line, type LogRow } from './model';

export interface GameLogProps {
    log: LogRow[];
    /** Detail rows matched to `log` (null while the detail file loads or for a game it lacks). */
    ext: (ExtRow | null)[];
    cat: Category;
    line: Line;
}

const BAR = 24;
const COL = 36; // bar + gap (fits "@VAN" under each bar)
const LABEL = 40; // row-label gutter
const PLOT = 96;
const TOP = 6;
const ROW = 17;

const minutes = (min: number | null | undefined) => (min == null ? null : min.toFixed(1));

interface StatRow {
    key: string;
    label: string;
    value: (r: LogRow, x: ExtRow | null) => string | number | null;
    /** The category's own count: lit when the game cleared the line. */
    graded?: boolean;
    tone?: 'model';
}

const G: StatRow = { key: 'g', label: 'G', value: r => r[4] };
const A: StatRow = { key: 'a', label: 'A', value: r => r[5] };
const PTS: StatRow = { key: 'pts', label: 'PTS', value: r => r[4] + r[5] };
const SOG: StatRow = { key: 'sog', label: 'SOG', value: r => r[6] };
const ATT: StatRow = { key: 'att', label: 'ATT', value: r => r[9] ?? null };
const TOI: StatRow = { key: 'toi', label: 'TOI', value: r => minutes(r[3]) };
const PP: StatRow = { key: 'pp', label: 'PP', value: (_, x) => minutes(x?.[4]) };
const XG: StatRow = { key: 'xg', label: 'xG', value: (_, x) => (x?.[5] == null ? null : x[5].toFixed(2).replace(/^0/, '')), tone: 'model' };
const PPP: StatRow = { key: 'ppp', label: 'PPP', value: r => r[7] };

/** Box-score rows under the bars, by category: its own count first, then what drives it. */
const ROWS: Record<Category['key'], StatRow[]> = {
    sog: [{ ...SOG, graded: true }, ATT, XG, TOI, PP],
    g: [{ ...G, graded: true }, XG, SOG, ATT, TOI, PP],
    pts: [{ ...PTS, graded: true }, G, A, XG, TOI, PP],
    a: [{ ...A, graded: true }, PTS, TOI, PP],
    ppp: [{ ...PPP, graded: true }, PP, PTS, TOI],
};

/**
 * The opened row's last 20 games: bars against the line (hits lit cyan), shot
 * attempts drawn as a hollow column behind each SOG bar, pony xG as a magenta
 * tick on goal bars, and an aligned box score below (one column per game).
 */
export function GameLog({ log, ext, cat, line }: GameLogProps) {
    const rows = log.slice(-20);
    const xs = ext.slice(-20);
    const stats = ROWS[cat.key];
    const values = rows.map(r => cat.value(r));
    const atts = rows.map(r => r[9] ?? null);
    const showAtt = cat.key === 'sog';
    const showXg = cat.key === 'g';
    const max = Math.max(line.k + 1, ...values, ...(showAtt ? atts.map(a => a ?? 0) : []), 3);
    const y = (v: number) => TOP + PLOT - (v / max) * PLOT;
    const width = LABEL + rows.length * COL;
    const tableTop = TOP + PLOT + 10;
    const height = tableTop + (stats.length + 1) * ROW + 4;
    const seam = rows.findIndex(r => r[8] === 0);
    const hits = values.filter(v => v >= line.k).length;
    const cx = (i: number) => LABEL + i * COL + COL / 2;

    if (!rows.length) return <p className="text-caption text-fg-3">No games logged</p>;

    return (
        <svg
            role="img"
            aria-label={`Last ${rows.length} games, ${cat.stat} ${line.label}: ${hits} of ${rows.length} over. Newest last: ${values.join(', ')}`}
            viewBox={`0 0 ${width} ${height}`}
            width={width}
            height={height}
            className="block shrink-0 font-mono tabular-nums"
        >
            {/* Season seam: last season's games sit dimmed to its left. */}
            {seam > 0 ? <line x1={LABEL + seam * COL} x2={LABEL + seam * COL} y1={TOP - 4} y2={height - 2} className="stroke-line-strong" strokeWidth={1} /> : null}

            {rows.map((r, i) => {
                const v = values[i];
                const hit = v >= line.k;
                const x = cx(i) - BAR / 2;
                const prev = r[8] === 1;
                const top = v > 0 ? y(v) : TOP + PLOT - 2;
                const att = atts[i];
                const ixg = xs[i]?.[5];
                return (
                    <g key={`${r[0]}-${i}`} opacity={prev ? 0.5 : 1}>
                        <title>{`${shortDate(r[0])} ${r[2] ? 'vs' : '@'} ${r[1]}: ${v} ${cat.stat}${showAtt && att != null ? `, ${att} attempts` : ''}${prev ? ' (last season)' : ''}`}</title>
                        {showAtt && att != null && att > 0 ? (
                            <rect x={x + 0.5} y={y(att) + 0.5} width={BAR - 1} height={TOP + PLOT - y(att) - 0.5} rx={2} className="fill-surface-1 stroke-line-strong" strokeWidth={1} />
                        ) : null}
                        <rect
                            x={x}
                            y={top}
                            width={BAR}
                            height={TOP + PLOT - top}
                            rx={2}
                            className={cn(
                                'transition-[fill] duration-200 ease-out motion-reduce:transition-none',
                                hit ? 'fill-brand' : v > 0 ? 'fill-[var(--mute)]' : 'fill-[var(--line-strong)]',
                            )}
                        />
                        {showXg && ixg != null && ixg > 0 ? <line x1={x - 3} x2={x + BAR + 3} y1={y(ixg)} y2={y(ixg)} className="stroke-model" strokeWidth={2} /> : null}
                    </g>
                );
            })}

            {/* The line: bars that cross it cashed the over. */}
            <line
                x1={LABEL - 4}
                x2={width}
                y1={0}
                y2={0}
                className="stroke-fg-1 transition-transform duration-200 ease-out motion-reduce:transition-none"
                strokeOpacity={0.7}
                strokeWidth={1}
                style={{ transform: `translateY(${y(line.k - 0.5)}px)` }}
            />
            <text x={0} y={y(line.k - 0.5) + 4} className="fill-fg-2 text-micro uppercase">
                {line.label}
            </text>

            {/* Box score: one column per game, aligned under its bar. */}
            {stats.map((s, j) => {
                const ty = tableTop + j * ROW + 12;
                return (
                    <g key={s.key}>
                        <text x={0} y={ty} className={cn('text-micro uppercase', s.graded ? 'fill-fg-2' : 'fill-fg-3')}>
                            {s.label}
                        </text>
                        {rows.map((r, i) => {
                            const v = s.value(r, xs[i]);
                            const lit = s.graded && values[i] >= line.k;
                            return (
                                <text
                                    key={i}
                                    x={cx(i)}
                                    y={ty}
                                    textAnchor="middle"
                                    opacity={r[8] === 1 ? 0.6 : 1}
                                    className={cn(
                                        'text-micro',
                                        v == null ? 'fill-[var(--mute)]' : lit ? 'fill-brand font-semibold' : s.graded ? 'fill-fg-1' : s.tone === 'model' ? 'fill-model' : 'fill-fg-2',
                                    )}
                                >
                                    {v ?? '·'}
                                </text>
                            );
                        })}
                    </g>
                );
            })}
            {rows.map((r, i) => (
                <text key={`o${i}`} x={cx(i)} y={tableTop + stats.length * ROW + 12} textAnchor="middle" opacity={r[8] === 1 ? 0.6 : 1} className="fill-fg-3 text-micro uppercase">
                    {r[2] ? '' : '@'}
                    {r[1]}
                </text>
            ))}
        </svg>
    );
}

export default GameLog;
