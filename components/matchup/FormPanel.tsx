'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Prediction, RecentGame, Side, SideData } from '@/types/prediction';
import { loadJson } from '@/lib/client-data';
import { lastName, shortDate } from '@/lib/matchup/format';
import { unpackTeamGames, type MatchupGame, type TeamGamesPayload } from '@/lib/matchup/matchup-stats';
import { FORM_STATS, baselineGames, buildEntries, entryStartedBy, fmtRecord, recordOfEntries, streakOfEntries, summarize, type FormEntry, type Outcome } from '@/lib/matchup/form';
import { Crest } from '@/components/ui/crest';
import { clashSafePair } from '@/components/ui/team-color';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/utils';
import { teamGamesUrl } from './MatchupPanel';
import RecentGamesList from '@/components/RecentGamesList';
import type { DetailsState } from './DetailsLoading';

const SIDES: Side[] = ['away', 'home'];
const OUTCOME: Record<Outcome, { text: string; cls: string; label: string }> = {
    W: { text: 'W', cls: 'text-pos', label: 'Win' },
    L: { text: 'L', cls: 'text-fg-3', label: 'Loss' },
    OTL: { text: 'OT', cls: 'text-warn', label: 'Overtime or shootout loss' },
};

/** Game-log columns: date, opponent, result + score, xG split, shots, goalie. Shots appear once the column is wide enough. */
const COLS =
    'grid grid-cols-[2.9rem_minmax(0,1fr)_4.5rem_4.25rem] items-center gap-x-2.5 cq-sm:grid-cols-[3.25rem_minmax(0,1fr)_4.5rem_5.5rem_3.5rem_minmax(0,6rem)] cq-xl:grid-cols-[3.25rem_minmax(0,1fr)_4.5rem_5.5rem_3.25rem_3.25rem_3.25rem_minmax(0,6rem)] cq-2xl:grid-cols-[3.25rem_minmax(0,1fr)_4.5rem_5.5rem_3.25rem_3.25rem_3.25rem_3.25rem_3.25rem_minmax(0,6rem)]';

