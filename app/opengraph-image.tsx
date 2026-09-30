import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import { ImageResponse } from 'next/og';
import { clashSafePair, TEAM_NAMES } from '@/components/ui/team-color';
import { readableTextOn } from '@/components/ui/color';

export const alt = "Tonight's NHL games with Pony xG forecast win probabilities";
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const revalidate = 3600;

const HORSE =
    'm165.7 16.9-3.2 3.1a45 45 0 0 0-5.9 7.9 45 45 0 0 0-3.7 10c-1.2 5.9-2.9 8-7 8.8-1.6.3-1.9.2-2.9.8l-1.3.9c-9.3 6.4-18.9 8.3-25.4 14-13.9 12.1-17.9 41.3-36.8 74.1-13.2 22.8-28 18.5-41 26.6s-5.8-1.5-2-3.6c3.8-2 19.1-5.8 22-9.5l9.5-7.5s-1.6-7.7-5-11-11.1-4.9-11.1-4.9c-12.3-2.3-19.8-1.4-29.9-13.1-3-3.5-10-7.5-7-12.5 9 0 9.3 1 16.5-2.5 6.6-3.2 11.5-6 27-20.9C92 45.2 105.8 35.8 135.6 32c6.4-.9 11.2 3.7 11.9 2.5 3.9-7.5 5.1-18.4 12-20.5 3.9-1.2 7.6-9.3 9.5-8 2.4 1.7.5 2.5 1.3 8v7.5l1.2 8.1c6.2 0 14.8-1.1 19.7-5.6 7.6-7.1 11.8-6.5 12.3 0 0 8.2-3.3 10.9-7.5 17.8l-5.5 8.7L193 54c6.5 6.9 16.5 20.6 26.5 35 3.7 5.3 13.3 16.5 18 22.5 11.1 13.8 7.5 15.1 7.5 18.4-2.5 8.1-2.5 9.1-8.5 14.1-3.4 1.8-8 4-10 3.5-1-.2-3.5 0-7-3.5s-4.1-1.8-9-7.5c-3.1-3.6-8.7-5.4-11.5-6.6a144 144 0 0 0-24.8-7.4c-4.2-.7-8.6 10.2-10.2 14-.9 2.1-8 12.6-10 20s-7.1 9.1-5-1.1 15.2-28.8 17.5-33.4c1.3-2.5-6.6-2.1-12.5-5-12.4-5.9-15.5-6.5-18-21.5 0-4.9.7-15.1 4-16 2.4 0-1 7.1 0 15 2.1 16.6 11.1 19.5 30.1 23 11.8 2.2 26.1 6.2 32.8 9.1 4.1 1.8 7.5 4.5 12.6 9.9 6.9 7.3 7.1 7.5 11.9 7.5 4.4 0 5.3-.4 9.1-4.3 5.4-5.3 7.2-11 5.2-15.9-.8-1.9-3.9-6.3-6.9-9.8s-11.6-14.8-19-25-16-21.1-18.8-24.3a86 86 0 0 0-22.8-17.2 18 18 0 0 1-6.3-4.7 66 66 0 0 1-1.6-14zm16.4 16.2c-2.3.2-8.7 2.4-8.6 2.9.2.4 2.5 4.9 5.5 6.8l8.5 3.2 5.5-7c1.6-2.1 3-8.1 3-9.4 0-.2-2.2.4-4.9 1.4-2.7 1.1-6.7 2-9 2.1M128 36.9c-13 3-26.7 9.6-39 18.9a365 365 0 0 0-24 21.8A270 270 0 0 1 43.5 97a46 46 0 0 1-19.5 8h-3.4l4.3 4.4c7.6 7.7 18.3 7.2 29.7 12.6 3.7 1.7 6.2 2.1 9.4 4.6 4 3 8 9.9 8 9.9s15.5-27.1 21-49c2.5-9.9 18.1-28.1 25.5-33 5.7-3.8 22-12 24-12a25 25 0 0 0 5-3.5c.5-.9-11.6-3.9-19.5-2.1';

interface SlateGame {
    date: string;
    away: string;
    home: string;
    pAway: number;
    time?: string;
}

const SHORT_TO_TRI = Object.fromEntries(Object.entries(TEAM_NAMES).map(([tri, n]) => [n.short.toLowerCase(), tri]));

function toTri(row: Record<string, string>, side: 'home' | 'away'): string | undefined {
    const direct = row[`${side}_tricode`] || row[`${side}_abbrev`] || row[`${side}_tri`];
    if (direct && TEAM_NAMES[direct.toUpperCase()]) return direct.toUpperCase();
    const name = (row[`${side}_team`] || '').trim().toLowerCase();
    if (TEAM_NAMES[name.toUpperCase()]) return name.toUpperCase();
    return SHORT_TO_TRI[name] ?? Object.entries(TEAM_NAMES).find(([, n]) => n.name.toLowerCase() === name)?.[0];
}

