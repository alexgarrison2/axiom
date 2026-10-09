'use client';

import { useEffect, useMemo, useState } from 'react';
import type { GoalieView, InjuryView, PickSummaries, Prediction, RecentGame, Side, SideData } from '@/types/prediction';
import type { GameImplication } from '@/utils/implications';
import type { Phase } from '@/lib/matchup/lifecycle';
import { loadJson } from '@/lib/client-data';
import { modelWeight, pickForm } from '@/lib/matchup/edge';
import { fmtSigned, fmtSv, gsaxHeadline, goalieSeasonLine, shortDate, vsOppTone } from '@/lib/matchup/format';
import { buildEntries, entryStartedBy, recordOfEntries, type FormEntry } from '@/lib/matchup/form';
import { unpackTeamGames, type MatchupGame, type TeamGamesPayload } from '@/lib/matchup/matchup-stats';
import { termHref } from '@/lib/matchup/glossary-links';
import { clashSafePair } from '@/components/ui/team-color';
import { Crest } from '@/components/ui/crest';
import { cn } from '@/lib/utils';
import { WhyThisPick } from './WhyThisPick';
import { ContextChips } from './ContextChips';
import { MatchupPanel, teamGamesUrl } from './MatchupPanel';
import { GOALIE_TONE, goalieStatus } from './TeamSide';
import { GoalieGlyph } from './GoalieGlyph';
import type { DetailsState } from './DetailsLoading';

/**
 * The Preview tab: everything that answers "who wins tonight and why" on one
 * sheet, mirrored like the card (away left, home right, labels down the
 * centre). Left: why the forecast leans, the goalie duel, recent form and who
 * is out. Right: the tale of the tape, filterable to tonight's situation.
 * Lines, prices and news keep their own tabs.
 */

const SIDES: Side[] = ['away', 'home'];
const CONF_WORD: Record<string, string> = { A: 'High', B: 'Medium', C: 'Low' };

