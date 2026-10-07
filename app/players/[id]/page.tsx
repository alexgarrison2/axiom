import * as React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { teamPalette } from '@/components/ui/team-color';
import { legibleOn } from '@/components/ui/color';
import { PonyGames } from '@/components/player/PonyGames';
import { GameLog } from '@/components/player/GameLog';
import type { TrendGame } from '@/components/player/PonyTrend';
import { cn } from '@/lib/utils';
import { GS_PARTS, type GsPart } from '@/lib/game/analytics';
import { leaderboard, loadPonySeason, playerGames, ponySeasons, DEFAULT_FILTERS, type GoalieGame, type SkaterGame } from '@/lib/pony/data';
import { signed } from '@/lib/pony/parts';
import { ageOn, playerProfile, type SeasonLine } from '@/lib/players/landing';
import { readRatingsDoc } from '@/lib/players/server';
import { Wowy } from '@/components/player/Wowy';
import { loadWowy } from '@/lib/players/wowy-server';
import { SEASON_ID } from '@/lib/season';
import { IsolatedImpact } from '@/components/player/IsolatedImpact';
import { AwardShelf } from '@/components/player/AwardShelf';
import { CareerTable } from '@/components/player/CareerTable';
import { CareerSwitch } from '@/components/player/CareerSwitch';
import { loadIsolate } from '@/lib/players/isolate-server';
import PlayerSwitcher from '@/components/player/PlayerSwitcher';

/*
 * A player's page: the NHL profile (bio, action photo, draft, awards, career
 * by season) around our Pony Score season (rank, per-game trend, average
 * breakdown, game log with the score each night) and his IMPACT rating.
 */

type Params = { id: string };
type Search = Record<string, string | string[] | undefined>;

const PANEL = '#0a0e15';
// Flat panel fill under pinned columns, so the pinned cells match it.
const FLAT = 'max-lg:bg-none max-lg:bg-surface-1';
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const seasonLabel = (s: string | number) => `${String(s).slice(0, 4)}-${String(s).slice(6)}`;
const feetInches = (inches: number | null) => (inches ? `${Math.floor(inches / 12)}′${inches % 12}″` : '—');

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
    const { id } = await params;
    if (!/^\d{7}$/.test(id)) return { title: 'Player' };
    const p = await playerProfile(Number(id));
    return p
        ? { title: `${p.first} ${p.last}`, description: `${p.first} ${p.last}: Pony Score by game, breakdown and trend, IMPACT rating, bio and career stats.`, alternates: { canonical: `/players/${id}` } }
        : { title: 'Player' };
}

function impactRow(id: number): Record<string, unknown> | null {
    const doc = readRatingsDoc() as { columns?: string[]; rows?: unknown[][] } | null;
    if (!doc?.columns || !doc.rows) return null;
    const i = doc.columns.indexOf('id');
    const r = doc.rows.find(row => Number(row[i]) === id);
    return r ? Object.fromEntries(doc.columns.map((c, k) => [c, r[k]])) : null;
}

function Fact({ k, v }: { k: string; v: React.ReactNode }) {
    return (
        <div className="min-w-0">
            <p className="text-micro uppercase tracking-label text-fg-3">{k}</p>
            <p className="whitespace-nowrap text-body text-fg-1">{v}</p>
        </div>
    );
}

/** A sub line given as parts joins them with " · "; below lg each part (and its dot) stays whole when the line wraps. */
function Sub({ parts }: { parts: string[] }) {
    return parts.map((t, i) => (
        <React.Fragment key={i}>
            <span className="max-lg:whitespace-nowrap">{i < parts.length - 1 ? `${t} ·` : t}</span>
            {i < parts.length - 1 ? ' ' : null}
        </React.Fragment>
    ));
}

function Tile({ k, v, sub, accent }: { k: string; v: React.ReactNode; sub?: React.ReactNode | string[]; accent?: boolean }) {
    return (
        <div className={cn('rounded-card border bg-surface-1/80 px-4 py-3 backdrop-blur-sm max-[359px]:px-3', accent ? 'border-brand/50' : 'border-line')}>
            <p className="text-micro uppercase tracking-label text-fg-3">{k}</p>
            <p className="mt-1 font-display text-h2 font-bold leading-none tabular-nums text-fg-1 max-lg:whitespace-nowrap max-[359px]:text-[20px]">{v}</p>
            {sub ? <p className="mt-1 text-micro text-fg-3 max-lg:text-balance">{Array.isArray(sub) ? <Sub parts={sub} /> : sub}</p> : null}
        </div>
    );
}