function todayET(): string {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    return p; // YYYY-MM-DD
}

function loadSlate(): { date: string | null; games: SlateGame[] } {
    try {
        const csv = fs.readFileSync(path.join(process.cwd(), 'data/predictions_detailed.csv'), 'utf8');
        const rows = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true }).data;
        const games: SlateGame[] = [];
        for (const r of rows) {
            const away = toTri(r, 'away');
            const home = toTri(r, 'home');
            const pa = parseFloat(r.away_win_pct);
            const ph = parseFloat(r.home_win_pct);
            if (!away || !home || !r.game_date) continue;
            const pAway = Number.isFinite(pa) ? (pa > 1 ? pa / 100 : pa) : Number.isFinite(ph) ? 1 - (ph > 1 ? ph / 100 : ph) : NaN;
            if (!Number.isFinite(pAway)) continue;
            games.push({ date: r.game_date, away, home, pAway, time: r.game_start_time || undefined });
        }
        const dates = [...new Set(games.map(g => g.date))].sort();
        const today = todayET();
        const date = dates.find(d => d >= today) ?? dates[dates.length - 1] ?? null;
        return { date, games: games.filter(g => g.date === date).slice(0, 6) };
    } catch {
        return { date: null, games: [] };
    }
}

function prettyDate(iso: string | null): string {
    if (!iso) return 'Tonight';
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

const pct = (p: number) => `${Math.round(p * 100)}%`;

export default function OpengraphImage() {
    const { date, games } = loadSlate();
    const rowH = games.length > 4 ? 64 : 76;

    return new ImageResponse(
        (
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    background: 'radial-gradient(ellipse 90% 60% at 50% -10%, #0e2a33 0%, #05070B 60%)',
                    color: '#F5F7FA',
                    padding: '44px 56px',
                    fontFamily: 'sans-serif',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
                        <svg width="96" height="68" viewBox="8 2 244 172">
                            <path d={HORSE} fill="#4FF5F7" />
                        </svg>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <div style={{ fontSize: 22, letterSpacing: 4, color: '#22E6F5', textTransform: 'uppercase', fontWeight: 700 }}>Pony xG · Forecast win %</div>
                            <div style={{ fontSize: 46, fontWeight: 800, marginTop: 2 }}>{prettyDate(date)}</div>
                        </div>
                    </div>
                    <div style={{ display: 'flex', fontSize: 24, color: '#A9B4C2' }}>{games.length ? `${games.length} game${games.length === 1 ? '' : 's'}` : ''}</div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 34, flexGrow: 1 }}>
                    {games.length === 0 ? (
                        <div style={{ display: 'flex', fontSize: 34, color: '#A9B4C2', marginTop: 60 }}>No games on the slate — see you next game day.</div>
                    ) : (
                        games.map(g => {
                            const pair = clashSafePair(g.away, g.home);
                            const awayW = Math.max(6, Math.min(94, g.pAway * 100));
                            return (
                                <div key={`${g.away}-${g.home}`} style={{ display: 'flex', alignItems: 'center', height: rowH, gap: 18 }}>
                                    <div style={{ display: 'flex', width: 88, fontSize: 30, fontWeight: 800, justifyContent: 'flex-end' }}>{g.away}</div>
                                    <div style={{ display: 'flex', flexGrow: 1, height: rowH - 20, borderRadius: 12, overflow: 'hidden' }}>
                                        <div
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                width: `${awayW}%`,
                                                background: pair.away,
                                                color: readableTextOn(pair.away),
                                                fontSize: 28,
                                                fontWeight: 800,
                                                paddingLeft: 16,
                                                borderRight: '3px solid #05070B',
                                            }}
                                        >
                                            {pct(g.pAway)}
                                        </div>
                                        <div
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'flex-end',
                                                flexGrow: 1,
                                                background: pair.home,
                                                color: readableTextOn(pair.home),
                                                fontSize: 28,
                                                fontWeight: 800,
                                                paddingRight: 16,
                                            }}
                                        >
                                            {pct(1 - g.pAway)}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', width: 88, fontSize: 30, fontWeight: 800 }}>{g.home}</div>
                                </div>
                            );
                        })
                    )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 20, color: '#7C8796', marginTop: 12 }}>
                    <div style={{ display: 'flex' }}>Away @ Home · forecast (model + market), not betting advice</div>
                    <div style={{ display: 'flex', color: '#A9B4C2' }}>ponyxg.com</div>
                </div>
            </div>
        ),
        size,
    );
}