function Heading({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
    return (
        <div className="flex items-baseline justify-between gap-3 border-b border-line pb-1">
            <h3 className="label text-fg-2">{children}</h3>
            {aside ? <span className="min-w-0 truncate text-right text-micro text-fg-3">{aside}</span> : null}
        </div>
    );
}

/** One mirrored row: away value · centre label · home value. */
function Mirror({ label, away, home, term }: { label: string; away: React.ReactNode; home: React.ReactNode; term?: string }) {
    const href = term ? termHref(term) : null;
    const cls = 'whitespace-nowrap text-center text-micro font-medium uppercase tracking-wide text-fg-3';
    return (
        <div className="grid min-h-7 grid-cols-[minmax(0,1fr)_5.5rem_minmax(0,1fr)] items-center gap-2 border-t border-line/60 py-1 text-caption first:border-t-0">
            <span className="min-w-0 tabular-nums text-fg-1">{away}</span>
            {href ? (
                <a href={href} className={cn(cls, 'underline decoration-dotted underline-offset-4 hover:text-fg-1')}>
                    {label}
                </a>
            ) : (
                <span className={cls}>{label}</span>
            )}
            <span className="flex min-w-0 justify-end text-right tabular-nums text-fg-1 [&>*]:justify-end">{home}</span>
        </div>
    );
}

const dash = <span className="text-fg-3">—</span>;

/* ── Goalies ──────────────────────────────────────────────────────────── */

function GoalieName({ s, home }: { s: SideData; home: boolean }) {
    if (!s.goalie) return <span className="text-fg-3">Not announced</span>;
    const st = goalieStatus(s.goalieStatus);
    return (
        <span className={cn('flex min-w-0 flex-col', home ? 'items-end' : 'items-start')}>
            <span className={cn('flex min-w-0 items-center gap-1 truncate font-display text-title font-bold uppercase', GOALIE_TONE[st.tone], home && 'flex-row-reverse')}>
                <GoalieGlyph tone={st.tone} />
                <span className="truncate">{s.goalie}</span>
            </span>
            <span className="text-micro uppercase tracking-wide text-fg-3">{st.label}</span>
        </span>
    );
}

function seasonText(s: SideData) {
    const l = goalieSeasonLine(s);
    return l ? (
        <span className="inline-flex gap-2.5">
            <span>{l.record}</span>
            <span>{l.sv}</span>
            <span className="text-fg-2">{l.gaa}</span>
        </span>
    ) : (
        dash
    );
}

function gsaxText(s: SideData, view: GoalieView | undefined) {
    const v = view?.gsaxPerGame;
    if (v == null) return dash;
    const t = gsaxHeadline(v, s.goalieCurGp);
    return <span className={cn('font-bold', t.tone === 'pos' ? 'text-pos' : t.tone === 'neg' ? 'text-neg' : 'text-fg-1')}>{fmtSigned(v)}</span>;
}

function vsText(s: SideData) {
    const vs = s.vsOpp;
    if (!vs) return dash;
    const tone = vsOppTone(vs);
    return (
        <span className={cn(tone === 'good' ? 'font-bold text-pos' : tone === 'poor' ? 'font-bold text-neg' : 'text-fg-1')}>
            {vs.record} {fmtSv(vs.sv)}
        </span>
    );
}

function Goalies({ p, state }: { p: Prediction; state: DetailsState }) {
    const view = (side: Side) => (state.status === 'ready' ? state.data?.[side].goalies.find(g => g.starter) : undefined);
    if (!p.away.goalie && !p.home.goalie) return null;
    return (
        <section aria-label="Goalies" className="flex flex-col gap-1.5">
            <Heading>Goalies</Heading>
            <div className="grid grid-cols-2 gap-3 pt-0.5">
                <GoalieName s={p.away} home={false} />
                <GoalieName s={p.home} home />
            </div>
            <div className="flex flex-col">
                <Mirror label="Season" away={seasonText(p.away)} home={seasonText(p.home)} />
                <Mirror label="GSAx/GP" away={gsaxText(p.away, view('away'))} home={gsaxText(p.home, view('home'))} />
                <Mirror label="Vs opp" away={vsText(p.away)} home={vsText(p.home)} />
            </div>
        </section>
    );
}

/* ── Form ─────────────────────────────────────────────────────────────── */

const RESULT = {
    W: { text: 'W', cls: 'text-pos', label: 'Win' },
    L: { text: 'L', cls: 'text-fg-3', label: 'Loss' },
    OTL: { text: 'OTL', cls: 'text-amber', label: 'Overtime loss' },
} as const;

/** Rest before tonight: amber on a back-to-back. */
function restText(s: SideData): React.ReactNode {
    if (s.isB2b) return <span className="font-bold text-amber">B2B</span>;
    if (s.restDays == null) return null;
    return `${s.restDays}d rest`;
}

/** Plot height of one game's bars, each way from the axis (px). */
const HALF = 44;

/** One side of a game's plot: the xG bar (solid team colour for, outlined grey against) with a white tick at the goals. */
function Half({ xg, goals, scale, color, up }: { xg: number; goals: number; scale: number; color: string | null; up: boolean }) {
    const px = (v: number) => (Math.min(v, scale) / scale) * HALF;
    return (
        <span className={cn('relative flex w-full flex-1 flex-col items-center', up ? 'justify-end' : 'justify-start')}>
            <span
                className={cn('relative w-10', up ? 'rounded-t-[3px]' : 'rounded-b-[3px] border-x border-b')}
                style={{ height: Math.max(2, px(xg)), background: color ?? 'rgb(var(--text-3-rgb) / 0.3)', borderColor: color ? undefined : 'rgb(var(--text-3-rgb) / 0.9)' }}
            />
            {goals > 0 ? <span className="absolute -ml-6 w-12 rounded-full bg-fg-1 shadow-[0_0_4px_rgba(0,0,0,.9)]" style={{ height: 2, left: '50%', [up ? 'bottom' : 'top']: px(goals) - 1 }} /> : null}
        </span>
    );
}

/**
 * One game as a column, oldest left: the result and score on top, then how it
 * really went around an axis: xG for rising in the team colour, xG against
 * hanging below as an outline, a white tick on each at the goals actually
 * scored, all on one scale shared by every game on the sheet; the opponent's
 * crest at the foot. A magenta dot marks a game tonight's goalie started. A
 * game the log has not caught up with shows its result only.
 */
function GameColumn({ e, color, scale, goalie }: { e: FormEntry; color: string; scale: number; goalie: string | null }) {
    const r = e.game?.row;
    const res = RESULT[e.outcome];
    const started = entryStartedBy(e, goalie);
    const label = `${shortDate(e.date)} ${e.home ? 'vs' : 'at'} ${e.opp}: ${res.label} ${e.gf}-${e.ga}${e.extra ? ` ${e.extra}` : ''}${r ? `, xG ${r.xgf.toFixed(1)} to ${r.xga.toFixed(1)}` : ''}${started ? `, ${goalie} started` : ''}`;
    return (
        <li className="flex min-w-0 flex-col items-center gap-1.5" title={label}>
            <span className="sr-only">{label}</span>
            <span aria-hidden="true" className="flex items-baseline gap-1 whitespace-nowrap tabular-nums">
                <span className={cn('text-micro font-bold', res.cls)}>{res.text}</span>
                <span className="text-body font-bold text-fg-1">
                    {e.gf}-{e.ga}
                </span>
                {started ? <span className="h-1.5 w-1.5 self-center rounded-full bg-magenta shadow-[0_0_6px_rgb(var(--model-rgb))]" /> : null}
            </span>
            <span aria-hidden="true" className="flex w-full flex-col items-center" style={{ height: HALF * 2 + 1 }}>
                {r ? (
                    <>
                        <Half xg={r.xgf} goals={e.gf} scale={scale} color={color} up />
                        <span className="h-px w-full bg-line-strong" />
                        <Half xg={r.xga} goals={e.ga} scale={scale} color={null} up={false} />
                    </>
                ) : (
                    <span className="my-auto w-full border-t border-dashed border-line-strong" />
                )}
            </span>
            <span aria-hidden="true" className="flex w-full items-center justify-center gap-1 text-micro tabular-nums text-fg-3">
                {r ? (
                    <span>
                        <b className="font-bold text-fg-1">{r.xgf.toFixed(1)}</b>-{r.xga.toFixed(1)}
                    </span>
                ) : (
                    <span>—</span>
                )}
            </span>
            <span aria-hidden="true" className="flex items-center gap-0.5 text-micro text-fg-3">
                <span>{e.home ? 'vs' : '@'}</span>
                <Crest tri={e.opp} size={24} className="drop-shadow-none" />
            </span>
        </li>
    );
}

function TeamForm({ s, entries, scale, color, outs }: { s: SideData; entries: FormEntry[] | null; scale: number; color: string; outs: InjuryView[] | null }) {
    const tri = s.team.triCode;
    const rec = entries ? recordOfEntries(entries) : null;
    const rest = restText(s);
    return (
        <div className="flex min-w-0 flex-col gap-2">
            <div className="flex items-center gap-2">
                <Crest tri={tri} size={26} className="drop-shadow-none" />
                <span className="font-display text-title font-bold uppercase text-fg-1">{tri}</span>
                {rec ? (
                    <span className="text-caption tabular-nums text-fg-2">
                        {rec.w}-{rec.l}-{rec.otl} <span className="text-micro uppercase tracking-wide text-fg-3">L{entries!.length}</span>
                    </span>
                ) : null}
                {rest ? <span className="ml-auto text-micro uppercase tracking-wide text-fg-3">{rest}</span> : null}
            </div>
            {entries ? (
                entries.length ? (
                    <ol className="grid grid-cols-5 gap-1">
                        {[...entries].reverse().map(e => (
                            <GameColumn key={e.key} e={e} color={color} scale={scale} goalie={s.goalie} />
                        ))}
                    </ol>
                ) : (
                    <p className="label py-6 text-center text-fg-3">No games yet</p>
                )
            ) : (
                <span className="block h-[168px] animate-pulse rounded-[10px] bg-surface-2" />
            )}
            {outs?.length ? (
                <p className="text-caption leading-snug text-fg-2">
                    <span className="mr-1.5 text-micro font-medium uppercase tracking-wide text-fg-3">Out</span>
                    {outs.map((i, k) => (
                        <span key={i.name} title={[i.status, i.detail, i.returnLabel ? `back ~${i.returnLabel}` : null].filter(Boolean).join(' · ')}>
                            {k ? <span className="text-fg-3"> · </span> : null}
                            {i.display}
                        </span>
                    ))}
                </p>
            ) : null}
        </div>
    );
}

const NO_RECENT: RecentGame[] = [];

/** Last five games per team as xG columns, away left and home right, with rest, the season series and who is out. */
function Form({ p, state }: { p: Prediction; state: DetailsState }) {
    const [games, setGames] = useState<Record<Side, MatchupGame[]> | null>(null);
    const a = p.away.team.triCode;
    const h = p.home.team.triCode;
    useEffect(() => {
        let live = true;
        Promise.all([loadJson<TeamGamesPayload>(teamGamesUrl(a)), loadJson<TeamGamesPayload>(teamGamesUrl(h))]).then(
            ([x, y]) => live && setGames({ away: unpackTeamGames(x), home: unpackTeamGames(y) }),
            () => live && setGames({ away: [], home: [] }),
        );
        return () => {
            live = false;
        };
    }, [a, h]);
    const colors = clashSafePair(a, h);
    const d = state.status === 'ready' ? state.data : null;
    const entries = useMemo(() => {
        if (!games) return null;
        const out = {} as Record<Side, FormEntry[]>;
        for (const sd of SIDES) out[sd] = buildEntries(games[sd], d?.[sd].recent ?? NO_RECENT, p.id, p.date, 5);
        return out;
    }, [games, d, p.id, p.date]);
    let scale = 2;
    for (const sd of SIDES) for (const e of entries?.[sd] ?? []) if (e.game) scale = Math.max(scale, e.game.row.xgf, e.game.row.xga, e.gf, e.ga);
    const h2h = p.away.h2hRecord || p.home.h2hRecord;
    return (
        <section aria-label="Form" className="flex flex-col gap-2">
            <Heading
                aside={
                    <span className="inline-flex flex-wrap items-center justify-end gap-x-3">
                        <span className="inline-flex items-center gap-1.5 uppercase tracking-wide">
                            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[2px] bg-fg-2" />
                            xG for
                        </span>
                        <span className="inline-flex items-center gap-1.5 uppercase tracking-wide">
                            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[2px] border" style={{ background: 'rgb(var(--text-3-rgb) / 0.3)', borderColor: 'rgb(var(--text-3-rgb) / 0.9)' }} />
                            xG against
                        </span>
                        <span className="inline-flex items-center gap-1.5 uppercase tracking-wide">
                            <span aria-hidden="true" className="h-0.5 w-3 bg-fg-1" />
                            Goals
                        </span>
                        {h2h ? (
                            <span>
                                <span className="uppercase tracking-wide">Series</span>{' '}
                                <b className="font-bold text-fg-1">
                                    {a} {p.away.h2hRecord ?? '—'}
                                </b>
                            </span>
                        ) : null}
                    </span>
                }
            >
                Form
            </Heading>
            <div className="grid grid-cols-1 gap-x-10 gap-y-4 cq-lg:grid-cols-2">
                {SIDES.map(sd => (
                    <TeamForm key={sd} s={p[sd]} entries={entries?.[sd] ?? null} scale={scale} color={colors[sd]} outs={d ? d[sd].injuries : null} />
                ))}
            </div>
        </section>
    );
}

/* ── Stakes and our record ────────────────────────────────────────────── */

function Dots({ entries }: { entries: boolean[] }) {
    const f = pickForm(entries);
    if (!entries.length) return dash;
    return (
        <span className="inline-flex items-center gap-1.5 tabular-nums">
            <span aria-hidden="true" className="flex gap-0.5">
                {entries.map((ok, i) => (
                    <span key={i} className={cn('h-1.5 w-1.5 rounded-full', ok ? 'bg-pos' : 'bg-neg')} />
                ))}
            </span>
            <span className="font-bold text-fg-1">
                {f.w}-{f.l}
            </span>
        </span>
    );
}

function Extras({ p, state, implication }: { p: Prediction; state: DetailsState; implication: GameImplication | null }) {
    const sides = [p.away, p.home];
    const picks: PickSummaries | null = state.status === 'ready' && state.data ? state.data.picks : null;
    const anyPicks = picks && sides.some(s => (picks[s.team.triCode]?.pickedWin.length ?? 0) + (picks[s.team.triCode]?.pickedLose.length ?? 0) > 0);
    const stakes = implication
        ? [
              { s: p.away, base: implication.away_current_playoff_pct, win: implication.scenarios.away_reg_win.away_playoff_pct, lose: implication.scenarios.home_reg_win.away_playoff_pct },
              { s: p.home, base: implication.home_current_playoff_pct, win: implication.scenarios.home_reg_win.home_playoff_pct, lose: implication.scenarios.away_reg_win.home_playoff_pct },
          ]
        : [];
    const stake = (i: number) => {
        const r = stakes[i];
        if (!r || r.base == null || r.win == null || r.lose == null || r.base <= 1 || r.base >= 99) return null;
        return (
            <span className="inline-flex gap-1.5">
                <span className="text-fg-2">{r.base.toFixed(0)}%</span>
                <span className="text-pos">W {r.win.toFixed(0)}</span>
                <span className="text-neg">L {r.lose.toFixed(0)}</span>
            </span>
        );
    };
    const showStakes = stake(0) || stake(1);
    if (!showStakes && !anyPicks) return null;
    return (
        <>
            {showStakes ? (
                <section aria-label="Playoff odds at stake" className="flex flex-col gap-1.5">
                    <Heading>Playoff odds</Heading>
                    <Mirror label="Now · W / L" away={stake(0) ?? dash} home={stake(1) ?? dash} />
                </section>
            ) : null}
            {anyPicks ? (
                <section aria-label="Our picks on these teams" className="flex flex-col gap-1.5">
                    <Heading>Our picks</Heading>
                    <div className="flex flex-col">
                        <Mirror label="To win" away={<Dots entries={picks![p.away.team.triCode]?.pickedWin ?? []} />} home={<Dots entries={picks![p.home.team.triCode]?.pickedWin ?? []} />} />
                        <Mirror label="To lose" away={<Dots entries={picks![p.away.team.triCode]?.pickedLose ?? []} />} home={<Dots entries={picks![p.home.team.triCode]?.pickedLose ?? []} />} />
                    </div>
                </section>
            ) : null}
        </>
    );
}

/* ── The sheet ────────────────────────────────────────────────────────── */

export function PreviewPanel({ p, phase, state, implication }: { p: Prediction; phase: Phase; state: DetailsState; implication: GameImplication | null }) {
    const w = modelWeight(p);
    const conf = p.confidenceGrade ? (CONF_WORD[p.confidenceGrade] ?? p.confidenceGrade) : null;
    const blend = w != null && w < 0.999 ? `Forecast = model ${Math.round(w * 100)}% + market ${100 - Math.round(w * 100)}%` : null;
    const confHref = termHref('conf');
    return (
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 cq-lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] cq-lg:items-start">
            <div className="flex min-w-0 flex-col gap-5">
                <section aria-label="Why" className="flex flex-col gap-2">
                    <Heading
                        aside={
                            conf ? (
                                <>
                                    {confHref ? (
                                        <a href={confHref} className="uppercase tracking-wide underline decoration-dotted underline-offset-4 hover:text-fg-1">
                                            Confidence
                                        </a>
                                    ) : (
                                        <span className="uppercase tracking-wide">Confidence</span>
                                    )}{' '}
                                    <b className="font-bold text-fg-1">{conf}</b>
                                </>
                            ) : null
                        }
                    >
                        Why
                    </Heading>
                    {p.pickSummary ? <p className="text-caption text-fg-2">{p.pickSummary}</p> : null}
                    {p.breakdown.length ? <WhyThisPick p={p} /> : phase === 'pre' ? <p className="label">No breakdown</p> : null}
                    {p.confidenceNote || blend ? (
                        <p className="text-micro text-fg-3">
                            {[p.confidenceNote, blend].filter(Boolean).join(' · ')}
                        </p>
                    ) : null}
                    <ContextChips p={p} />
                </section>
                <Goalies p={p} state={state} />
            </div>
            <div className="flex min-w-0 flex-col gap-5">
                <section aria-label="Tale of the tape" className="flex flex-col gap-2">
                    <Heading>Tape</Heading>
                    <MatchupPanel p={p} state={state} compact />
                </section>
                <Extras p={p} state={state} implication={implication} />
            </div>
            <div className="min-w-0 cq-lg:col-span-2">
                <Form p={p} state={state} />
            </div>
        </div>
    );
}

export default PreviewPanel;
