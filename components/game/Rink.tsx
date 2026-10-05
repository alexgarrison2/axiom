import * as React from 'react';

/**
 * NHL rink markings in feet (200 x 85, corner radius 28), drawn for the dark
 * ground. `half` draws one offensive zone (x 25..100) for heat maps.
 */
export function RinkMarkings({ half = false }: { half?: boolean }) {
    const ice = 'var(--surface-2)';
    const red = 'rgb(var(--neg-rgb) / 0.45)';
    const blue = 'rgb(var(--goalie-rgb) / 0.55)';
    const faint = 'rgb(var(--text-1-rgb) / 0.12)';
    const ends = half ? [1] : [-1, 1];
    return (
        <g>
            <path
                d={
                    half
                        ? 'M0,-42.5 H72 A28,28 0 0 1 100,-14.5 V14.5 A28,28 0 0 1 72,42.5 H0 Z'
                        : 'M-72,-42.5 H72 A28,28 0 0 1 100,-14.5 V14.5 A28,28 0 0 1 72,42.5 H-72 A28,28 0 0 1 -100,14.5 V-14.5 A28,28 0 0 1 -72,-42.5 Z'
                }
                fill={ice}
                stroke="var(--line-strong)"
                strokeWidth={0.6}
            />
            {!half ? (
                <>
                    <line x1={0} x2={0} y1={-42.5} y2={42.5} stroke={red} strokeWidth={1} />
                    <circle cx={0} cy={0} r={15} fill="none" stroke={blue} strokeWidth={0.4} />
                    <circle cx={0} cy={0} r={0.6} fill={blue} />
                </>
            ) : null}
            {ends.map(s => (
                <g key={s}>
                    <line x1={25 * s} x2={25 * s} y1={-42.5} y2={42.5} stroke={blue} strokeWidth={1} />
                    <line x1={89 * s} x2={89 * s} y1={-38.6} y2={38.6} stroke={red} strokeWidth={0.4} />
                    {/* Crease and net. */}
                    <path d={`M${89 * s},-4 A6,6 0 0 ${s > 0 ? 0 : 1} ${89 * s},4`} fill={faint} stroke={red} strokeWidth={0.3} />
                    <rect x={s > 0 ? 89 : -93} y={-3} width={4} height={6} fill="none" stroke={faint} strokeWidth={0.5} />
                    {[-22, 22].map(y => (
                        <g key={y}>
                            <circle cx={69 * s} cy={y} r={15} fill="none" stroke={red} strokeWidth={0.3} />
                            <circle cx={69 * s} cy={y} r={0.9} fill={red} />
                            <circle cx={20 * s} cy={y} r={0.9} fill={red} />
                        </g>
                    ))}
                </g>
            ))}
        </g>
    );
}
