import type { InjuryView, LineImpact, LineupPlayerView, SideDetails, TeamRef } from '@/types/prediction';
import { fmtSigned, relAge } from '@/lib/matchup/format';
import { cn } from '@/lib/utils';

const FWD = ['f1', 'f2', 'f3', 'f4'];
const DEF = ['d1', 'd2', 'd3'];

function impactTone(z: number | null): string {
    if (z == null) return 'text-fg-3';
    if (z >= 1) return 'text-info';
    if (z >= 0.3) return 'text-info/80';
    if (z > -0.3) return 'text-fg-2';
    if (z > -1) return 'text-warn';
    return 'text-neg';
}

function lineTone(pct: number): string {
    if (pct >= 80) return 'text-info';
    if (pct >= 60) return 'text-info/80';
    if (pct >= 40) return 'text-fg-2';
    if (pct >= 20) return 'text-warn';
    return 'text-neg';
}

const ord = (n: number) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

function Player({ pl }: { pl: LineupPlayerView | undefined }) {
    if (!pl) return <span className="text-center text-fg-3">–</span>;
    return (
        <span className="flex min-w-0 flex-col items-center leading-tight" title={`${pl.name}${pl.impact != null ? ` · impact ${fmtSigned(pl.impact)}` : ''}${pl.ppUnit ? ` · PP${pl.ppUnit}` : ''}`}>
            <span className="flex max-w-full items-center gap-0.5">
                {pl.movement === 'up' ? <span aria-label="moved up" className="text-micro text-pos">▲</span> : null}
                {pl.movement === 'down' ? <span aria-label="moved down" className="text-micro text-neg">▼</span> : null}
                {pl.movement === 'new' ? <span aria-label="new to the lineup" className="text-micro text-warn">+</span> : null}
                <span className={cn('truncate text-caption', pl.ppUnit === 1 ? 'font-bold text-info' : pl.ppUnit === 2 ? 'font-semibold text-fg-1' : 'text-fg-1')}>{pl.display}</span>
            </span>
            {pl.impact != null ? <span className={cn('text-micro tabular-nums', impactTone(pl.impact))}>{fmtSigned(pl.impact)}</span> : null}
        </span>
    );
}

function LineCell({ imp }: { imp: LineImpact | null | undefined }) {
    if (!imp) return <span className="text-center text-micro text-fg-3">—</span>;
    return (
        <span className={cn('flex flex-col items-end leading-tight tabular-nums', lineTone(imp.pct))} title={`Line impact ${fmtSigned(imp.total)} · ${ord(imp.rank)} of ${imp.outOf} current NHL lines in this slot`}>
            <span className="text-caption font-bold">{fmtSigned(imp.total, 1)}</span>
            <span className="text-micro">
                {ord(imp.rank)}/{imp.outOf}
            </span>
        </span>
    );
}

function Table({ keys, cols, d, label }: { keys: string[]; cols: string[]; d: SideDetails; label: string }) {
    const tpl = cols.length === 3 ? 'grid-cols-[1.75rem_repeat(3,minmax(0,1fr))_2.75rem]' : 'grid-cols-[1.75rem_repeat(2,minmax(0,1fr))_2.75rem]';
    return (
        <div role="table" aria-label={label} className="overflow-hidden rounded-control border border-line">
            <div role="row" className={cn('grid items-center gap-1 bg-surface-2 px-2 py-1 text-micro font-semibold uppercase text-fg-2', tpl)}>
                <span role="columnheader">
                    <span className="sr-only">Line</span>
                </span>
                {cols.map(c => (
                    <span role="columnheader" key={c} className="text-center">
                        {c}
                    </span>
                ))}
                <span role="columnheader" className="text-right" title="Sum of the players' impact, ranked against the same line on every team">
                    Line
                </span>
            </div>
            {keys.map(k => (
                <div role="row" key={k} className={cn('grid min-h-[2.1rem] items-center gap-1 border-t border-line px-2 py-0.5', tpl)}>
                    <span role="rowheader" className="font-mono text-micro text-fg-3">
                        {k.toUpperCase()}
                    </span>
                    {cols.map((_, i) => (
                        <span role="cell" key={i} className="min-w-0">
                            <Player pl={d.lines[k]?.[i]} />
                        </span>
                    ))}
                    <span role="cell">
                        <LineCell imp={d.lineImpacts[k]} />
                    </span>
                </div>
            ))}
        </div>
    );
}

function OutRow({ items }: { items: InjuryView[] }) {
    if (!items.length) return null;
    return (
        <div className="flex flex-wrap items-center gap-1.5 text-caption">
            <span className="font-bold uppercase text-neg">Out</span>
            {items.map(i => (
                <span key={i.name} title={`${i.name} (${i.pos}) · ${i.status}${i.returnLabel ? ` · expected back ~${i.returnLabel}` : ''}`} className="rounded-chip border border-neg/30 bg-neg/10 px-1.5 py-0.5 text-fg-1">
                    {i.display}
                    <span className="text-fg-2">
                        {' · '}
                        {[i.detail ?? i.status, i.returnLabel ? `~${i.returnLabel}` : null].filter(Boolean).join(' · ')}
                    </span>
                </span>
            ))}
        </div>
    );
}

/**
 * One team's projected lineup: forward lines and defence pairs with each
 * player's impact (looked up by NHL player id on the server), line ranks,
 * the lineup source and injuries. Presentational: the data comes from
 * /api/matchup-details via lib/client-data.ts.
 */
export default function LineupGrid({ team, d, now }: { team: TeamRef; d: SideDetails; now: Date }) {
    const hasLines = FWD.some(k => d.lines[k]?.length) || DEF.some(k => d.lines[k]?.length);
    const age = relAge(d.lineupUpdatedAt, now);
    return (
        <section aria-label={`${team.commonName} lineup`} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-body-sm font-bold text-fg-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={team.logoUrl} alt="" width={18} height={18} className="h-[18px] w-[18px]" />
                    {team.commonName}
                </h3>
                <span className="flex flex-wrap items-center gap-1.5">
                    {d.grade ? (
                        <span className="rounded-chip border border-line bg-surface-2 px-1.5 py-0.5 text-micro font-semibold tabular-nums text-fg-1" title="Sum of the 18 skaters' impact scores, ranked against every team's current lineup">
                            Grade {fmtSigned(d.grade.value, 1)}
                            {d.grade.rank != null ? <span className="text-fg-2"> · {ord(d.grade.rank)}/{d.grade.outOf}</span> : null}
                        </span>
                    ) : null}
                    {hasLines ? (
                        <span className="rounded-chip border border-dashed border-line-strong px-1.5 py-0.5 text-micro text-fg-2" title={d.lineupSource ? `Source: ${d.lineupSource} via DailyFaceoff` : 'Source: DailyFaceoff'}>
                            Projected{age ? ` · updated ${age}` : ''}
                        </span>
                    ) : null}
                </span>
            </div>
            {hasLines ? (
                <>
                    <Table keys={FWD} cols={['LW', 'C', 'RW']} d={d} label={`${team.commonName} forward lines`} />
                    <Table keys={DEF} cols={['LD', 'RD']} d={d} label={`${team.commonName} defence pairs`} />
                </>
            ) : (
                <p className="text-caption text-fg-2">No projected lineup yet.</p>
            )}
            <OutRow items={d.injuries} />
        </section>
    );
}
