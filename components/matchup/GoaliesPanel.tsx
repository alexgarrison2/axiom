'use client';

import type { GoalieView, Prediction, SideData } from '@/types/prediction';
import { CUR_TAG, PREV_TAG, SMALL_SAMPLE_GP, fmtSigned, fmtSv, gsaxHeadline, lastName, parseGoalieLine, relAge, shortAge, windowTag } from '@/lib/matchup/format';
import { SeasonTag } from '@/components/ui/stat-chip';
import { GOALIE_TONE, goalieStatus } from './TeamSide';
import { GoalieGlyph } from './GoalieGlyph';
import { DetailsLoading, type DetailsState } from './DetailsLoading';
import { cn } from '@/lib/utils';

type Line = GoalieView['cur'];

type Parts = { record: string; sv: string; gaa: string };

/** Record / SV% / GAA from a structured line or the CSV "(W-L-OTL) | .SV% | GAA" text. */
function lineParts(l?: Line, text?: string | null): Parts | null {
    if (l) return { record: `${l.w}-${l.l}-${l.ot}`, sv: fmtSv(l.svpct), gaa: l.gaa.toFixed(2) };
    const g = parseGoalieLine(text);
    return g ? { record: g.record, sv: g.sv, gaa: g.gaa } : null;
}

/** The three figures as separate, evenly spaced cells so they never read as one run of digits. */
function Figures({ f }: { f: Parts }) {
    return (
        <span className="inline-flex items-baseline gap-4">
            <span>{f.record}</span>
            <span>{f.sv}</span>
            <span>{f.gaa}</span>
        </span>
    );
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

const TONE_CLASS = { pos: 'text-pos', neg: 'text-neg', neutral: 'text-fg-1' } as const;

/** The projected starter's tile: status, regressed GSAx, season lines, vs opponent, playoffs. */
function StarterTile({ s, opp, now, view }: { s: SideData; opp: string; now: Date; view?: GoalieView }) {
    const st = goalieStatus(s.goalieStatus);
    const at = shortAge(s.goalieStatusAt, now);
    const curGp = s.goalieCurGp ?? 0;
    const cur = lineParts(undefined, curGp >= 1 ? s.goalieCur : null);
    const prev = lineParts(undefined, s.goaliePrev);
    const window = view?.gsaxSeason ?? null;
    const head = s.gsax != null ? gsaxHeadline(s.gsax, curGp) : null;
    // Until he has a real sample this season the rating is last season's (or the seasons it spans).
    const tag = head?.prior ? (windowTag(window) ?? PREV_TAG) : null;
    return (
        <div className="tile flex min-w-0 flex-col gap-3">
            {/* The injury chip wraps under the name rather than squeezing it (never under 7 characters). */}
            <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
                <span className="flex min-w-[7ch] max-w-full flex-col">
                    <span data-goalie-name className={cn('truncate font-display text-title font-bold uppercase tracking-[0.02em]', s.goalie ? GOALIE_TONE[st.tone] : 'text-fg-2')}>
                        {s.goalie ? <GoalieGlyph tone={st.tone} /> : null}
                        {s.goalie ? lastName(s.goalie) : 'TBD'}
                    </span>
                    <span className="text-micro uppercase tracking-wide text-fg-3" title={[st.label, s.goalieStatusSource === 'DFO' ? 'DailyFaceoff' : s.goalieStatusSource, relAge(s.goalieStatusAt, now)].filter(Boolean).join(' · ')}>
                        {[st.label, srcName(s.goalieStatusSource), at].filter(Boolean).join(' · ')}
                    </span>
                </span>
                <InjuryTag injury={view?.injury} />
            </div>
            {s.gsax != null && head ? (
                <div className="flex items-center gap-2" title={`Regressed GSAx per game${window ? `, ${window}` : ''}${head.prior ? ` (under ${SMALL_SAMPLE_GP} GP this season)` : ''}`}>
                    <span data-gsax-headline className={cn('font-display text-[22px] font-bold leading-6 tabular-nums', TONE_CLASS[head.tone])}>
                        {fmtSigned(s.gsax)}
                    </span>
                    <span className="text-micro uppercase tracking-wide text-fg-3">GSAx/gm</span>
                    {tag ? (
                        <SeasonTag>
                            {tag}
                            <span className="sr-only"> rating</span>
                        </SeasonTag>
                    ) : null}
                </div>
            ) : null}
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-5 gap-y-2.5 text-caption">
                <Row k={CUR_TAG} dim={!cur}>
                    {cur ? <Figures f={cur} /> : '0 GP'}
                </Row>
                {prev ? (
                    <Row k={PREV_TAG} dim>
                        <Figures f={prev} />
                    </Row>
                ) : null}
                {view?.gsaxCur != null && view.gsaxCurGp ? (
                    <Row k={`GSAx/GS ${CUR_TAG}`}>
                        <span data-gsax-cur>{fmtSigned(view.gsaxCur)}</span> <span className="text-fg-3">· {view.gsaxCurGp} GS</span>
                    </Row>
                ) : null}
                {s.vsOpp ? (
                    <Row k={`vs ${opp}`}>
                        <Figures f={{ record: s.vsOpp.record, sv: fmtSv(s.vsOpp.sv), gaa: s.vsOpp.gaa.toFixed(2) }} />
                    </Row>
                ) : null}
                {s.goaliePo ? <Row k="Career PO">{s.goaliePo.replace(/\s*\|\s*/g, ' ')}</Row> : null}
            </dl>
        </div>
    );
}

function Backup({ g }: { g: GoalieView }) {
    const cur = lineParts(g.cur);
    const prev = lineParts(g.prev);
    const tag = (g.cur?.gp ?? 0) < SMALL_SAMPLE_GP ? windowTag(g.gsaxSeason) : null;
    return (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-line pt-2.5 text-caption">
            {/* Name first: the IR chip and the stat lines wrap to the next line before the name loses a letter. */}
            <span className="flex min-w-0 max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5">
                <span data-goalie-name className="min-w-[7ch] max-w-full shrink-0 truncate font-display font-bold uppercase text-fg-2">
                    {lastName(g.name)}
                </span>
                <InjuryTag injury={g.injury} />
            </span>
            <span className="ml-auto flex flex-col items-end gap-1 tabular-nums">
                {cur ? (
                    <span className="text-fg-1">
                        <span className="mr-2 text-micro text-fg-3">{CUR_TAG}</span>
                        <Figures f={cur} />
                    </span>
                ) : null}
                {prev ? (
                    <span className="text-fg-3">
                        <span className="mr-2 text-micro">{PREV_TAG}</span>
                        <Figures f={prev} />
                    </span>
                ) : null}
                {g.gsaxPerGame != null ? (
                    <span className="flex items-center gap-1 text-micro text-fg-3" title={g.gsaxSeason ? `Regressed GSAx per game, ${g.gsaxSeason}` : undefined}>
                        {fmtSigned(g.gsaxPerGame)} GSAx/gm
                        {tag ? <SeasonTag>{tag}</SeasonTag> : null}
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
                                        <div className="flex flex-col gap-2.5 px-1">
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