export default async function PlayerPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<Search> }) {
    const { id } = await params;
    if (!/^\d{7}$/.test(id)) notFound();
    const pid = Number(id);
    const sp = await searchParams;
    const profile = await playerProfile(pid);
    const seasons = ponySeasons();

    // Pony seasons this player appears in; ?season= picks one, else the newest with games.
    const withGames = seasons
        .map(s => ({ s, data: loadPonySeason(s) }))
        .filter(x => x.data && (x.data.skaters.some(r => r.player === pid) || x.data.goalies.some(r => r.player === pid)));
    const want = Array.isArray(sp.season) ? sp.season[0] : sp.season;
    const cur = withGames.find(x => x.s === want) ?? withGames[0] ?? null;
    if (!profile && !cur) notFound();

    const data = cur?.data ?? null;
    const games = data ? playerGames(data, pid) : { skater: [] as SkaterGame[], goalie: [] as GoalieGame[] };
    const goalie = profile?.goalie ?? (games.goalie.length > 0 && games.skater.length === 0);
    const ponyPlayer = data?.players.get(pid) ?? null;
    const first = profile?.first ?? ponyPlayer?.first ?? '';
    const last = profile?.last ?? ponyPlayer?.last ?? '';
    const team = profile?.team ?? ponyPlayer?.team ?? null;
    const pos = profile?.pos ?? ponyPlayer?.pos ?? '';
    const color = team ? teamPalette(team).primary : 'var(--brand)';
    const ink = team ? legibleOn(teamPalette(team).primary, PANEL) : 'var(--text-1)';

    // Season summary and rank among his position (qualified: 30% of the most games anyone played).
    const rows = goalie ? games.goalie : games.skater;
    const gp = rows.length;
    const total = rows.reduce((a, r) => a + r.ps, 0);
    const avg = gp ? total / gp : 0;
    const toi = gp ? rows.reduce((a, r) => a + r.toi, 0) / gp : 0;
    const group = goalie ? 'G' : pos === 'D' ? 'D' : 'F';
    let rank: { n: number; of: number } | null = null;
    if (data && gp) {
        const maxGp = Math.max(...[...new Set((goalie ? data.goalies : data.skaters).map(r => r.team))].map(t => new Set((goalie ? data.goalies : data.skaters).filter(r => r.team === t).map(r => r.game)).size));
        const qual = Math.max(1, Math.round(maxGp * 0.3));
        const board = leaderboard(data, { ...DEFAULT_FILTERS, season: data.season, pos: group as 'F' | 'D' | 'G', minGp: qual });
        const at = board.findIndex(r => r.player.id === pid);
        rank = at >= 0 ? { n: at + 1, of: board.length } : null;
    }
    const avgParts = !goalie && gp ? (Object.fromEntries(GS_PARTS.map(k => [k, games.skater.reduce((a, r) => a + r.parts[k], 0) / gp])) as Record<GsPart, number>) : null;
    const best = rows.length ? rows.reduce((b, r) => (r.ps > b.ps ? r : b)) : null;
    const worst = rows.length ? rows.reduce((b, r) => (r.ps < b.ps ? r : b)) : null;

    const trend: TrendGame[] = rows.map(r => {
        const s = r as SkaterGame;
        const gl = r as GoalieGame;
        return {
            game: r.game,
            date: r.date,
            opp: r.opp,
            home: r.home,
            result: r.result,
            ps: r.ps,
            toi: r.toi,
            parts: goalie ? null : s.parts,
            line: goalie ? `${gl.sa} SA · ${gl.ga} GA · xGA ${gl.xga.toFixed(2)} · ${mmss(r.toi)}` : `${s.g} G · ${s.a1 + s.a2} A · ${s.sog} SOG · ixG ${s.ixg.toFixed(2)} · ${mmss(r.toi)}`,
        };
    });

    const imp = impactRow(pid);
    const nhl = (profile?.seasons ?? []).filter(s => s.league === 'NHL' && s.gameType === 2);
    const other = (profile?.seasons ?? []).filter(s => s.league !== 'NHL' && s.gameType === 2);
    const nhlPlayoffs = (profile?.seasons ?? []).filter(s => s.league === 'NHL' && s.gameType === 3);
    const otherPlayoffs = (profile?.seasons ?? []).filter(s => s.league !== 'NHL' && s.gameType === 3);
    const thisSeason = nhl.find(s => String(s.season) === cur?.s) ?? nhl[nhl.length - 1] ?? null;
    const age = ageOn(profile?.birthDate ?? null);
    const seasonQ = (s: string) => (s === seasons[0] ? `/players/${pid}` : `/players/${pid}?season=${s}`);
    // With or without you: skaters only, for the season the page shows.
    const wowySeason = cur?.s ?? SEASON_ID;
    const wowy = goalie ? null : loadWowy(wowySeason, pid);
    // Isolated impact: skaters only, the season the page shows (fitted on it and the two before).
    const isolate = goalie ? null : loadIsolate(wowySeason, pid);

    return (
        <main className="pb-tabbar">
            <div className="page flex flex-col gap-8 py-5 md:py-7">
                {/* Breadcrumb and player switcher, placed as on the team page (8px under the bar, 8px over the hero). */}
                <nav aria-label="Breadcrumb" className="-mb-6 -mt-3 flex items-center justify-between gap-3">
                    <ol className="flex min-w-0 items-center gap-1.5 text-micro font-medium uppercase tracking-label">
                        <li>
                            <Link href="/players" className="inline-flex min-h-8 items-center text-fg-3 hover:text-brand coarse:min-h-11">
                                Players
                            </Link>
                        </li>
                        <li aria-hidden="true" className="text-fg-disabled">
                            /
                        </li>
                        <li aria-current="page" className="truncate text-fg-1">
                            {last || first}
                        </li>
                    </ol>
                    <PlayerSwitcher current={pid} name={`${first} ${last}`.trim()} team={team} />
                </nav>
                {/* Hero: the action photo bleeding off the right, the name and the night-to-night headline on the left. */}
                <section className="relative overflow-hidden rounded-card border border-line bg-surface-1" style={{ boxShadow: `inset 0 3px 0 ${color}` }}>
                    {profile?.hero ? (
                        <>
                            {/* eslint-disable-next-line @next/next/no-img-element -- NHL action photo, decorative */}
                            <img src={profile.hero} alt="" className="absolute inset-y-0 right-0 h-full w-full object-cover object-right opacity-60 md:w-[68%]" />
                            <div className="absolute inset-0 bg-[linear-gradient(90deg,var(--surface-1)_0%,var(--surface-1)_34%,rgb(var(--surface-1-rgb)/0.75)_55%,rgb(var(--surface-1-rgb)/0.15)_100%)]" aria-hidden="true" />
                            <div className="absolute inset-0 bg-[linear-gradient(0deg,var(--surface-1)_0%,transparent_45%)] md:hidden" aria-hidden="true" />
                        </>
                    ) : null}
                    <div className="relative flex flex-col gap-6 p-5 max-[359px]:p-4 md:p-8">
                        <div className="flex items-center gap-4">
                            {profile?.headshot ? (
                                <span className="block h-20 w-20 shrink-0 overflow-hidden rounded-full border-[3px] bg-surface-2 md:h-24 md:w-24" style={{ borderColor: color }}>
                                    {/* eslint-disable-next-line @next/next/no-img-element -- NHL headshot */}
                                    <img src={profile.headshot} alt="" width={96} height={96} className="headshot h-full w-full" />
                                </span>
                            ) : null}
                            <div className="min-w-0">
                                <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption uppercase tracking-label" style={{ color: ink }}>
                                    {team ? (
                                        <Link href={`/teams/${team}`} className="flex items-center gap-1.5 hover:underline">
                                            {/* eslint-disable-next-line @next/next/no-img-element -- team logo */}
                                            <img src={`/logos/${team}.svg`} alt="" width={24} height={24} className="h-6 w-6" />
                                            {profile?.teamName ?? team}
                                        </Link>
                                    ) : null}
                                    <span className="text-fg-3">
                                        {profile?.num != null ? `#${profile.num} · ` : ''}
                                        {pos}
                                    </span>
                                </p>
                                <h1 className="mt-1 font-display text-[clamp(2rem,6vw,4rem)] font-bold uppercase leading-[0.95] tracking-tight text-fg-1 max-lg:[overflow-wrap:anywhere] max-[359px]:text-[1.625rem]">
                                    <span className="block text-fg-2">{first}</span>
                                    {last}
                                </h1>
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-x-8 gap-y-3 md:gap-x-10">
                            <Fact k="Age" v={age ?? '—'} />
                            <Fact k="Height" v={feetInches(profile?.heightIn ?? null)} />
                            <Fact k="Weight" v={profile?.weightLb ? `${profile.weightLb} lb` : '—'} />
                            <Fact k={goalie ? 'Catches' : 'Shoots'} v={profile?.shoots ?? '—'} />
                            <Fact k="Born" v={profile?.birthPlace || '—'} />
                            <Fact k="Draft" v={profile?.draft ? `${profile.draft.year} · ${profile.draft.team} · round ${profile.draft.round}, #${profile.draft.overall} overall` : 'Undrafted'} />
                        </div>
                        <div className="grid max-w-3xl grid-cols-2 gap-3 md:grid-cols-4">
                            <Tile
                                k={goalie ? 'GSAx per game' : 'Pony per game'}
                                v={gp ? signed(avg) : '—'}
                                sub={rank ? `${rank.n} of ${rank.of} ${group === 'G' ? 'goalies' : group === 'D' ? 'defencemen' : 'forwards'}` : cur ? `${gp} games` : 'No games yet'}
                                accent
                            />
                            <Tile k={goalie ? 'GSAx total' : 'Pony total'} v={gp ? signed(total) : '—'} sub={cur ? [`${gp} games`, seasonLabel(cur.s)] : undefined} />
                            {goalie ? (
                                <Tile k="Record" v={thisSeason ? `${thisSeason.w ?? 0}-${thisSeason.l ?? 0}-${thisSeason.otl ?? 0}` : '—'} sub={thisSeason?.svPct != null ? [`SV% ${thisSeason.svPct.toFixed(3).replace(/^0/, '')}`, `GAA ${thisSeason.gaa?.toFixed(2)}`] : undefined} />
                            ) : (
                                <Tile k="Points" v={thisSeason ? `${thisSeason.g ?? 0}-${thisSeason.a ?? 0}-${thisSeason.p ?? 0}` : '—'} sub={thisSeason ? ['G-A-P', `${thisSeason.gp} GP`, `${thisSeason.toi ?? mmss(toi)} TOI`] : undefined} />
                            )}
                            <Tile
                                k="IMPACT"
                                v={imp && imp.impact != null ? signed(Number(imp.impact), 1) : '—'}
                                sub={imp && imp.off_impact != null ? ['Goals / 82', `OFF ${signed(Number(imp.off_impact), 1)}`, `DEF ${signed(Number(imp.def_impact), 1)}`] : 'Goals per 82 games'}
                            />
                        </div>
                    </div>
                </section>

                {/* Pony Score season. */}
                <section aria-labelledby="pony-h" className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                        <h2 id="pony-h" className="font-display text-h2 font-bold uppercase leading-none tracking-wide text-fg-1">
                            Pony score
                        </h2>
                        {withGames.length > 1 ? (
                            <nav aria-label="Season" className="flex gap-1.5">
                                {withGames.map(x => (
                                    <Link
                                        key={x.s}
                                        href={seasonQ(x.s)}
                                        scroll={false}
                                        aria-current={x.s === cur?.s ? 'page' : undefined}
                                        className={cn(
                                            'inline-flex h-8 items-center rounded-full border px-3 text-micro uppercase tracking-chip coarse:h-11',
                                            x.s === cur?.s ? 'border-brand/60 text-brand' : 'border-line text-fg-3 hover:border-line-strong hover:text-fg-1',
                                        )}
                                    >
                                        {seasonLabel(x.s)}
                                    </Link>
                                ))}
                            </nav>
                        ) : null}
                    </div>
                    {gp ? (
                        <PonyGames
                            trend={trend}
                            color={color}
                            avgParts={avgParts}
                            avg={avg}
                            group={group}
                            goalieSummary={
                                <p key="gsax" className="text-caption text-fg-2">
                                    {games.goalie.reduce((a, r) => a + r.sa, 0)} shots, {games.goalie.reduce((a, r) => a + r.ga, 0)} goals against,{' '}
                                    <span className="text-model">{games.goalie.reduce((a, r) => a + r.xga, 0).toFixed(1)} xGA</span>.
                                </p>
                            }
                            footer={
                                best && worst ? (
                                    <div key="extremes" className="mt-auto grid grid-cols-2 gap-3 border-t border-line pt-3 text-caption">
                                        <Link href={`/games/${best.game}`} className="group">
                                            <p className="text-micro uppercase tracking-label text-fg-3">Best</p>
                                            <p className="text-fg-1 group-hover:text-brand">
                                                <span className="font-bold tabular-nums">{signed(best.ps)}</span> {best.home ? 'vs' : '@'} {best.opp}
                                            </p>
                                            <p className="text-micro text-fg-3">{best.date}</p>
                                        </Link>
                                        <Link href={`/games/${worst.game}`} className="group">
                                            <p className="text-micro uppercase tracking-label text-fg-3">Toughest</p>
                                            <p className="text-fg-1 group-hover:text-brand">
                                                <span className="font-bold tabular-nums">{signed(worst.ps)}</span> {worst.home ? 'vs' : '@'} {worst.opp}
                                            </p>
                                            <p className="text-micro text-fg-3">{worst.date}</p>
                                        </Link>
                                    </div>
                                ) : null
                            }
                        />
                    ) : (
                        <p className="panel p-card text-caption text-fg-3">No Pony Score games yet this season.</p>
                    )}
                </section>

                {/* Isolated impact: where on the ice he changes shots for and against, and its parts in goals. */}
                {isolate ? (
                    <section aria-labelledby="isolate-h" className="flex flex-col gap-3">
                        <h2 id="isolate-h" className="font-display text-h2 font-bold uppercase leading-none tracking-wide text-fg-1">
                            Isolated impact
                        </h2>
                        <IsolatedImpact view={isolate} prior={wowySeason !== SEASON_ID} seasonTag={seasonLabel(wowySeason).replace(/^\d\d/, '')} />
                    </section>
                ) : null}

                {/* With or without you: 5v5 with and apart from his most-used teammates. */}
                {!goalie && (wowy || (gp && wowySeason === SEASON_ID)) ? (
                    <section aria-labelledby="wowy-h" className="flex flex-col gap-3">
                        <h2 id="wowy-h" className="font-display text-h2 font-bold uppercase leading-none tracking-wide text-fg-1">
                            With or without
                        </h2>
                        {wowy ? (
                            <Wowy data={wowy} first={first} last={last} gp={gp} prior={wowySeason !== SEASON_ID} seasonTag={seasonLabel(wowySeason).replace(/^\d\d/, '')} />
                        ) : (
                            <p className="panel p-card text-caption text-fg-3">No teammate with enough 5v5 time together yet.</p>
                        )}
                    </section>
                ) : null}

                {/* Game log. */}
                {gp ? (
                    <section aria-labelledby="log-h" className="flex flex-col gap-3">
                        <h2 id="log-h" className="font-display text-h2 font-bold uppercase leading-none tracking-wide text-fg-1">
                            Game log
                        </h2>
                        <GameLog rows={goalie ? games.goalie : games.skater} goalie={goalie} games={data?.games ?? new Map()} color={color} />
                    </section>
                ) : null}

                {/* Career by season (NHL), then other leagues. */}
                {nhl.length ? (
                    <section aria-labelledby="career-h" className="flex flex-col gap-3">
                        <CareerSwitch
                            initial={sp.career === 'playoffs' ? 'playoffs' : 'regular'}
                            regular={<CareerViews nhl={nhl} other={other} career={profile?.career ?? null} goalie={goalie} birthDate={profile?.birthDate ?? null} />}
                            playoffs={
                                nhlPlayoffs.length ? (
                                    <CareerViews nhl={nhlPlayoffs} other={otherPlayoffs} career={profile?.careerPlayoffs ?? null} goalie={goalie} birthDate={profile?.birthDate ?? null} />
                                ) : null
                            }
                        />
                    </section>
                ) : null}

                {profile?.awards.length ? (
                    <section aria-labelledby="awards-h" className="flex flex-col gap-3">
                        <h2 id="awards-h" className="font-display text-h2 font-bold uppercase leading-none tracking-wide text-fg-1">
                            Awards
                        </h2>
                        <AwardShelf awards={profile.awards} />
                    </section>
                ) : null}
            </div>
        </main>
    );
}

/** One career view (regular season or playoffs): the NHL table, then the other leagues behind a tap. */
function CareerViews({ nhl, other, career, goalie, birthDate }: { nhl: SeasonLine[]; other: SeasonLine[]; career: SeasonLine | null; goalie: boolean; birthDate: string | null }) {
    return (
        <>
            <CareerTable lines={nhl} career={career} goalie={goalie} birthDate={birthDate} />
            {other.length ? (
                <details className={cn('group panel max-lg:overflow-hidden', FLAT)}>
                    <summary className="cursor-pointer list-none px-card py-3 text-micro uppercase tracking-label text-fg-3 hover:text-fg-1">
                        Before the NHL and other leagues · {other.length} seasons
                    </summary>
                    <div className="border-t border-line">
                        <CareerTable lines={other} career={null} goalie={goalie} birthDate={birthDate} bare showLeague />
                    </div>
                </details>
            ) : null}
        </>
    );
}
