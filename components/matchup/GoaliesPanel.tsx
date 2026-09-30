'use client';

import type { GoalieView, Prediction, SideData } from '@/types/prediction';
import { CUR_TAG, PREV_TAG, fmtSigned, fmtSv, lastName, parseGoalieLine, relAge } from '@/lib/matchup/format';
import { GOALIE_TONE, goalieStatus } from './TeamSide';
import { DetailsLoading, type DetailsState } from './DetailsLoading';
import { cn } from '@/lib/utils';

type Line = GoalieView['cur'];

/** "29-24-2 .906 2.68" from a structured line or the CSV "(W-L-OTL) | .SV% | GAA" text. */
function lineText(l?: Line, text?: string | null): string | null {
    if (l) return `${l.w}-${l.l}-${l.ot} ${fmtSv(l.svpct)} ${l.gaa.toFixed(2)}`;
    const g = parseGoalieLine(text);
    return g ? `${g.record} ${g.sv} ${g.gaa}` : (text ?? null);
}

/** One label / value row of a goalie tile. */
function Row({ k, children, dim }: { k: React.ReactNode; children: React.ReactNode; dim?: boolean }) {
    return (
        <div className="contents">
            <dt className="whitespace-nowrap text-micro uppercase tracking-wide text-fg-3">{k}</dt>
            <dd className={cn('min-w-0 truncate tabular-nums', dim ? 'text-fg-3' : 'text-fg-1')}>{children}</dd>
        </div>
    );
}

function InjuryTag({ injury }: { injury: GoalieView['injury'] }) {
    if (!injury) return null;
    return (
        <span className="shrink-0 rounded-chip border border-neg/40 px-1 text-micro font-bold text-neg">
            {injury.status}
            {injury.returnLabel ? ` · ~${injury.returnLabel}` : ''}
        </span>
    );
}

const srcName = (src: string | null) => (src === 'DFO' ? 'DFO' : src);

/** The projected starter's tile: status, regressed GSAx, season lines, vs opponent, playoffs. */
function StarterTile({ s, opp, now, view }: { s: SideData; opp: string; now: Date; view?: GoalieView }) {
    const st = goalieStatus(s.goalieStatus);
    const at = relAge(s.goalieStatusAt, now);
    const cur = lineText(undefined, (s.goalieCurGp ?? 0) >= 1 ? s.goalieCur : null);
    const prev = lineText(undefined, s.goaliePrev);
    const window = view?.gsaxSeason ?? null;
    return (
        <div className="tile flex min-w-0 flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
                <span className="flex min-w-0 flex-col">
                    <span className={cn('truncate font-display text-title font-bold uppercase tracking-[0.02em]', s.goalie ? GOALIE_TONE[st.tone] : 'text-fg-2')}>
                        {s.goalie ? lastName(s.goalie) : 'TBD'}
                    </span>
                    <span className="text-micro uppercase tracking-wide text-fg-3">{[st.label, srcName(s.goalieStatusSource), at].filter(Boolean).join(' · ')}</span>
                </span>
                <InjuryTag injury={view?.injury} />
            </div>
            {s.gsax != null ? (
                <div className="flex items-baseline gap-2" title={window ? `Regressed rating, ${window}` : 'Regressed multi-season rating'}>
                    <span className={cn('font-display text-[22px] font-bold leading-6 tabular-nums', s.gsax > 0.05 ? 'text-pos' : s.gsax < -0.05 ? 'text-neg' : 'text-fg-1')}>{fmtSigned(s.gsax)}</span>
                    <span className="text-micro uppercase tracking-wide text-fg-3">
                        GSAx/gm<span className="sr-only"> rating (regressed{window ? `, ${window}` : ''})</span>
                    </span>
                </div>
            ) : null}
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 text-caption">
                <Row k={CUR_TAG} dim={!cur}>
                    {cur ?? '0 GP'}
                </Row>
                {prev ? (
                    <Row k={PREV_TAG} dim>
                        {prev}
                    </Row>
                ) : null}
                {view?.gsaxCur != null && view.gsaxCurGp ? (
                    <Row k={`GSAx ${CUR_TAG}`}>
                        {fmtSigned(view.gsaxCur)} <span className="text-fg-3">· {view.gsaxCurGp} GP</span>
                    </Row>
                ) : null}
                {s.vsOpp ? (
                    <Row k={`vs ${opp}`}>
                        {s.vsOpp.record} {fmtSv(s.vsOpp.sv)} {s.vsOpp.gaa.toFixed(2)}
                    </Row>
                ) : null}
                {s.goaliePo ? <Row k="Career PO">{s.goaliePo.replace(/\s*\|\s*/g, ' ')}</Row> : null}
            </dl>
        </div>
    );
}

function Backup({ g }: { g: GoalieView }) {
    const cur = lineText(g.cur);
    const prev = lineText(g.prev);
    return (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-2 border-t border-line pt-1.5 text-caption">
            <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate font-display font-bold uppercase text-fg-2">{lastName(g.name)}</span>
                <InjuryTag injury={g.injury} />
            </span>
            <span className="flex flex-col items-end tabular-nums">
                {cur ? (
                    <span className="text-fg-1">
                        <span className="text-micro text-fg-3">{CUR_TAG}</span> {cur}
                    </span>
                ) : null}
                {prev ? (
                    <span className="text-fg-3">
                        <span className="text-micro">{PREV_TAG}</span> {prev}
                    </span>
                ) : null}
                {g.gsaxPerGame != null ? (
                    <span className="text-micro text-fg-3" title={g.gsaxSeason ? `Regressed rating, ${g.gsaxSeason}` : undefined}>
                        {fmtSigned(g.gsaxPerGame)} GSAx/gm
                    </span>
                ) : null}
            </span>
        </div>
    );
}

/** Projected starters and the rest of each tandem, away left / home right. */
export function GoaliesPanel({ p, state }: { p: Prediction; state: DetailsState }) {
    const now = new Date();
    return (
        <div className="grid grid-cols-1 gap-2.5 cq-sm:grid-cols-2">
            {(['away', 'home'] as const).map(side => {
                const s = p[side];
                const opp = p[side === 'home' ? 'away' : 'home'].team.triCode;
                const view = state.status === 'ready' ? state.data?.[side].goalies.find(g => g.starter) : undefined;
                return (
                    <section key={side} aria-label={`${s.team.commonName} goalies`} className="flex min-w-0 flex-col gap-1.5">
                        <h3 className="label">{s.team.triCode}</h3>
                        <StarterTile s={s} opp={opp} now={now} view={view} />
                        {state.status === 'ready' ? (
                            <DetailsLoading state={state}>
                                {d => {
                                    const others = d[side].goalies.filter(g => !g.starter);
                                    return others.length ? (
                                        <div className="flex flex-col gap-1.5 px-1">
                                            {others.map(g => (
                                                <Backup key={g.name} g={g} />
                                            ))}
                                        </div>
                                    ) : null;
                                }}
                            </DetailsLoading>
                        ) : null}
                    </section>
                );
            })}
        </div>
    );
}

export default GoaliesPanel;
