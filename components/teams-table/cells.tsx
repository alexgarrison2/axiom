import * as React from 'react';
import { cn } from '@/lib/utils';
import { signed } from '@/utils/team-stats/format';
import type { Record3, TeamExtra, TeamProjection, TeamRatingEntry, TeamStat } from '@/utils/team-stats/types';
import type { StatColumn } from './columns';

/**
 * Drawn cells for the league table's lenses. Colour keeps its one meaning:
 * magenta is the model's number, green / red the sign of a difference, ink
 * and dim the league's top and bottom. Every mark has its value in text.
 */

const ord = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;

export const Dash = () => <span className="text-fg-disabled">—</span>;

/** A value with its league rank beside it: "3.47 3rd". */
export function Ordinal({ text, rank }: { text: string; rank?: number }) {
    return (
        <span className="inline-flex items-baseline justify-end">
            {text}
            <span className="ml-1.5 inline-block min-w-[3.4ch] text-left text-micro font-normal text-fg-3">{rank ? ord(rank) : ''}</span>
        </span>
    );
}

/** Centred bar: the model's number (magenta) or a share around 50% (green / red). */
export function CentreBar({ v, mid, span, text, tone, width = 96 }: { v: number; mid: number; span: number; text: string; tone: 'model' | 'sign'; width?: number }) {
    const w = Math.min(1, Math.abs(v - mid) / span) * 50;
    const up = v >= mid;
    const fill = tone === 'model' ? 'bg-model' : up ? 'bg-pos/75' : 'bg-neg/75';
    return (
        <span className="inline-flex items-center gap-2.5">
            <span className={cn('relative block rounded-[2px] bg-line', tone === 'model' ? 'h-2' : 'h-1.5')} style={{ width }} aria-hidden="true">
                <span className="absolute -inset-y-[3px] left-1/2 w-px bg-fg-3" />
                <span className={cn('absolute inset-y-0 rounded-[2px]', fill)} style={up ? { left: '50%', width: `${w}%` } : { right: '50%', width: `${w}%` }} />
            </span>
            <span className={cn('min-w-[5ch] text-right', tone === 'model' ? 'font-bold text-model' : 'text-fg-1')}>{text}</span>
        </span>
    );
}

/** Slim playoff-odds bar with the percentage beside it. */
export function OddsBar({ pct }: { pct: number }) {
    return (
        <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="relative block h-1 w-11 overflow-hidden rounded-[2px] bg-line">
                <span className="absolute inset-y-0 left-0 bg-model/70" style={{ width: `${Math.max(1.5, Math.min(100, pct))}%` }} />
                <span className="absolute inset-y-0 left-1/2 w-px bg-bg" />
            </span>
            <span className="min-w-[4ch] text-right font-semibold text-model">{pct < 1 ? '<1' : Math.round(pct)}%</span>
        </span>
    );
}

/** Projected points: a magenta tick on the likely-range band, value beside. */
export function ProjRange({ p, lo, hi }: { p: TeamProjection; lo: number; hi: number }) {
    const pc = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
    return (
        <span className="inline-flex items-center gap-2" title={`Projected ${Math.round(p.points)} points; likely ${p.p10}–${p.p90}`}>
            <span aria-hidden="true" className="relative block h-2.5 w-[120px]">
                <span className="absolute inset-x-0 top-1 h-0.5 bg-line" />
                {Number.isFinite(p.p10) && Number.isFinite(p.p90) ? (
                    <span className="absolute top-[3px] h-1 rounded-[2px] bg-model/35" style={{ left: pc(p.p10), width: `calc(${pc(p.p90)} - ${pc(p.p10)})` }} />
                ) : null}
                <span className="absolute top-0 -ml-px h-2.5 w-0.5 rounded-[1px] bg-model" style={{ left: pc(p.points) }} />
            </span>
            <span className="min-w-[3ch] text-right font-semibold text-model">{Math.round(p.points)}</span>
        </span>
    );
}

/** W–L–OT with the separators dimmed. */
export function RecordCell({ rec, strong }: { rec: Record3; strong?: boolean }) {
    if (rec[0] + rec[1] + rec[2] === 0) return <Dash />;
    return (
        <span className={cn('inline-flex items-baseline', strong ? 'text-fg-1' : 'text-fg-2')}>
            {rec.map((n, i) => (
                <React.Fragment key={i}>
                    {i ? <span className="mx-0.5 text-fg-3">–</span> : null}
                    <span className="min-w-[1.2ch] text-center">{n}</span>
                </React.Fragment>
            ))}
        </span>
    );
}

export function Streak({ s }: { s: string | null }) {
    if (!s) return <Dash />;
    return <span className={s.startsWith('W') ? 'text-pos' : s.startsWith('L') ? 'text-neg' : 'text-fg-2'}>{s}</span>;
}

