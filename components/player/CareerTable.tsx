import * as React from 'react';
import { ScrollRegion } from '@/components/ui/scroll-region';
import { cn } from '@/lib/utils';
import { groupBySeason, seasonAge } from '@/lib/players/career';
import type { SeasonLine } from '@/lib/players/landing';
import { leagueLogo, teamLogo, type TeamLogo } from '@/lib/players/logos';

/*
 * Career by season on the player page: the NHL table and the other-leagues
 * table. Rows of one season (a trade, or a club season plus a tournament) read
 * as one block: season and age on its first row only, a faint divider inside the
 * block, the normal one between blocks, and a band per season, not per row.
 * League and team logos are visual aids next to the text, which stays the label.
 */

// Below lg the wide tables scroll sideways under a pinned Season + Age.
const PIN = 'max-lg:sticky max-lg:z-10';
// The pinned block's right hairline (a pseudo-element: collapsed table cells drop box-shadow).
const PIN_EDGE = "max-lg:after:pointer-events-none max-lg:after:absolute max-lg:after:inset-y-0 max-lg:after:right-0 max-lg:after:w-px max-lg:after:bg-line-strong max-lg:after:content-['']";
// Season cell width, so the pinned Age cell can sit right after it.
const SEASON_W = 'w-[4.5rem] min-w-[4.5rem] max-lg:left-0';
const AGE_LEFT = 'max-lg:left-[4.5rem]';
const FLAT = 'max-lg:bg-none max-lg:bg-surface-1';
// Opaque band fills, so pinned cells cover what scrolls under them.
const BAND = ['max-lg:bg-surface-1', 'max-lg:bg-[color-mix(in_srgb,var(--text-1)_3%,var(--surface-1))]'] as const;
const ROW_BAND = ['', 'bg-[color-mix(in_srgb,var(--text-1)_3%,transparent)]'] as const;

const seasonLabel = (s: number) => `${String(s).slice(0, 4)}-${String(s).slice(6)}`;

/** A 20px logo slot; empty slots keep the names in one column. Decorative: the text beside it is the label. */
function Logo({ logo, src }: { logo?: TeamLogo | null; src?: string | null }) {
    const url = logo?.src ?? src ?? null;
    const flag = logo?.kind === 'flag';
    return (
        <span aria-hidden="true" className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
            {url ? (
                // eslint-disable-next-line @next/next/no-img-element -- small static logos, no optimisation needed
                <img
                    src={url}
                    alt=""
                    width={20}
                    height={flag ? 15 : 20}
                    loading="lazy"
                    decoding="async"
                    className={cn('object-contain', flag ? 'h-[15px] w-5 rounded-[2px]' : 'h-5 w-5')}
                />
            ) : null}
        </span>
    );
}

