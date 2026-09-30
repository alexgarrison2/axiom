'use client';

import * as React from 'react';
import HockeyRink, { type RinkShot } from '@/components/HockeyRink';
import { Segmented } from '@/components/ui/segmented';
import { FilterChip } from '@/components/ui/filter-chip';
import { SortHeader } from '@/components/ui/sort-header';
import { ScrollRegion } from '@/components/ui/scroll-region';
import { clashSafePair } from '@/components/ui/team-color';
import { TeamLogo } from '@/components/views/TeamLogo';
import { cn } from '@/lib/utils';
import type { ArchiveGame, PlayoffGameAnalysis, PlayoffPlayerGameStat, PlayoffShotEvent } from './types';

type View = 'rink' | 'flow' | 'tables';
type EventFilter = 'all' | 'goals' | 'sog' | 'missed' | 'blocked';

/* ── Data: one small JSON per game, fetched only when opened ─────────── */

const cache = new Map<string, Promise<PlayoffGameAnalysis>>();

function loadGame(year: number, id: number | string): Promise<PlayoffGameAnalysis> {
    const key = `${year}/${id}`;
    let p = cache.get(key);
    if (!p) {
        p = fetch(`/data/playoffs/${year}/${id}.json`).then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json() as Promise<PlayoffGameAnalysis>;
        });
        p.catch(() => cache.delete(key));
        cache.set(key, p);
    }
    return p;
}

/* ── Formatting ──────────────────────────────────────────────────────── */

const fmt = (n: number, digits = 2) => (Number.isFinite(n) ? n.toFixed(digits) : '—');
const pct = (n: number, digits = 1) => (Number.isFinite(n) ? `${(n * 100).toFixed(digits)}%` : '—');
const rate3 = (n: number) => (Number.isFinite(n) ? n.toFixed(3).replace(/^0/, '').replace(/^-0/, '−') : '—');