/** Bars from a midline: up (green) above, down (red) below, height by size. */
function Strip({ vals, scale, title }: { vals: number[]; scale: number; title: string }) {
    return (
        <span className="inline-flex h-6 items-center gap-0.5 align-middle" title={title}>
            {vals.map((v, i) => {
                const h = Math.max(2, Math.min(12, Math.abs(v) * scale));
                return (
                    <span key={i} className="relative block h-6 w-1.5">
                        <span className="absolute inset-x-[-1px] top-3 h-px bg-line-strong" />
                        <span className={cn('absolute inset-x-0 rounded-[1px]', v >= 0 ? 'bottom-3 bg-pos/80' : 'top-3 bg-neg/80')} style={{ height: h }} />
                    </span>
                );
            })}
        </span>
    );
}

/** Each game's xG share against 50%, oldest to newest. */
export function FormTape({ extra }: { extra: TeamExtra | undefined }) {
    if (!extra?.form.length) return <Dash />;
    const title = extra.form.map(f => `${f.home ? 'vs' : '@'} ${f.opp} ${f.gf}-${f.ga}, xG ${Math.round(f.xs * 100)}%`).join(' · ');
    return <Strip vals={extra.form.map(f => f.xs - 0.5)} scale={53} title={title} />;
}

const LINES = ['f1', 'f2', 'f3', 'f4'] as const;
const PAIRS = ['d1', 'd2', 'd3'] as const;

/** Header for the depth cells: labels over each cell. */
export function DepthHeader() {
    return (
        <span className="inline-flex items-center gap-[3px]">
            {LINES.map(k => (
                <b key={k} className="w-5 text-center font-medium">{k.toUpperCase()}</b>
            ))}
            <span className="w-2.5" />
            {PAIRS.map(k => (
                <b key={k} className="w-5 text-center font-medium">{k.toUpperCase()}</b>
            ))}
        </span>
    );
}

/** Each line and pair as a cell, green or red, brighter = bigger. */
export function DepthCells({ r }: { r: TeamRatingEntry | undefined }) {
    if (!r) return <Dash />;
    const cell = (k: (typeof LINES)[number] | (typeof PAIRS)[number]) => {
        const v = r.lines[k];
        const a = 0.06 + Math.min(1, Math.abs(v) / 0.6) * 0.5;
        return (
            <span
                key={k}
                title={`${k.toUpperCase()} ${signed(v, 2)}`}
                className="block h-3 w-5 rounded-[2px]"
                style={{ background: `rgb(var(${v >= 0 ? '--pos-rgb' : '--neg-rgb'}) / ${a.toFixed(2)})` }}
            />
        );
    };
    return (
        <span className="inline-flex items-center gap-[3px] align-middle">
            {LINES.map(cell)}
            <span className="w-2.5" />
            {PAIRS.map(cell)}
        </span>
    );
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** Time leading | tied | trailing per game as one bar, leading time left, trailing right. */
export function Flow({ row }: { row: TeamStat }) {
    const a = row.time_leading_per_game;
    const b = row.time_tied_per_game;
    const c = row.time_trailing_per_game;
    const s = a + b + c;
    if (!(s > 0)) return <Dash />;
    return (
        <span className="inline-flex items-center gap-2" title={`Leading ${mmss(a)} · tied ${mmss(b)} · trailing ${mmss(c)} per game`}>
            <span className="min-w-[4.2ch] text-right text-fg-1">{mmss(a)}</span>
            <span aria-hidden="true" className="flex h-2.5 w-[180px] gap-px overflow-hidden rounded-[2px]">
                <span className="block bg-pos/75" style={{ width: `${(a / s) * 100}%` }} />
                <span className="block bg-line-strong" style={{ width: `${(b / s) * 100}%` }} />
                <span className="block bg-neg/75" style={{ width: `${(c / s) * 100}%` }} />
            </span>
            <span className="min-w-[4.2ch] text-left text-fg-2">{mmss(c)}</span>
        </span>
    );
}

/** "3/14" aligned on the slash. */
export function Frac({ n, d }: { n: number; d: number }) {
    return (
        <span className="inline-flex items-baseline text-micro text-fg-3">
            <span className="min-w-[2ch] text-right">{n}</span>
            <span className="mx-px text-fg-disabled">/</span>
            <span className="min-w-[2ch] text-left">{d}</span>
        </span>
    );
}

/** Signed value, green above / red below the column's threshold. */
export function SignedText({ col, v }: { col: StatColumn; v: number }) {
    const t = col.signAt ?? 0;
    return <span className={v > t ? 'text-pos' : v < -t ? 'text-neg' : 'text-fg-2'}>{col.format(v)}</span>;
}