export function CareerTable({
    lines,
    career,
    goalie,
    birthDate,
    bare,
    showLeague,
}: {
    lines: SeasonLine[];
    career: SeasonLine | null;
    goalie: boolean;
    birthDate: string | null;
    bare?: boolean;
    showLeague?: boolean;
}) {
    const cols: [string, (s: SeasonLine) => React.ReactNode][] = goalie
        ? [
              ['GP', s => s.gp],
              ['W', s => s.w ?? '—'],
              ['L', s => s.l ?? '—'],
              ['OTL', s => s.otl ?? '—'],
              ['GAA', s => (s.gaa != null ? s.gaa.toFixed(2) : '—')],
              ['SV%', s => (s.svPct != null ? s.svPct.toFixed(3).replace(/^0/, '') : '—')],
              ['SO', s => s.so ?? '—'],
          ]
        : [
              ['GP', s => s.gp],
              ['G', s => s.g ?? '—'],
              ['A', s => s.a ?? '—'],
              ['Pts', s => s.p ?? '—'],
              ['Pts/G', s => (s.p != null && s.gp ? (s.p / s.gp).toFixed(2) : '—')],
              ['+/−', s => (s.pm != null ? (s.pm > 0 ? `+${s.pm}` : s.pm) : '—')],
              ['PIM', s => s.pim ?? '—'],
              ['PPG', s => s.ppg ?? '—'],
              ['SOG', s => s.shots ?? '—'],
              // The feed gives S% as a fraction (NHL, best-on-best) or a percent (junior and most leagues).
              ['S%', s => (s.shPct != null ? (s.shPct > 1 ? s.shPct : s.shPct * 100).toFixed(1) : '—')],
              ['TOI', s => s.toi ?? '—'],
          ];
    const rows = groupBySeason(lines);
    return (
        <ScrollRegion label={showLeague ? 'Other leagues' : 'NHL career'} stickyStart className={cn(!bare && cn('panel', FLAT))}>
            <table className="w-full min-w-[45rem] border-collapse text-caption tabular-nums">
                <thead>
                    <tr className="border-b border-line text-micro uppercase tracking-label text-fg-3">
                        <th className={cn('px-3 py-2 text-left font-semibold max-lg:bg-surface-1', PIN, SEASON_W)}>Season</th>
                        <th className={cn('px-2 py-2 text-right font-semibold max-lg:bg-surface-1', PIN, AGE_LEFT, PIN_EDGE)}>Age</th>
                        <th className="px-2 py-2 text-left font-semibold">{showLeague ? 'League · team' : 'Team'}</th>
                        {cols.map(([k]) => (
                            <th key={k} className="px-2 py-2 text-right font-semibold">
                                {k}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map(({ line: s, first, last, band }, i) => {
                        const age = seasonAge(birthDate, s.season);
                        const team = teamLogo(s.league, s.team, s.season);
                        return (
                            <tr key={`${s.season}-${s.league}-${s.team}-${i}`} className={cn(ROW_BAND[band], last ? 'border-b border-line/60' : 'border-b border-line/20')}>
                                <td className={cn('px-3 py-1.5', PIN, SEASON_W, BAND[band], first ? 'text-fg-2' : 'text-transparent')}>
                                    {/* Repeat rows keep the season for screen readers but draw it blank. */}
                                    <span className={first ? undefined : 'sr-only'}>{seasonLabel(s.season)}</span>
                                </td>
                                <td className={cn('px-2 py-1.5 text-right text-fg-3', PIN, AGE_LEFT, PIN_EDGE, BAND[band])}>
                                    <span className={first ? undefined : 'sr-only'}>{age ?? '—'}</span>
                                </td>
                                <td className="px-2 py-1 text-fg-1">
                                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                                        {showLeague ? <Logo src={leagueLogo(s.league, s.season)} /> : null}
                                        <Logo logo={team} />
                                        <span>{showLeague ? `${s.league} · ${s.team}` : s.team}</span>
                                    </span>
                                </td>
                                {cols.map(([k, f]) => (
                                    <td key={k} className="px-2 text-right text-fg-1">
                                        {f(s)}
                                    </td>
                                ))}
                            </tr>
                        );
                    })}
                </tbody>
                {career ? (
                    <tfoot>
                        <tr className="border-t border-line-strong font-semibold">
                            <td className="px-3 py-2 uppercase tracking-label text-fg-1 max-lg:hidden" colSpan={3}>
                                NHL career
                            </td>
                            {/* Below lg the label takes the pinned cells (a multi-column cell can't pin). */}
                            <td className={cn('px-3 py-2 uppercase tracking-label text-fg-1 max-lg:bg-surface-1 lg:hidden', PIN, SEASON_W)}>Career</td>
                            <td className={cn('max-lg:bg-surface-1 lg:hidden', PIN, AGE_LEFT, PIN_EDGE)} />
                            <td className="lg:hidden" />
                            {cols.map(([k, f]) => (
                                <td key={k} className="px-2 text-right text-fg-1">
                                    {f(career)}
                                </td>
                            ))}
                        </tr>
                    </tfoot>
                ) : null}
            </table>
        </ScrollRegion>
    );
}
