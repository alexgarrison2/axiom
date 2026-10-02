import type { ReactNode } from 'react';
import type { InjuryView, LineImpact, LineupPlayerView, SideDetails, TeamRef } from '@/types/prediction';
import { fmtSigned, relAge } from '@/lib/matchup/format';
import { cn } from '@/lib/utils';
import { STRONG } from '@/components/players/model';

const FWD = ['f1', 'f2', 'f3', 'f4'];
const DEF = ['d1', 'd2', 'd3'];

/** Player NET (RAPM, EV xG/60) colour: only the top / bottom tenth of skaters get colour. */
function impactTone(net: number | null): string {
    if (net == null) return 'text-fg-3';
    if (net >= STRONG.net) return 'text-pos';
    if (net > -STRONG.net) return 'text-fg-3';
    return 'text-neg';
}

/** Line rank percentile colour (top / bottom fifth only). */
function lineTone(pct: number): string {
    if (pct >= 80) return 'text-pos';
    if (pct < 20) return 'text-neg';
    return 'text-fg-1';
}

const ord = (n: number) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

function Player({ pl }: { pl: LineupPlayerView | undefined }) {
    if (!pl) return <span className="block text-center text-fg-3">–</span>;
    return (
        <span className="flex min-w-0 flex-col items-center leading-tight" title={pl.name}>
            <span className="flex max-w-full items-center gap-0.5">
                {pl.movement === 'up' ? <span aria-label="moved up" className="text-micro text-pos">▲</span> : null}
                {pl.movement === 'down' ? <span aria-label="moved down" className="text-micro text-neg">▼</span> : null}
                {pl.movement === 'new' ? <span aria-label="new to the lineup" className="text-micro text-warn">+</span> : null}
                <span className={cn('truncate text-caption', pl.ppUnit === 1 ? 'font-bold text-fg-1' : 'text-fg-1')}>{pl.display}</span>
            </span>
            {pl.impact != null || pl.ppUnit ? (
                <span className="flex items-center gap-1 text-micro tabular-nums">
                    {pl.impact != null ? <span className={impactTone(pl.impact)}>{fmtSigned(pl.impact)}</span> : null}
                    {pl.ppUnit ? <span className={pl.ppUnit === 1 ? 'text-warn' : 'text-fg-3'}>PP{pl.ppUnit}</span> : null}
                </span>
            ) : null}
        </span>
    );
}

function LineCell({ imp }: { imp: LineImpact | null | undefined }) {
    if (!imp)
        return (
            <span title="unrated" className="block text-right text-micro text-fg-3">
                —<span className="sr-only"> unrated</span>
            </span>
        );
    return (
        <span className={cn('flex flex-col items-end leading-tight tabular-nums', lineTone(imp.pct))} title={`${ord(imp.rank)} of ${imp.outOf}`}>
            <span className="text-caption font-bold">{fmtSigned(imp.total, 2)}</span>
            <span className="text-micro text-fg-3">
                {imp.rank}/{imp.outOf}
            </span>
        </span>
    );
}