function clock(seconds: number): string {
    const s = Math.max(0, Math.round(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function periodLabel(period: number): string {
    return period <= 3 ? ['1st', '2nd', '3rd'][period - 1] : period === 4 ? 'OT' : `${period - 3}OT`;
}

function shotClock(s: PlayoffShotEvent, isSeries: boolean): string {
    const base = `${periodLabel(s.period)} ${clock(s.timeSeconds)}`;
    return isSeries && s.gameNumber ? `G${s.gameNumber} · ${base}` : base;
}

function strengthLabel(strength: string): string {
    if (strength === 'EmptyNet') return 'Empty net';
    const m = strength.match(/^(\d)v(\d)$/);
    if (!m) return strength;
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a > b ? `${strength} PP` : a < b ? `${strength} SH` : strength;
}

const shareValue = (p: PlayoffPlayerGameStat) => (p.xGFor + p.xGAgainst > 0 ? p.xGFor / (p.xGFor + p.xGAgainst) : 0.5);
const headshot = (id: string) => `https://assets.nhle.com/mugs/nhl/latest/${id}.png`;

/* ── Series aggregate ────────────────────────────────────────────────── */

function aggregateSeries(games: PlayoffGameAnalysis[]): PlayoffGameAnalysis | null {
    if (!games.length) return null;
    const base = games[0];
    const zero = (tri: string) => ({ triCode: tri, goals: 0, shots: 0, attempts: 0, xG: 0, xG5v5: 0, ppGoals: 0, ppOpps: 0, hits: 0 });
    const summaries = new Map([base.awayTriCode, base.homeTriCode].map(t => [t, zero(t)]));
    const players = new Map<string, PlayoffPlayerGameStat>();
    const goalies = new Map<string, PlayoffGameAnalysis['goalies'][number]>();
    const shots: PlayoffShotEvent[] = [];
    const add = (a: number | undefined, b: number | undefined) => (a == null && b == null ? undefined : (a ?? 0) + (b ?? 0));

    games.forEach((g, gi) => {
        for (const s of [g.awaySummary, g.homeSummary]) {
            const c = summaries.get(s.triCode) ?? zero(s.triCode);
            (['goals', 'shots', 'attempts', 'xG', 'xG5v5', 'ppGoals', 'ppOpps', 'hits'] as const).forEach(k => {
                c[k] += s[k];
            });
            summaries.set(s.triCode, c);
        }
        g.shots.forEach(s => shots.push({ ...s, gameId: g.gameId, gameNumber: g.gameNumber, elapsedSeconds: gi * 3600 + s.elapsedSeconds }));
        g.players.forEach(p => {
            const c = players.get(p.playerId);
            if (!c) {
                players.set(p.playerId, { ...p });
                return;
            }
            c.toiSeconds += p.toiSeconds;
            c.goals += p.goals;
            c.shots += p.shots;
            c.attempts += p.attempts;
            c.ixG += p.ixG;
            c.xGFor += p.xGFor;
            c.xGAgainst += p.xGAgainst;
            c.goalsFor += p.goalsFor;
            c.goalsAgainst += p.goalsAgainst;
            c.assists = add(c.assists, p.assists);
            c.pim = add(c.pim, p.pim);
            c.hits = add(c.hits, p.hits);
            c.blockedShots = add(c.blockedShots, p.blockedShots);
            c.faceoffWins = add(c.faceoffWins, p.faceoffWins);
            c.faceoffLosses = add(c.faceoffLosses, p.faceoffLosses);
            c.ppToiSeconds = add(c.ppToiSeconds, p.ppToiSeconds);
            c.pkToiSeconds = add(c.pkToiSeconds, p.pkToiSeconds);
        });
        g.goalies.forEach(gl => {
            const key = `${gl.teamTriCode}-${gl.name}`;
            const c = goalies.get(key) ?? { ...gl, toiSeconds: 0, shotsAgainst: 0, fenwickAgainst: 0, goalsAgainst: 0, xGA: 0, gsax: 0 };
            c.toiSeconds += gl.toiSeconds;
            c.shotsAgainst += gl.shotsAgainst;
            c.fenwickAgainst += gl.fenwickAgainst;
            c.goalsAgainst += gl.goalsAgainst;
            c.xGA += gl.xGA;
            c.gsax += gl.gsax;
            c.savePct = c.shotsAgainst ? (c.shotsAgainst - c.goalsAgainst) / c.shotsAgainst : 0;
            c.expectedSavePct = c.shotsAgainst ? (c.shotsAgainst - c.xGA) / c.shotsAgainst : 0;
            c.deltaSavePct = c.savePct - c.expectedSavePct;
            goalies.set(key, c);
        });
    });
    const awaySummary = summaries.get(base.awayTriCode)!;
    const homeSummary = summaries.get(base.homeTriCode)!;
    return {
        ...base,
        gameId: 'series',
        gameNumber: 0,
        date: `${games.length} games`,
        awayScore: awaySummary.goals,
        homeScore: homeSummary.goals,
        awaySummary,
        homeSummary,
        shots: shots.sort((a, b) => a.elapsedSeconds - b.elapsedSeconds),
        players: [...players.values()].sort((a, b) => b.toiSeconds - a.toiSeconds),
        goalies: [...goalies.values()].sort((a, b) => b.toiSeconds - a.toiSeconds),
        maxGameSeconds: games.length * 3600,
    };
}

function filterShots(shots: PlayoffShotEvent[], strength: string, ev: EventFilter, period: string): PlayoffShotEvent[] {
    return shots.filter(s => {
        if (strength !== 'All' && s.strength !== strength) return false;
        if (period !== 'All' && String(s.period) !== period) return false;
        if (ev === 'goals') return s.isGoal;
        if (ev === 'sog') return s.eventType === 'Shot on goal' || s.eventType === 'Goal';
        if (ev === 'missed') return s.eventType === 'Missed shot';
        if (ev === 'blocked') return s.eventType === 'Blocked shot';
        return true;
    });
}

/* ── Component ───────────────────────────────────────────────────────── */

export interface GameAnalysisProps {
    /** Archive year directory, e.g. 2026. */
    year: number;
    /** The series' games (only those with analysis are selectable). */
    games: ArchiveGame[];
    /** Game to open first ('series' for the whole series). */
    initialGameId?: string;
    teamNames: Record<string, string>;
}

export default function GameAnalysis({ year, games, initialGameId, teamNames }: GameAnalysisProps) {
    const playable = React.useMemo(() => games.filter(g => g.analysis), [games]);
    const [selected, setSelected] = React.useState<string>(initialGameId ?? String(playable[playable.length - 1]?.id ?? ''));
    const [view, setView] = React.useState<View>('rink');
    const [strength, setStrength] = React.useState('All');
    const [eventFilter, setEventFilter] = React.useState<EventFilter>('all');
    const [period, setPeriod] = React.useState('All');
    const [state, setState] = React.useState<{ key: string; data: PlayoffGameAnalysis | null; error: string | null }>({ key: '', data: null, error: null });

    React.useEffect(() => {
        if (initialGameId) setSelected(initialGameId);
    }, [initialGameId]);

    React.useEffect(() => {
        let alive = true;
        const ids = selected === 'series' ? playable.map(g => g.id) : [selected];
        if (!ids.length || !ids[0]) return;
        Promise.all(ids.map(id => loadGame(year, id)))
            .then(list => {
                if (!alive) return;
                const data = selected === 'series' ? aggregateSeries(list.sort((a, b) => a.gameNumber - b.gameNumber)) : list[0];
                setState({ key: selected, data, error: null });
            })
            .catch(e => alive && setState({ key: selected, data: null, error: String(e?.message ?? e) }));
        return () => {
            alive = false;
        };
    }, [selected, playable, year]);

    const game = state.key === selected ? state.data : null;
    const loading = state.key !== selected;
    const isSeries = selected === 'series';

    const strengthOptions = React.useMemo(() => ['All', ...[...new Set(game?.shots.map(s => s.strength) ?? [])].sort()], [game]);
    const periodOptions = React.useMemo(
        () => (isSeries ? ['All'] : ['All', ...[...new Set(game?.shots.map(s => String(s.period)) ?? [])].sort((a, b) => Number(a) - Number(b))]),
        [game, isSeries],
    );
    const shots = React.useMemo(() => (game ? filterShots(game.shots, strength, eventFilter, isSeries ? 'All' : period) : []), [game, strength, eventFilter, period, isSeries]);

    if (!playable.length) {
        return <p className="text-body-sm text-fg-3">No shot data was recorded for this series.</p>;
    }

    const colors = game ? clashSafePair(game.awayTriCode, game.homeTriCode) : null;
    const gameLabel = (g: ArchiveGame) => `Game ${g.n}: ${g.away} ${g.away_score ?? ''} @ ${g.home} ${g.home_score ?? ''}${g.decision && g.decision !== 'REG' ? ` (${g.decision})` : ''}`;

    return (
        <section aria-label="Game analysis" className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <FieldSelect label="Game" value={selected} onChange={setSelected} className="col-span-2 md:col-span-1">
                    {playable.length > 1 ? <option value="series">Whole series ({playable.length} games)</option> : null}
                    {playable.map(g => (
                        <option key={g.id} value={String(g.id)}>
                            {gameLabel(g)}
                        </option>
                    ))}
                </FieldSelect>
                <FieldSelect label="Strength" value={strength} onChange={setStrength}>
                    {strengthOptions.map(s => (
                        <option key={s} value={s}>
                            {s === 'All' ? 'All situations' : strengthLabel(s)}
                        </option>
                    ))}
                </FieldSelect>
                <FieldSelect label="Events" value={eventFilter} onChange={v => setEventFilter(v as EventFilter)}>
                    <option value="all">All attempts</option>
                    <option value="sog">Shots on goal</option>
                    <option value="goals">Goals</option>
                    <option value="missed">Missed shots</option>
                    <option value="blocked">Blocked shots</option>
                </FieldSelect>
                <FieldSelect label="Period" value={period} onChange={setPeriod} disabled={isSeries}>
                    {periodOptions.map(p => (
                        <option key={p} value={p}>
                            {p === 'All' ? 'All periods' : periodLabel(Number(p))}
                        </option>
                    ))}
                </FieldSelect>
            </div>

            <Segmented
                label="Analysis view"
                options={[
                    { value: 'rink', label: 'Shot map' },
                    { value: 'flow', label: 'xG flow' },
                    { value: 'tables', label: 'Box score' },
                ]}
                value={view}
                onChange={setView}
                block
                className="md:w-auto md:self-start"
            />

            {state.error && state.key === selected ? (
                <p role="alert" className="rounded-control border border-neg/40 bg-neg/10 px-3 py-2 text-body-sm text-fg-1">
                    Couldn&apos;t load this game ({state.error}).
                </p>
            ) : loading || !game || !colors ? (
                <div aria-busy="true" className="flex h-64 items-center justify-center rounded-control border border-line bg-surface-2/50 text-body-sm text-fg-3">
                    Loading game data…
                </div>
            ) : (
                <>
                    <GameSummary game={game} shots={shots} awayColor={colors.away} homeColor={colors.home} teamNames={teamNames} />
                    {view === 'rink' ? <ShotRink game={game} shots={shots} awayColor={colors.away} homeColor={colors.home} isSeries={isSeries} /> : null}
                    {view === 'flow' ? <XgFlow game={game} shots={shots} awayColor={colors.away} homeColor={colors.home} isSeries={isSeries} /> : null}
                    {view === 'tables' ? <GameTables game={game} /> : null}
                </>
            )}
        </section>
    );
}

function FieldSelect({
    label,
    value,
    onChange,
    children,
    disabled,
    className,
}: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    children: React.ReactNode;
    disabled?: boolean;
    className?: string;
}) {
    const id = React.useId();
    return (
        <div className={cn('flex min-w-0 flex-col gap-1', className)}>
            <label htmlFor={id} className="hud-label">
                {label}
            </label>
            <select
                id={id}
                value={value}
                disabled={disabled}
                onChange={e => onChange(e.target.value)}
                className="h-10 w-full min-w-0 rounded-control border border-line-strong bg-surface-1 px-2.5 text-base text-fg-1 disabled:text-fg-disabled md:text-body-sm"
            >
                {children}
            </select>
        </div>
    );
}

function GameSummary({
    game,
    shots,
    awayColor,
    homeColor,
    teamNames,
}: {
    game: PlayoffGameAnalysis;
    shots: PlayoffShotEvent[];
    awayColor: string;
    homeColor: string;
    teamNames: Record<string, string>;
}) {
    const filtered = shots.reduce<Record<string, number>>((acc, s) => {
        acc[s.teamTriCode] = (acc[s.teamTriCode] ?? 0) + s.xG;
        return acc;
    }, {});
    const filteredAll = shots.length !== game.shots.length;
    return (
        <div className="grid grid-cols-2 gap-2">
            {[
                { t: game.awaySummary, color: awayColor },
                { t: game.homeSummary, color: homeColor },
            ].map(({ t, color }) => (
                <div key={t.triCode} className="rounded-control border border-line bg-surface-2/60 p-3" style={{ boxShadow: `inset 0 3px 0 ${color}` }}>
                    <div className="flex items-center gap-2">
                        <TeamLogo tri={t.triCode} size={24} />
                        <span className="truncate font-bold text-fg-1">{teamNames[t.triCode] ?? t.triCode}</span>
                    </div>
                    <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-body-sm sm:grid-cols-4">
                        <Stat label="Goals" value={String(t.goals)} />
                        <Stat label="xG" value={fmt(t.xG)} />
                        <Stat label="SOG" value={String(t.shots)} />
                        <Stat label="PP" value={`${t.ppGoals}/${t.ppOpps}`} />
                        {filteredAll ? <Stat label="xG (filtered)" value={fmt(filtered[t.triCode] ?? 0)} className="col-span-2 sm:col-span-4" /> : null}
                    </dl>
                </div>
            ))}
        </div>
    );
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
    return (
        <div className={cn('flex flex-col', className)}>
            <dt className="text-micro uppercase tracking-[0.06em] text-fg-3">{label}</dt>
            <dd className="font-bold tabular-nums text-fg-1">{value}</dd>
        </div>
    );
}

function attackingX(s: PlayoffShotEvent, game: PlayoffGameAnalysis): number {
    return s.teamTriCode === game.awayTriCode ? -Math.abs(s.x) : Math.abs(s.x);
}

function ShotRink({ game, shots, awayColor, homeColor, isSeries }: { game: PlayoffGameAnalysis; shots: PlayoffShotEvent[]; awayColor: string; homeColor: string; isSeries: boolean }) {
    const [hovered, setHovered] = React.useState<PlayoffShotEvent | null>(null);
    const byKey = React.useMemo(() => new Map(shots.map(s => [`${s.gameId ?? ''}-${s.eventId}`, s])), [shots]);
    const rinkShots: RinkShot[] = React.useMemo(
        () =>
            shots.map(s => ({
                eventId: `${s.gameId ?? ''}-${s.eventId}`,
                playerId: s.playerId,
                teamTriCode: s.teamTriCode,
                x: attackingX(s, game),
                y: s.y,
                xG: s.xG,
                isGoal: s.isGoal,
                eventType: s.eventType,
                playerName: s.playerName,
            })),
        [shots, game],
    );
    const goals = React.useMemo(
        () => shots.filter(s => s.isGoal).sort((a, b) => (a.gameNumber ?? 0) - (b.gameNumber ?? 0) || a.elapsedSeconds - b.elapsedSeconds),
        [shots],
    );
    return (
        <div className="flex flex-col gap-3">
            <div className="relative overflow-hidden rounded-control border border-line bg-surface-2/40 p-2">
                <HockeyRink
                    shots={rinkShots}
                    homeTriCode={game.homeTriCode}
                    awayTriCode={game.awayTriCode}
                    homeColor={homeColor}
                    awayColor={awayColor}
                    id={game.gameId}
                    onShotHover={rs => setHovered(rs ? byKey.get(String(rs.eventId)) ?? null : null)}
                    className="aspect-[2.35/1]"
                />
                {hovered ? (
                    <div className="pointer-events-none absolute bottom-3 left-1/2 w-[20rem] max-w-[calc(100%-24px)] -translate-x-1/2 rounded-control border border-line-strong bg-surface-3/95 p-2.5 text-center shadow-card">
                        <p className="text-body-sm font-bold text-fg-1">
                            {hovered.teamTriCode} {hovered.isGoal ? 'goal' : hovered.eventType.toLowerCase()} · {hovered.playerName}
                        </p>
                        <p className="text-caption text-fg-2">
                            {shotClock(hovered, isSeries)} · {strengthLabel(hovered.strength)} · xG {pct(hovered.xG, 0)} · {fmt(hovered.distance, 0)} ft
                        </p>
                    </div>
                ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-caption text-fg-3">
                <span>
                    {shots.length} attempts shown · dot size = xG · <span className="text-warn">ring</span> = goal · {game.awayTriCode} attacks left, {game.homeTriCode}{' '}
                    attacks right
                </span>
            </div>
            {goals.length ? (
                <div>
                    <h4 className="hud-label mb-1.5">Goals</h4>
                    {/* One column per team (away left, home right, like the cards above), each in order. */}
                    <div className="grid gap-2 text-body-sm sm:grid-cols-2">
                        {[game.awayTriCode, game.homeTriCode].map(tri => {
                            const list = goals.filter(s => s.teamTriCode === tri);
                            return (
                                <section key={tri} aria-label={`${tri} goals`} className="flex flex-col gap-1">
                                    <p className="flex items-center gap-1.5 text-caption font-semibold text-fg-2">
                                        <TeamLogo tri={tri} size={16} />
                                        {tri} · {list.length}
                                    </p>
                                    {list.length ? (
                                        <ol className="flex flex-col gap-1">
                                            {list.map(s => (
                                                <li key={`${s.gameId ?? ''}-${s.eventId}`} className="flex items-center gap-2 rounded-chip bg-surface-2/60 px-2 py-1">
                                                    <span className="font-semibold text-fg-1">{s.playerName}</span>
                                                    <span className="ml-auto whitespace-nowrap tabular-nums text-fg-3">
                                                        {shotClock(s, isSeries)} · xG {fmt(s.xG)}
                                                    </span>
                                                </li>
                                            ))}
                                        </ol>
                                    ) : (
                                        <p className="px-2 py-1 text-fg-3">No goals</p>
                                    )}
                                </section>
                            );
                        })}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function XgFlow({ game, shots, awayColor, homeColor, isSeries }: { game: PlayoffGameAnalysis; shots: PlayoffShotEvent[]; awayColor: string; homeColor: string; isSeries: boolean }) {
    const w = 1000;
    const h = 420;
    const pad = { left: 44, right: 22, top: 40, bottom: 36 };
    const maxTime = Math.max(3600, game.maxGameSeconds);
    const ordered = [...shots].sort((a, b) => a.elapsedSeconds - b.elapsedSeconds);
    const totals: Record<string, number> = {};
    const running: Record<string, number> = {};
    const points = ordered.map(s => {
        running[s.teamTriCode] = (running[s.teamTriCode] ?? 0) + s.xG;
        totals[s.teamTriCode] = running[s.teamTriCode];
        return { s, cum: running[s.teamTriCode] };
    });
    const yMax = Math.max(1, Math.ceil(Math.max(totals[game.awayTriCode] ?? 0, totals[game.homeTriCode] ?? 0) + 0.25));
    const x = (t: number) => pad.left + (t / maxTime) * (w - pad.left - pad.right);
    const y = (v: number) => h - pad.bottom - (v / yMax) * (h - pad.top - pad.bottom);
    const path = (tri: string) => {
        let d = `M ${x(0)} ${y(0)}`;
        for (const p of points) if (p.s.teamTriCode === tri) d += ` H ${x(p.s.elapsedSeconds)} V ${y(p.cum)}`;
        return `${d} H ${x(maxTime)}`;
    };
    const ticks = isSeries ? Array.from({ length: Math.ceil(maxTime / 3600) }, (_, i) => (i + 1) * 3600) : [1200, 2400, 3600];
    const yStep = yMax > 8 ? 2 : 1;
    return (
        <div className="flex flex-col gap-2">
            <p className="text-center text-body-sm text-fg-2">
                Cumulative expected goals:{' '}
                {/* Team colour marks the swatch, never the text (contrast). */}
                <span className="inline-flex items-center gap-1.5 font-bold tabular-nums text-fg-1">
                    <span aria-hidden="true" className="inline-block h-1 w-4 rounded-full" style={{ backgroundColor: awayColor }} />
                    {game.awayTriCode} {fmt(totals[game.awayTriCode] ?? 0)}
                </span>{' '}
                ·{' '}
                <span className="inline-flex items-center gap-1.5 font-bold tabular-nums text-fg-1">
                    <span aria-hidden="true" className="inline-block h-1 w-4 rounded-full" style={{ backgroundColor: homeColor }} />
                    {game.homeTriCode} {fmt(totals[game.homeTriCode] ?? 0)}
                </span>
            </p>
            <ScrollRegion label="Expected goals flow chart" className="rounded-control border border-line bg-surface-2/40">
                <svg viewBox={`0 0 ${w} ${h}`} className="w-full min-w-[640px]" role="img" aria-label={`Cumulative xG: ${game.awayTriCode} ${fmt(totals[game.awayTriCode] ?? 0)}, ${game.homeTriCode} ${fmt(totals[game.homeTriCode] ?? 0)}`}>
                    {Array.from({ length: Math.floor(yMax / yStep) + 1 }, (_, i) => i * yStep).map(v => (
                        <g key={v}>
                            <line x1={pad.left} x2={w - pad.right} y1={y(v)} y2={y(v)} stroke="rgb(var(--text-3-rgb))" strokeDasharray="3 6" opacity="0.35" />
                            <text x={pad.left - 10} y={y(v) + 4} textAnchor="end" fill="rgb(var(--text-2-rgb))" fontSize="13">
                                {v}
                            </text>
                        </g>
                    ))}
                    {ticks.map((t, i) => (
                        <g key={t}>
                            <line x1={x(t)} x2={x(t)} y1={pad.top} y2={h - pad.bottom} stroke="rgb(var(--text-3-rgb))" strokeDasharray="5 7" opacity="0.4" />
                            <text x={x(t) - (x(t) - x(t - (isSeries ? 3600 : 1200))) / 2} y={h - 12} textAnchor="middle" fill="rgb(var(--text-2-rgb))" fontSize="13">
                                {isSeries ? `G${i + 1}` : periodLabel(i + 1)}
                            </text>
                        </g>
                    ))}
                    <path d={path(game.awayTriCode)} fill="none" stroke={awayColor} strokeWidth="3.5" />
                    <path d={path(game.homeTriCode)} fill="none" stroke={homeColor} strokeWidth="3.5" />
                    {points
                        .filter(p => p.s.isGoal)
                        .map(p => {
                            const cx = x(p.s.elapsedSeconds);
                            const cy = y(p.cum);
                            const clip = `clip-${game.gameId}-${p.s.gameId ?? ''}-${p.s.eventId}`;
                            return (
                                <g key={clip}>
                                    <title>{`${p.s.playerName} (${p.s.teamTriCode}) · ${shotClock(p.s, isSeries)} · xG ${fmt(p.s.xG)}`}</title>
                                    <circle cx={cx} cy={cy} r="17" fill={p.s.teamTriCode === game.awayTriCode ? awayColor : homeColor} />
                                    <clipPath id={clip}>
                                        <circle cx={cx} cy={cy} r="14" />
                                    </clipPath>
                                    <circle cx={cx} cy={cy} r="14" fill="rgb(var(--surface-1-rgb))" />
                                    <image href={headshot(p.s.playerId)} x={cx - 14} y={cy - 14} width="28" height="28" clipPath={`url(#${clip})`} />
                                </g>
                            );
                        })}
                </svg>
            </ScrollRegion>
            <p className="text-caption text-fg-3">Steps rise with every shot attempt by its xG; photos mark goals.</p>
        </div>
    );
}

/* ── Box score tables ────────────────────────────────────────────────── */

type SortCol = 'toi' | 'g' | 'a' | 'pts' | 'sog' | 'ixg' | 'xgf' | 'pm' | 'hits' | 'blk' | 'pptoi' | 'pktoi';

const SORT_VALUE: Record<SortCol, (p: PlayoffPlayerGameStat) => number> = {
    toi: p => p.toiSeconds,
    g: p => p.goals,
    a: p => p.assists ?? 0,
    pts: p => p.goals + (p.assists ?? 0),
    sog: p => p.shots,
    ixg: p => p.ixG,
    xgf: shareValue,
    pm: p => p.goalsFor - p.goalsAgainst,
    hits: p => p.hits ?? 0,
    blk: p => p.blockedShots ?? 0,
    pptoi: p => p.ppToiSeconds ?? 0,
    pktoi: p => p.pkToiSeconds ?? 0,
};

const SKATER_COLUMNS: { col: SortCol; label: string; title: string }[] = [
    { col: 'toi', label: 'TOI', title: 'Time on ice' },
    { col: 'g', label: 'G', title: 'Goals' },
    { col: 'a', label: 'A', title: 'Assists' },
    { col: 'pts', label: 'P', title: 'Points' },
    { col: 'sog', label: 'SOG', title: 'Shots on goal' },
    { col: 'ixg', label: 'ixG', title: 'Individual expected goals' },
    { col: 'xgf', label: 'xGF%', title: 'Share of expected goals while on ice' },
    { col: 'pm', label: '+/−', title: 'On-ice goals for minus against' },
    { col: 'pptoi', label: 'PP', title: 'Power-play time on ice' },
    { col: 'pktoi', label: 'PK', title: 'Penalty-kill time on ice' },
    { col: 'hits', label: 'Hits', title: 'Hits' },
    { col: 'blk', label: 'Blk', title: 'Blocked shots' },
];

function GameTables({ game }: { game: PlayoffGameAnalysis }) {
    const [sortCol, setSortCol] = React.useState<SortCol>('toi');
    const [dir, setDir] = React.useState<'asc' | 'desc'>('desc');
    const [team, setTeam] = React.useState<string>('both');
    const players = React.useMemo(() => {
        const list = game.players.filter(p => team === 'both' || p.teamTriCode === team);
        const v = SORT_VALUE[sortCol];
        return list.sort((a, b) => (dir === 'desc' ? v(b) - v(a) : v(a) - v(b)));
    }, [game.players, team, sortCol, dir]);
    const sortBy = (c: SortCol) => {
        if (c === sortCol) setDir(d => (d === 'desc' ? 'asc' : 'desc'));
        else {
            setSortCol(c);
            setDir('desc');
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <ScrollRegion label="Goalie box score" className="rounded-control border border-line">
                <table className="w-full min-w-[560px] text-body-sm">
                    <caption className="sr-only">Goalies</caption>
                    <thead className="bg-surface-2 text-micro uppercase tracking-[0.06em] text-fg-2">
                        <tr>
                            {['Goalie', 'TOI', 'SA', 'GA', 'xGA', 'GSAx', 'SV%', 'xSV%'].map(hd => (
                                <th key={hd} scope="col" className={cn('px-3 py-2 font-semibold', hd === 'Goalie' ? 'text-left' : 'text-right')}>
                                    {hd}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-line tabular-nums">
                        {game.goalies.map(g => (
                            <tr key={`${g.teamTriCode}-${g.name}`}>
                                <th scope="row" className="px-3 py-2 text-left font-semibold text-fg-1">
                                    <span className="flex items-center gap-2">
                                        <TeamLogo tri={g.teamTriCode} size={18} />
                                        {g.name}
                                    </span>
                                </th>
                                <td className="px-3 py-2 text-right text-fg-2">{clock(g.toiSeconds)}</td>
                                <td className="px-3 py-2 text-right text-fg-2">{g.shotsAgainst}</td>
                                <td className="px-3 py-2 text-right text-fg-2">{g.goalsAgainst}</td>
                                <td className="px-3 py-2 text-right text-fg-2">{fmt(g.xGA)}</td>
                                <td className={cn('px-3 py-2 text-right font-bold', g.gsax > 0 ? 'text-pos' : g.gsax < 0 ? 'text-neg' : 'text-fg-1')}>
                                    {g.gsax > 0 ? '+' : g.gsax < 0 ? '−' : ''}
                                    {fmt(Math.abs(g.gsax))}
                                </td>
                                <td className="px-3 py-2 text-right text-fg-1">{rate3(g.savePct)}</td>
                                <td className="px-3 py-2 text-right text-fg-2">{rate3(g.expectedSavePct)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </ScrollRegion>

            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter skaters by team">
                <FilterChip selected={team === 'both'} onSelectedChange={() => setTeam('both')}>
                    Both teams
                </FilterChip>
                {[game.awayTriCode, game.homeTriCode].map(t => (
                    <FilterChip key={t} selected={team === t} onSelectedChange={() => setTeam(t)} leading={<TeamLogo tri={t} size={16} />}>
                        {t}
                    </FilterChip>
                ))}
            </div>

            <ScrollRegion label="Skater box score" className="rounded-control border border-line">
                <table className="w-full min-w-[760px] text-body-sm">
                    <caption className="sr-only">Skaters, sortable</caption>
                    <thead className="bg-surface-2">
                        <tr>
                            <th scope="col" className="sticky left-0 z-10 bg-surface-2 px-3 py-2 text-left text-micro font-semibold uppercase tracking-[0.06em] text-fg-2">
                                Skater
                            </th>
                            {SKATER_COLUMNS.map(c => (
                                <SortHeader key={c.col} align="right" direction={sortCol === c.col ? dir : null} onSort={() => sortBy(c.col)} title={c.title}>
                                    {c.label}
                                </SortHeader>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-line tabular-nums">
                        {players.map(p => {
                            const pm = p.goalsFor - p.goalsAgainst;
                            const box = p.assists != null;
                            return (
                                <tr key={p.playerId} className="hover:bg-surface-2/50">
                                    <th scope="row" className="sticky left-0 z-10 bg-surface-1 px-3 py-1.5 text-left font-normal">
                                        <span className="flex items-center gap-2">
                                            <TeamLogo tri={p.teamTriCode} size={16} />
                                            <span className="min-w-0">
                                                <span className="block max-w-[10rem] truncate font-semibold text-fg-1">{p.name}</span>
                                                <span className="block text-micro text-fg-3">
                                                    {p.position || '—'}
                                                    {p.number ? ` · #${p.number}` : ''}
                                                </span>
                                            </span>
                                        </span>
                                    </th>
                                    <td className="px-2 py-1.5 text-right text-fg-2">{clock(p.toiSeconds)}</td>
                                    <td className={cn('px-2 py-1.5 text-right', p.goals ? 'font-bold text-fg-1' : 'text-fg-2')}>{p.goals}</td>
                                    <td className="px-2 py-1.5 text-right text-fg-2">{box ? p.assists : '—'}</td>
                                    <td className="px-2 py-1.5 text-right font-semibold text-fg-1">{box ? p.goals + (p.assists ?? 0) : '—'}</td>
                                    <td className="px-2 py-1.5 text-right text-fg-2">{p.shots}</td>
                                    <td className="px-2 py-1.5 text-right text-fg-2">{fmt(p.ixG)}</td>
                                    <td className="px-2 py-1.5 text-right text-fg-2">{pct(shareValue(p), 0)}</td>
                                    <td className="px-2 py-1.5 text-right text-fg-2">{pm > 0 ? `+${pm}` : pm < 0 ? `−${Math.abs(pm)}` : '0'}</td>
                                    <td className="px-2 py-1.5 text-right text-fg-2">{p.ppToiSeconds != null ? clock(p.ppToiSeconds) : '—'}</td>
                                    <td className="px-2 py-1.5 text-right text-fg-2">{p.pkToiSeconds != null ? clock(p.pkToiSeconds) : '—'}</td>
                                    <td className="px-2 py-1.5 text-right text-fg-2">{box ? p.hits : '—'}</td>
                                    <td className="px-2 py-1.5 text-right text-fg-2">{box ? p.blockedShots : '—'}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </ScrollRegion>
        </div>
    );
}
