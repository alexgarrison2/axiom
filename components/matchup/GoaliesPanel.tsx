'use client';

import type { GoalieView, Prediction, SideData } from '@/types/prediction';
import { InfoTip } from '@/components/ui/info-tip';
import { CUR_TAG, PREV_TAG, fmtSigned, lastName, parseGoalieLine, relAge } from '@/lib/matchup/format';
import { goalieStatus } from './TeamSide';
import { DetailsLoading, type DetailsState } from './DetailsLoading';
import { cn } from '@/lib/utils';

type Line = GoalieView['cur'];

const fmtLine = (l: NonNullable<Line>) => `${l.w}-${l.l}-${l.ot} · ${l.svpct.toFixed(3).replace(/^0/, '')} · ${l.gaa.toFixed(2)}`;

function SeasonLines({ cur, prev, curText, prevText }: { cur?: Line; prev?: Line; curText?: string | null; prevText?: string | null }) {
    const c = cur ? fmtLine(cur) : curText ? (() => { const g = parseGoalieLine(curText); return g ? `${g.record} · ${g.sv} · ${g.gaa}` : curText; })() : null;
    const pv = prev ? fmtLine(prev) : prevText ? (() => { const g = parseGoalieLine(prevText); return g ? `${g.record} · ${g.sv} · ${g.gaa}` : prevText; })() : null;
    return (
        <div className="flex flex-col text-caption tabular-nums">
            <span className={c ? 'text-fg-1' : 'text-fg-2'}>
                <span className="font-mono text-micro text-fg-3">{CUR_TAG}</span> {c ?? 'Season debut'}
            </span>
            {pv ? (
                <span className="text-fg-3">
                    <span className="font-mono text-micro">{PREV_TAG}</span> {pv}
                </span>
            ) : null}
        </div>
    );
}

function StarterCard({ s, opp, now }: { s: SideData; opp: string; now: Date }) {
    const st = goalieStatus(s.goalieStatus);
    const at = relAge(s.goalieStatusAt, now);
    return (
        <div className="flex flex-col gap-1.5 rounded-control border border-line bg-surface-1 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
                <span className="truncate text-body-sm font-bold text-fg-1">{s.goalie ?? 'Starter unknown'}</span>
                <span className={cn('inline-flex shrink-0 items-center gap-1 text-caption font-semibold', st.label === 'Confirmed' ? 'text-pos' : st.label === 'Unconfirmed' ? 'text-fg-2' : 'text-warn')}>
                    <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full', st.dot)} />
                    {st.label}
                </span>
            </div>
            {s.goalieStatusSource || at ? (
                <span className="text-micro text-fg-3">
                    {[s.goalieStatusSource, at].filter(Boolean).join(' · ')}
                </span>
            ) : null}
            <SeasonLines curText={s.goalieCur} prevText={s.goaliePrev} />
            {s.gsax != null ? (
                <span className="flex items-center gap-1 text-caption tabular-nums text-fg-2">
                    <span className={cn('font-semibold', s.gsax > 0.05 ? 'text-pos' : s.gsax < -0.05 ? 'text-neg' : 'text-fg-1')}>{fmtSigned(s.gsax)}</span> GSAx/gm
                    <span className="text-fg-3">({(s.goalieCurGp ?? 0) > 0 ? CUR_TAG : PREV_TAG})</span>
                    <InfoTip term="gsax" />
                </span>
            ) : null}
            {s.vsOpp ? (
                <span className="text-caption tabular-nums text-fg-2">
                    {s.vsOpp.label || `Career vs ${opp}`}: {s.vsOpp.record} · {s.vsOpp.sv.toFixed(3).replace(/^0/, '')} · {s.vsOpp.gaa.toFixed(2)}
                </span>
            ) : null}
            {s.goaliePo ? (
                <span className="text-caption tabular-nums text-playoff">
                    <span className="font-semibold">Career playoffs</span> {s.goaliePo.replace(/\s*\|\s*/g, ' · ')}
                </span>
            ) : null}
        </div>
    );
}

function Backup({ g }: { g: GoalieView }) {
    return (
        <div className="flex items-start justify-between gap-2 px-1 py-1.5">
            <span className="text-caption font-semibold text-fg-1">{lastName(g.name)}</span>
            <div className="flex flex-col items-end gap-0.5">
                <SeasonLines cur={g.cur} prev={g.prev} />
                {g.gsaxPerGame != null ? (
                    <span className="text-micro tabular-nums text-fg-3">
                        {fmtSigned(g.gsaxPerGame)} GSAx/gm ({g.gsaxSeason})
                    </span>
                ) : null}
            </div>
        </div>
    );
}

/** Projected starters (status, source and time), season lines and the rest of each tandem. */
export function GoaliesPanel({ p, state }: { p: Prediction; state: DetailsState }) {
    const now = new Date();
    return (
        <div className="grid grid-cols-1 gap-4 py-1 cq-sm:grid-cols-2">
            {(['away', 'home'] as const).map(side => {
                const s = p[side];
                const opp = p[side === 'home' ? 'away' : 'home'].team.triCode;
                return (
                    <section key={side} aria-label={`${s.team.commonName} goalies`} className="flex flex-col gap-2">
                        <h3 className="hud-label">{s.team.triCode} goalies</h3>
                        <StarterCard s={s} opp={opp} now={now} />
                        <DetailsLoading state={state}>
                            {d => {
                                const others = d[side].goalies.filter(g => !g.starter);
                                return others.length ? (
                                    <div className="flex flex-col divide-y divide-line">
                                        {others.map(g => (
                                            <Backup key={g.name} g={g} />
                                        ))}
                                    </div>
                                ) : null;
                            }}
                        </DetailsLoading>
                    </section>
                );
            })}
        </div>
    );
}

export default GoaliesPanel;
