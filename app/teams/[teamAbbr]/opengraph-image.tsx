import fs from 'node:fs';
import path from 'node:path';
import { ImageResponse } from 'next/og';
import { SEASON_ID } from '@/lib/season';
import { leagueStandings } from '@/utils/team-stats/server';
import { buildTeamHero } from '@/utils/team-stats/server-team';
import { leaguesSummary } from '@/utils/team-stats/league-summary';
import { prevSeasonId, seasonLabel } from '@/utils/team-stats/season';
import { DIVISION_LABEL, isTeamTricode, teamMeta, TEAM_TRICODES } from '@/utils/team-stats/teams';

export const alt = 'Team record, expected goals and next game on Pony xG';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export function generateStaticParams() {
    return TEAM_TRICODES.map(teamAbbr => ({ teamAbbr }));
}

function logoDataUrl(tri: string): string | null {
    try {
        const svg = fs.readFileSync(path.join(process.cwd(), 'public', 'logos', `${tri}.svg`));
        return `data:image/svg+xml;base64,${svg.toString('base64')}`;
    } catch {
        return null;
    }
}

/** Share card: logo, record (or last season's, labelled), xGF%, special teams and the next game. */
export default async function Image({ params }: { params: Promise<{ teamAbbr: string }> }) {
    const { teamAbbr } = await params;
    const tri = isTeamTricode(teamAbbr.toUpperCase()) ? teamAbbr.toUpperCase() : 'EDM';
    const team = teamMeta(tri);
    const cur = leagueStandings(SEASON_ID).rows.find(r => r.tri === tri);
    const usePrev = !cur || cur.gp === 0;
    const season = usePrev ? prevSeasonId(SEASON_ID) : SEASON_ID;
    const rows = usePrev ? leagueStandings(season).rows : leagueStandings(SEASON_ID).rows;
    const s = rows.find(r => r.tri === tri);
    const k = leaguesSummary(rows).kpis(tri);
    const hero = buildTeamHero(tri);
    const logo = logoDataUrl(tri);
    const label = seasonLabel(season);
    const next = hero.nextGame;

    const stat = (name: string, value: string, sub?: string) => (
        <div style={{ display: 'flex', flexDirection: 'column', padding: '18px 24px', background: 'rgba(17,23,35,0.85)', borderRadius: 18, border: '1px solid rgba(255,255,255,0.12)', minWidth: 230 }}>
            <div style={{ fontSize: 22, color: '#a9b4c2' }}>{name}</div>
            <div style={{ fontSize: 46, fontWeight: 800, color: '#f5f7fa' }}>{value}</div>
            {sub ? <div style={{ fontSize: 20, color: '#7c8796' }}>{sub}</div> : null}
        </div>
    );

    return new ImageResponse(
        (
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    padding: 56,
                    background: `radial-gradient(circle at 0% 0%, ${team.color}55 0%, #05070b 60%)`,
                    color: '#f5f7fa',
                    fontFamily: 'sans-serif',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
                    {logo ? <img src={logo} width={150} height={150} alt="" /> : null}
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <div style={{ fontSize: 64, fontWeight: 900, letterSpacing: -1 }}>{team.name}</div>
                        <div style={{ fontSize: 28, color: '#a9b4c2' }}>
                            {`${DIVISION_LABEL[team.division]} Division · ${usePrev ? `${label} final` : `${label} season`}`}
                        </div>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 20, marginTop: 48 }}>
                    {stat(`${label} record`, s ? `${s.wins}-${s.losses}-${s.otl}` : '0-0-0', s ? `${s.points} PTS` : undefined)}
                    {stat('xGF%', k ? `${k.xgf_pct.toFixed(1)}%` : '—', k?.ranked ? `#${k.ranks.xgf_pct} in NHL` : undefined)}
                    {stat('PP / PK', k ? `${k.pp_pct.toFixed(0)} / ${k.pk_pct.toFixed(0)}` : '—', k?.ranked ? `#${k.ranks.pp_pct} / #${k.ranks.pk_pct}` : undefined)}
                    {hero.playoffOdds ? stat('Playoff odds', `${hero.playoffOdds.pct.toFixed(0)}%`) : null}
                </div>
                <div style={{ display: 'flex', marginTop: 'auto', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                    <div style={{ fontSize: 30, color: '#a9b4c2', display: 'flex' }}>
                        {next ? `Next: ${next.home ? 'vs' : '@'} ${next.opp} · ${next.date}${next.modelWinPct != null ? ` · forecast ${next.modelWinPct.toFixed(0)}%` : ''}` : ''}
                    </div>
                    <div style={{ fontSize: 34, fontWeight: 800, color: '#22e6f5' }}>pony xG</div>
                </div>
            </div>
        ),
        size,
    );
}
