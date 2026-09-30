import * as React from 'react';
import { cn } from '../../lib/utils';

export interface KpiDelta {
    /** Signed difference vs the baseline, in the KPI's own units. */
    value: number;
    /** What we compare against, e.g. "coin flip", "market", "last season". */
    baseline: string;
    /** Whether a higher value is better (accuracy) or lower is better (Brier, log loss). */
    better: 'higher' | 'lower';
    /** Formatter for the delta (default: 3 decimals with sign). */
    format?: (v: number) => string;
}

export interface KpiTileProps {
    label: React.ReactNode;
    value: React.ReactNode;
    /** Tiny unit/sample under the value, e.g. "GSAx/gm" or "n=412". Not a sentence. */
    sub?: React.ReactNode;
    delta?: KpiDelta | null;
    /** Sparkline values (oldest → newest). */
    spark?: number[];
    /** Optional InfoTip (or any adornment) next to the label. */
    info?: React.ReactNode;
    /** Dim the tile for empty / pending states. */
    empty?: boolean;
    className?: string;
}

const MINUS = '−';
const signed = (v: number, digits = 3) => `${v > 0 ? '+' : v < 0 ? MINUS : '±'}${Math.abs(v).toFixed(digits)}`;

/** A headline metric with an honest comparison against a baseline. */
export function KpiTile({ label, value, sub, delta, spark, info, empty, className }: KpiTileProps) {
    const good = delta ? (delta.better === 'higher' ? delta.value > 0 : delta.value < 0) : false;
    const neutral = delta ? Math.abs(delta.value) < 1e-9 : true;
    return (
        <div className={cn('tile flex min-w-0 flex-col gap-1', className)}>
            <div className="flex items-center gap-1">
                <span className="label">{label}</span>
                {info}
            </div>
            <div className="flex items-end justify-between gap-3">
                <span className={cn('font-display text-[22px] font-bold leading-7 tabular-nums', empty ? 'text-fg-3' : 'text-fg-1')}>{value}</span>
                {spark && spark.length > 1 ? <Sparkline values={spark} className="mb-1" /> : null}
            </div>
            {delta ? (
                <p className="text-micro">
                    <span className={cn('font-bold tabular-nums', neutral ? 'text-fg-2' : good ? 'text-pos' : 'text-neg')}>
                        {(delta.format ?? signed)(delta.value)}
                    </span>{' '}
                    <span className="uppercase tracking-wide text-fg-3">
                        vs {delta.baseline}
                        <span className="sr-only">{neutral ? ' (same)' : good ? ' (better)' : ' (worse)'}</span>
                    </span>
                </p>
            ) : null}
            {sub ? <p className="text-micro tracking-wide text-fg-3">{sub}</p> : null}
        </div>
    );
}

export function Sparkline({ values, width = 72, height = 24, className }: { values: number[]; width?: number; height?: number; className?: string }) {
    const clean = values.filter(v => Number.isFinite(v));
    if (clean.length < 2) return null;
    const min = Math.min(...clean);
    const max = Math.max(...clean);
    const span = max - min || 1;
    const pts = clean.map((v, i) => [(i / (clean.length - 1)) * (width - 2) + 1, height - 1 - ((v - min) / span) * (height - 2)]);
    const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
    const [lx, ly] = pts[pts.length - 1];
    return (
        <svg aria-hidden="true" width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cn('shrink-0 overflow-visible', className)}>
            <path d={d} fill="none" stroke="rgb(var(--brand-rgb))" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={lx} cy={ly} r="2.25" fill="rgb(var(--brand-rgb))" />
        </svg>
    );
}

export default KpiTile;