function Table({ keys, cols, d, label }: { keys: string[]; cols: string[]; d: SideDetails; label: string }) {
    const tpl = cols.length === 3 ? 'grid-cols-[1.5rem_repeat(3,minmax(0,1fr))_2.5rem]' : 'grid-cols-[1.5rem_repeat(2,minmax(0,1fr))_2.5rem]';
    return (
        <div role="table" aria-label={label} className="overflow-hidden rounded-[10px] border border-line">
            <div role="row" className={cn('grid items-center gap-1 border-b border-line px-2 py-1 text-micro font-medium uppercase tracking-wide text-fg-3', tpl)}>
                <span role="columnheader">
                    <span className="sr-only">Line</span>
                </span>
                {cols.map(c => (
                    <span role="columnheader" key={c} className="text-center">
                        {c}
                    </span>
                ))}
                <span role="columnheader" className="text-right">
                    Line
                </span>
            </div>
            {keys.map((k, i) => (
                <div role="row" key={k} className={cn('grid min-h-8 items-center gap-1 px-2 py-0.5', tpl, i % 2 === 1 && 'bg-line/35')}>
                    <span role="rowheader" className="text-micro text-fg-3">
                        {k.toUpperCase()}
                    </span>
                    {cols.map((_, j) => (
                        <span role="cell" key={j} className="min-w-0">
                            <Player pl={d.lines[k]?.[j]} />
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
        <ul aria-label="Out" className="flex flex-wrap items-center gap-1 text-micro">
            <li className="font-bold uppercase tracking-wide text-neg">Out</li>
            {items.map(i => (
                <li key={i.name} title={`${i.name} (${i.pos}) · ${i.status}${i.returnLabel ? ` · ~${i.returnLabel}` : ''}`} className="rounded-chip border border-neg/30 px-1.5 py-0.5 text-fg-1">
                    {i.display}
                    <span className="text-fg-3"> {[i.detail ?? i.status, i.returnLabel ? `~${i.returnLabel}` : null].filter(Boolean).join(' ')}</span>
                </li>
            ))}
        </ul>
    );
}

const PART_LABEL = { off: 'OFF', fin: 'FIN', def: 'DEF', net: 'NET' } as const;
const PART_HINT = {
    off: 'Offence: sum of the skaters\' RAPM offence (EV xG/60 above average)',
    fin: 'Finishing: sum of the skaters\' shooting talent beyond shot quality',
    def: 'Defence: sum of the skaters\' RAPM defence (xGA/60 prevented)',
    net: 'Net: sum of the skaters\' RAPM NET (OFF + DEF)',
} as const;

/** Whole-lineup OFF / FIN / DEF / NET as centred bars, each scaled to the league's range for that component. */
function LineupSummary({ grade }: { grade: NonNullable<SideDetails['grade']> }) {
    const parts = grade.parts;
    if (!parts) return null;
    return (
        <div role="group" aria-label="Lineup totals" className="flex flex-col gap-1 rounded-[10px] border border-line px-2.5 py-2">
            {(['off', 'fin', 'def', 'net'] as const).map(k => {
                const part = parts[k];
                const span = Math.max(Math.abs(part.min), Math.abs(part.max), Math.abs(part.value), 0.01);
                const half = Math.min(50, (Math.abs(part.value) / span) * 50);
                const pos = part.value >= 0;
                const isNet = k === 'net';
                return (
                    <div key={k} title={PART_HINT[k]} className="grid grid-cols-[2rem_minmax(0,1fr)_3.25rem_2.75rem] items-center gap-x-2">
                        <span className={cn('text-micro uppercase tracking-wide', isNet ? 'font-bold text-fg-1' : 'text-fg-3')}>{PART_LABEL[k]}</span>
                        <span aria-hidden="true" className={cn('relative rounded-full bg-line', isNet ? 'h-2.5' : 'h-1.5')}>
                            <span className="absolute inset-y-[-2px] left-1/2 w-px bg-fg-3/60" />
                            <span
                                className={cn('absolute inset-y-0 rounded-full', pos ? 'bg-pos/80' : 'bg-neg/80')}
                                style={pos ? { left: '50%', width: `${half}%` } : { right: '50%', width: `${half}%` }}
                            />
                        </span>
                        <span className={cn('text-right tabular-nums', isNet ? 'text-caption font-bold' : 'text-caption', pos ? 'text-pos' : 'text-neg')}>{fmtSigned(part.value, 2)}</span>
                        <span className="text-right text-micro tabular-nums text-fg-3">{part.rank != null ? `${part.rank}/${part.outOf}` : ''}</span>
                    </div>
                );
            })}
        </div>
    );
}

/**
 * One team's projected lineup: forward lines and defence pairs with each
 * player's NET rating (RAPM, EV xG/60), line ranks, the lineup source age and injuries.
 * Presentational: the data comes from /api/matchup-details.
 */
export default function LineupGrid({
    team,
    d,
    now,
    seasonTag,
    titleWideOnly = false,
}: {
    team: TeamRef;
    d: SideDetails;
    now: Date;
    seasonTag?: ReactNode;
    /** The crest + tricode heading shows only on a wide card (a logo toggle names the team on a narrow one). */
    titleWideOnly?: boolean;
}) {
    const hasLines = FWD.some(k => d.lines[k]?.length) || DEF.some(k => d.lines[k]?.length);
    const age = relAge(d.lineupUpdatedAt, now);
    return (
        <section aria-label={`${team.commonName} lineup`} className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className={cn('flex items-center gap-2 text-caption font-bold text-fg-1', titleWideOnly && 'sr-only cq-lg:not-sr-only')}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={team.logoUrl} alt="" width={32} height={32} className="h-8 w-8" />
                    {team.triCode}
                </h3>
                <span className="flex flex-wrap items-center gap-1.5 text-micro uppercase tracking-wide text-fg-3">
                    {d.grade && !d.grade.parts ? (
                        <span className="tabular-nums" title="Lineup NET: sum of the skaters' RAPM NET (EV xG/60)">
                            Net <span className="font-bold text-fg-1">{fmtSigned(d.grade.value, 2)}</span>
                            {d.grade.rank != null ? ` · ${d.grade.rank}/${d.grade.outOf}` : ''}
                        </span>
                    ) : null}
                    {seasonTag}
                    {hasLines && age ? <span title={d.lineupSource ? `${d.lineupSource} via DailyFaceoff` : 'DailyFaceoff'}>· {age}</span> : null}
                </span>
            </div>
            {d.grade?.parts ? <LineupSummary grade={d.grade} /> : null}
            {hasLines ? (
                <>
                    <Table keys={FWD} cols={['LW', 'C', 'RW']} d={d} label={`${team.commonName} forward lines`} />
                    <Table keys={DEF} cols={['LD', 'RD']} d={d} label={`${team.commonName} defence pairs`} />
                </>
            ) : (
                <p className="label">No lineup yet</p>
            )}
            <OutRow items={d.injuries} />
        </section>
    );
}
