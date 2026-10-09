'use client';

import { useEffect, useMemo, useState } from 'react';
import type { GoalieView, InjuryView, PickSummaries, Prediction, RecentGame, Side, SideData } from '@/types/prediction';
import type { GameImplication } from '@/utils/implications';
import type { Phase } from '@/lib/matchup/lifecycle';
import { loadJson } from '@/lib/client-data';
import { modelWeight, pickForm } from '@/lib/matchup/edge';
import { fmtSigned, fmtSv, gsaxHeadline, goalieSeasonLine, shortDate, vsOppTone } from '@/lib/matchup/format';
import { buildEntries, recordOfEntries, type FormEntry } from '@/lib/matchup/form';
import { unpackTeamGames, type MatchupGame, type TeamGamesPayload } from '@/lib/matchup/matchup-stats';
import { termHref } from '@/lib/matchup/glossary-links';
import { clashSafePair } from '@/components/ui/team-color';
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

const OUTCOME_CLS = { W: 'bg-pos/15 text-pos', L: 'bg-well text-fg-3', OTL: 'bg-amber/10 text-amber' } as const;

/** Last five results as tiles, newest nearest the centre; a strip under each tile is that game's xG share in the team colour. */
function Tiles({ entries, home, color }: { entries: FormEntry[]; home: boolean; color: string }) {
    const shown = home ? entries : [...entries].reverse();
    if (!entries.length) return dash;
    return (
        <span className={cn('flex gap-1', home && 'justify-end')}>
            {shown.map(e => {
                const r = e.game?.row;
                const share = r && r.xgf + r.xga > 0 ? r.xgf / (r.xgf + r.xga) : null;
                const title = `${shortDate(e.date)} ${e.home ? 'vs' : '@'} ${e.opp}: ${e.outcome === 'W' ? 'W' : e.outcome === 'OTL' ? 'OTL' : 'L'} ${e.gf}-${e.ga}${r ? `, xG ${r.xgf.toFixed(1)}-${r.xga.toFixed(1)}` : ''}`;
                return (
                    <span key={e.key} title={title} className="flex w-6 flex-col gap-[3px]">
                        <span className={cn('grid h-6 place-items-center rounded-[5px] text-micro font-bold', OUTCOME_CLS[e.outcome])}>
                            <span aria-hidden="true">{e.outcome === 'OTL' ? 'O' : e.outcome}</span>
                            <span className="sr-only">{title}</span>
                        </span>
                        <span aria-hidden="true" className="relative block h-[3px] overflow-hidden rounded-full bg-track">
                            {share != null ? <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${share * 100}%`, background: color }} /> : null}
                        </span>
                    </span>
                );
            })}
        </span>
    );
}

const record = (es: FormEntry[]) => {
    const r = recordOfEntries(es);
    return `${r.w}-${r.l}-${r.otl}`;
};

function restWords(s: SideData): React.ReactNode {
    if (s.isB2b) return <span className="font-bold text-amber">B2B</span>;
    if (s.restDays == null) return dash;
    return `${s.restDays} day${s.restDays === 1 ? '' : 's'}`;
}

function Outs({ list, home }: { list: InjuryView[]; home: boolean }) {
    if (!list.length) return <span className="text-fg-3">None</span>;
    return (
        <span className={cn('flex min-w-0 flex-wrap gap-x-2 gap-y-0.5 whitespace-normal', home && 'justify-end')}>
            {list.map(i => (
                <span key={i.name} title={[i.status, i.detail, i.returnLabel ? `back ~${i.returnLabel}` : null].filter(Boolean).join(' · ')} className="whitespace-nowrap">
                    {i.display}
                    {i.detail ? <span className="ml-1 text-micro text-fg-3">{i.detail}</span> : null}
                </span>
            ))}
        </span>
    );
}

const NO_RECENT: RecentGame[] = [];

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
    return (
        <section aria-label="Form and availability" className="flex flex-col gap-1.5">
            <Heading>Form</Heading>
            <div className="flex flex-col">
                <Mirror
                    label="Last 5"
                    away={entries ? <Tiles entries={entries.away} home={false} color={colors.away} /> : <span className="block h-7 w-32 animate-pulse rounded bg-surface-2" />}
                    home={entries ? <Tiles entries={entries.home} home color={colors.home} /> : <span className="ml-auto block h-7 w-32 animate-pulse rounded bg-surface-2" />}
                />
                {entries ? <Mirror label="Record" away={record(entries.away)} home={record(entries.home)} /> : null}
                {p.away.h2hRecord || p.home.h2hRecord ? <Mirror label="H2H" term="h2h" away={p.away.h2hRecord ?? '—'} home={p.home.h2hRecord ?? '—'} /> : null}
                <Mirror label="Rest" term="rest" away={restWords(p.away)} home={restWords(p.home)} />
                {d ? <Mirror label="Out" away={<Outs list={d.away.injuries} home={false} />} home={<Outs list={d.home.injuries} home />} /> : null}
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
                <Form p={p} state={state} />
            </div>
            <div className="flex min-w-0 flex-col gap-5">
                <section aria-label="Tale of the tape" className="flex flex-col gap-2">
                    <Heading>Tape</Heading>
                    <MatchupPanel p={p} state={state} compact />
                </section>
                <Extras p={p} state={state} implication={implication} />
            </div>
        </div>
    );
}

export default PreviewPanel;