/** The xG split of one game as a tiny bar: our share in the team's colour, theirs left dark. */
function XgBar({ f, a, color }: { f: number; a: number; color: string }) {
    const tot = f + a;
    const share = tot > 0 ? (f / tot) * 100 : 50;
    return (
        <span className="flex flex-col gap-0.5">
            <span className="text-caption font-bold tabular-nums text-fg-1">
                {f.toFixed(1)}
                <span className="font-normal text-fg-3">-{a.toFixed(1)}</span>
            </span>
            <span aria-hidden="true" className="relative block h-1 w-full overflow-hidden rounded-full bg-track">
                <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${share}%`, background: color }} />
            </span>
        </span>
    );
}

function StarterDot({ started, goalie }: { started: boolean; goalie: string | null }) {
    return (
        <span
            className={cn('inline-block h-2 w-2 shrink-0 rounded-full', started ? 'bg-magenta shadow-[0_0_8px_rgb(var(--model-rgb))]' : 'bg-transparent')}
            title={started ? `${lastName(goalie!)} started` : undefined}
            role={started ? 'img' : undefined}
            aria-label={started ? `${lastName(goalie!)} started` : undefined}
            aria-hidden={started ? undefined : true}
        />
    );
}

/** One game on one line, aligned to the column header above. A game the log has not caught up with shows its result and score only. */
function GameRow({ e, goalie, color }: { e: FormEntry; goalie: string | null; color: string }) {
    const o = OUTCOME[e.outcome];
    const started = entryStartedBy(e, goalie);
    const r = e.game?.row;
    const dash = <span className="text-fg-3">—</span>;
    return (
        <li className={cn(COLS, 'min-h-11 border-b border-line py-1.5 last:border-0')}>
            <span className="flex flex-col text-micro leading-tight tabular-nums text-fg-3">{shortDate(e.date)}</span>
            <span className="flex min-w-0 items-center gap-1.5 text-caption font-bold text-fg-1">
                <span className="w-3 shrink-0 text-center text-micro font-normal text-fg-3">{e.home ? 'vs' : '@'}</span>
                <Crest tri={e.opp} size={28} className="drop-shadow-none" />
                {e.opp}
            </span>
            <span className="flex items-center gap-1.5 tabular-nums">
                <span
                    className={cn(
                        'flex h-5 min-w-5 items-center justify-center rounded-[4px] px-0.5 text-micro font-bold',
                        e.outcome === 'W' ? 'bg-pos/15 text-pos' : e.outcome === 'OTL' ? 'bg-amber/10 text-amber' : 'bg-well text-fg-3',
                    )}
                    title={o.label}
                >
                    {o.text}
                    <span className="sr-only"> ({o.label})</span>
                </span>
                <span className="text-caption font-bold text-fg-1">
                    {e.gf}-{e.ga}
                    {e.extra && e.outcome === 'W' ? <span className="ml-0.5 text-micro font-normal text-fg-3">{e.extra}</span> : null}
                </span>
                <span className="cq-sm:hidden">
                    <StarterDot started={started} goalie={goalie} />
                </span>
            </span>
            {r ? <XgBar f={r.xgf} a={r.xga} color={color} /> : <span>{dash}</span>}
            <span className="hidden text-caption tabular-nums text-fg-2 cq-sm:block">{r ? `${r.sf}-${r.sa}` : dash}</span>
            <span className="hidden text-caption tabular-nums text-fg-2 cq-xl:block">{r && r.cf + r.ca > 0 ? ((r.cf / (r.cf + r.ca)) * 100).toFixed(0) : dash}</span>
            <span className="hidden text-caption tabular-nums text-fg-2 cq-xl:block">{r ? `${r.hdf}-${r.hda}` : dash}</span>
            <span className="hidden text-caption tabular-nums text-fg-2 cq-2xl:block">{r && r.ppo > 0 ? `${r.ppg}/${r.ppo}` : dash}</span>
            <span className="hidden text-caption tabular-nums text-fg-2 cq-2xl:block">{r && r.pko > 0 ? `${r.pko - r.ppga}/${r.pko}` : dash}</span>
            <span className="hidden min-w-0 items-center gap-1.5 text-micro text-fg-3 cq-sm:flex">
                <StarterDot started={started} goalie={goalie} />
                <span className={cn('truncate', started && 'text-fg-1')}>{e.starter ? lastName(e.starter) : ''}</span>
            </span>
        </li>
    );
}

function Chip({ children, tone }: { children: React.ReactNode; tone?: 'amber' }) {
    return (
        <span className={cn('rounded-chip border px-1.5 py-0.5 text-micro font-bold uppercase tracking-wide', tone === 'amber' ? 'border-amber/50 text-amber' : 'border-line text-fg-2')}>
            {children}
        </span>
    );
}

/** Tonight's schedule spot for one team: rest, workload, and its home or road record. */
function Situation({ s, home }: { s: SideData; home: boolean }) {
    const rest = s.isB2b ? 'B2B' : s.restDays != null ? `${s.restDays}d rest` : null;
    return (
        <div className="flex flex-wrap items-center gap-1.5">
            {rest ? <Chip tone={s.isB2b ? 'amber' : undefined}>{rest}</Chip> : null}
            {s.gamesInLast4 != null && s.gamesInLast4 >= 3 ? <Chip tone="amber">{s.gamesInLast4} in 4</Chip> : null}
            {!home && s.roadTripGameN != null && s.roadTripGameN >= 2 ? <Chip>Road trip G{s.roadTripGameN}</Chip> : null}
            {s.locRecord ? (
                <Chip>
                    {home ? 'Home' : 'Road'} {s.locRecord}
                </Chip>
            ) : null}
        </div>
    );
}

function TeamForm({ p, side, games, recent, n, className }: { p: Prediction; side: Side; games: MatchupGame[]; recent: RecentGame[]; n: 5 | 10; className?: string }) {
    const s = p[side];
    const color = clashSafePair(p.away.team.triCode, p.home.team.triCode)[side];
    const tri = s.team.triCode;
    const entries = useMemo(() => buildEntries(games, recent, p.id, p.date, n), [games, recent, p.id, p.date, n]);
    const ten = useMemo(() => buildEntries(games, recent, p.id, p.date, 10), [games, recent, p.id, p.date]);
    // The numbers need the full log row of every game shown; goals for/against only need the score.
    const logged = entries.flatMap(e => (e.game ? [e.game] : []));
    const complete = logged.length === entries.length;
    const sum = useMemo(() => summarize(tri, complete ? logged : [], baselineGames(games, p.id, p.date)), [tri, complete, logged, games, p.id, p.date]);
    const gfga = entries.length ? { gf_gp: entries.reduce((t, e) => t + e.gf, 0) / entries.length, ga_gp: entries.reduce((t, e) => t + e.ga, 0) / entries.length } : null;
    const streak = streakOfEntries(ten);
    const rec = recordOfEntries(entries);
    const anyStarter = !!s.goalie && entries.some(e => entryStartedBy(e, s.goalie));
    return (
        <section aria-label={`${s.team.commonName} form`} className={cn('flex min-w-0 flex-col gap-3 cq-lg:row-span-4 cq-lg:grid cq-lg:grid-rows-subgrid', className)}>
            <div className="flex items-center gap-3">
                <Crest tri={tri} size={44} className="drop-shadow-none" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-baseline gap-2">
                        <span className="font-display text-title font-bold text-fg-1">{tri}</span>
                        {s.record ? <span className="text-caption tabular-nums text-fg-2">{s.record}</span> : null}
                    </span>
                    <span className="flex items-baseline gap-2 text-micro uppercase tracking-wide text-fg-3">
                        <span>
                            Last {entries.length} <span className="font-bold tabular-nums text-fg-1">{fmtRecord(rec)}</span>
                        </span>
                        {streak && streak.n >= 2 ? (
                            <span>
                                Streak{' '}
                                <span className={cn('font-bold', streak.outcome === 'W' ? 'text-pos' : 'text-fg-1')}>
                                    {OUTCOME[streak.outcome].text}
                                    {streak.n}
                                </span>
                            </span>
                        ) : null}
                    </span>
                </div>
            </div>

            <div className="min-w-0 [container-type:inline-size]">
                {entries.length ? (
                    <dl className="grid grid-cols-3 gap-1.5 cq-xl:grid-cols-6">
                        {FORM_STATS.map(st => {
                            const v = st.key === 'gf_gp' || st.key === 'ga_gp' ? (gfga?.[st.key] ?? null) : complete ? sum.values[st.key] : null;
                            const base = sum.baseline[st.key];
                            return (
                                <div key={st.key} className="flex flex-col gap-0.5 rounded-[10px] border border-line bg-well px-2.5 py-2">
                                    <dt className="text-micro uppercase tracking-wide text-fg-3">{st.label}</dt>
                                    <dd className="font-display text-[22px] font-bold leading-6 tabular-nums text-fg-1">{v != null ? st.fmt(v) : '—'}</dd>
                                    {base != null ? <dd className="text-micro tabular-nums text-fg-3">Season {st.fmt(base)}</dd> : null}
                                </div>
                            );
                        })}
                    </dl>
                ) : null}
            </div>

            {entries.length ? (
                <div className="min-w-0 [container-type:inline-size]">
                    <div className="flex min-w-0 flex-col">
                        <div aria-hidden="true" className={cn(COLS, 'border-b border-line pb-1 text-micro uppercase tracking-wide text-fg-3')}>
                            <span>Date</span>
                            <span>Opp</span>
                            <span>Result</span>
                            <span>xG</span>
                            <span className="hidden cq-sm:block">Shots</span>
                            <span className="hidden cq-xl:block">CF%</span>
                            <span className="hidden cq-xl:block">HD</span>
                            <span className="hidden cq-2xl:block">PP</span>
                            <span className="hidden cq-2xl:block">PK</span>
                            <span className="hidden cq-sm:block">Goalie</span>
                        </div>
                        <ol aria-label={`${s.team.commonName} last ${entries.length} games`} className="flex flex-col">
                            {entries.map(e => (
                                <GameRow key={e.key} e={e} goalie={s.goalie} color={color} />
                            ))}
                        </ol>
                    </div>
                </div>
            ) : (
                <div className="min-w-0">
                    <p className="label py-3 text-center">No games yet</p>
                </div>
            )}
            <div className="flex min-w-0 flex-col gap-3">
                {anyStarter ? (
                    <p className="flex items-center gap-1.5 text-micro uppercase tracking-wide text-fg-3">
                        <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-magenta" />
                        {lastName(s.goalie!)} started
                    </p>
                ) : null}
                <Situation s={s} home={side === 'home'} />
            </div>
        </section>
    );
}

const EMPTY: RecentGame[] = [];

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; games: Record<Side, MatchupGame[]> };

/**
 * Each team's recent form: results strip, last-N numbers against the season,
 * every game with how it really went (xG, shots) and a purple dot where
 * tonight's projected goalie started, and tonight's rest. Side by side on a
 * wide card; one team at a time, switched by its crest, on a phone.
 */
export function FormPanel({ p, state }: { p: Prediction; state: DetailsState }) {
    const [load, setLoad] = useState<Load>({ status: 'loading' });
    const [n, setN] = useState<'5' | '10'>('5');
    const [side, setSide] = useState<Side>('away');
    const away = p.away.team.triCode;
    const home = p.home.team.triCode;

    useEffect(() => {
        let live = true;
        Promise.all([loadJson<TeamGamesPayload>(teamGamesUrl(away)), loadJson<TeamGamesPayload>(teamGamesUrl(home))]).then(
            ([a, h]) => live && setLoad({ status: 'ready', games: { away: unpackTeamGames(a), home: unpackTeamGames(h) } }),
            () => live && setLoad({ status: 'error' }),
        );
        return () => {
            live = false;
        };
    }, [away, home]);

    if (load.status === 'loading') {
        return (
            <div aria-busy="true" className="flex flex-col gap-2 py-1">
                <div className="h-11 animate-pulse rounded-[10px] bg-surface-2" />
                <div className="h-64 animate-pulse rounded-[10px] bg-surface-2" />
            </div>
        );
    }
    if (load.status === 'error') {
        // The slate's own short list still tells the story when the full game log is unavailable.
        const d = state.status === 'ready' ? state.data : null;
        if (!d) return <p className="label py-4 text-center">Unavailable</p>;
        return (
            <div className="grid grid-cols-1 gap-3 cq-sm:grid-cols-2">
                <RecentGamesList team={p.away.team} gp={p.away.gp} games={d.away.recent} starter={p.away.goalie} />
                <RecentGamesList team={p.home.team} gp={p.home.gp} games={d.home.recent} starter={p.home.goalie} />
            </div>
        );
    }

    const num = n === '5' ? 5 : 10;
    return (
        <div className="flex min-w-0 flex-col gap-3">
            <div className="flex items-center gap-2">
                <div className="flex-1 cq-lg:hidden">
                    <Segmented
                        label="Form team"
                        size="sm"
                        block
                        optionClassName="px-1 py-0.5"
                        value={side}
                        onChange={setSide}
                        options={SIDES.map(sd => ({
                            value: sd,
                            label: <Crest tri={p[sd].team.triCode} size={40} className={cn('h-10 w-10 drop-shadow-none transition-[opacity,filter]', side !== sd && 'opacity-40 grayscale')} />,
                            ariaLabel: p[sd].team.triCode,
                        }))}
                    />
                </div>
                <div className="ml-auto">
                    <Segmented
                        label="Games shown"
                        size="sm"
                        value={n}
                        onChange={setN}
                        options={[
                            { value: '5', label: 'L5' },
                            { value: '10', label: 'L10' },
                        ]}
                    />
                </div>
            </div>
            {/* Wide card: both teams share four rows (header, numbers, games, tonight), so each section starts at the same height. */}
            <div className="grid min-w-0 grid-cols-1 gap-x-5 gap-y-4 cq-lg:grid-cols-2 cq-lg:grid-rows-[auto_auto_auto_auto] cq-lg:gap-y-3">
                {SIDES.map(sd => (
                    <TeamForm
                        key={sd}
                        p={p}
                        side={sd}
                        games={load.games[sd]}
                        recent={state.status === 'ready' && state.data ? state.data[sd].recent : EMPTY}
                        n={num}
                        className={side !== sd ? 'hidden cq-lg:grid' : undefined}
                    />
                ))}
            </div>
            {p.away.h2hRecord || p.home.h2hRecord ? (
                <div className="grid grid-cols-[1fr_auto_1fr] items-baseline gap-3 border-t border-line pt-2 tabular-nums">
                    <span className="text-caption font-bold text-fg-1">{p.away.h2hRecord ?? '—'}</span>
                    <span className="text-micro font-medium uppercase tracking-wide text-fg-3">H2H</span>
                    <span className="text-right text-caption font-bold text-fg-1">{p.home.h2hRecord ?? '—'}</span>
                </div>
            ) : null}
        </div>
    );
}

export default FormPanel;
