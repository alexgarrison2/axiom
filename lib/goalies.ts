import fs from 'node:fs';
import path from 'node:path';
import type { PonySeason } from '@/lib/pony/data';

/** One goalie's season for the Goalies table (built from the per-game goalie logs). */
export interface GoalieRow {
    id: number;
    name: string;
    team: string;
    headshot: string | null;
    gp: number;
    w: number;
    l: number;
    o: number;
    sa: number;
    ga: number;
    xga: number;
    gsax: number;
    gaa: number | null;
    hdSa: number;
    hdGa: number;
    starts: number;
    /** Quality starts: SV% at least .903, or .885 on 20 shots or fewer. */
    qs: number;
    /** Really bad starts: SV% under .850. */
    rbs: number;
    /** Model GSAx per game (shrunk across seasons); null when unrated. */
    model: number | null;
    /** GSAx of his last ten games, oldest first. */
    trend: number[];
}

const QS_SV = 0.903;
const QS_LIGHT_SV = 0.885;
const RBS_SV = 0.85;

export function goalieRatings(): Record<string, { gsax_per_game?: number }> {
    try {
        return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'data', 'goalie_ratings.json'), 'utf8'));
    } catch {
        return {};
    }
}

/** Every goalie with a game that season. The model rating is today's (it spans seasons). */
export function goalieBoard(data: PonySeason, ratings: Record<string, { gsax_per_game?: number }>): GoalieRow[] {
    const by = new Map<number, PonySeason['goalies']>();
    for (const r of data.goalies) by.set(r.player, [...(by.get(r.player) ?? []), r]);
    const out: GoalieRow[] = [];
    for (const [id, rs] of by) {
        const p = data.players.get(id);
        if (!p) continue;
        rs.sort((a, b) => (a.date < b.date ? -1 : 1));
        const name = `${p.first} ${p.last}`;
        const sv = (r: (typeof rs)[number]) => (r.sa ? (r.sa - r.ga) / r.sa : 1);
        const starts = rs.filter(r => r.toi >= 1800);
        const toi = rs.reduce((a, r) => a + r.toi, 0);
        const ga = rs.reduce((a, r) => a + r.ga, 0);
        const dec = rs.map(r => r.box?.decision ?? null);
        const rating = ratings[name]?.gsax_per_game;
        out.push({
            id,
            name,
            team: rs[rs.length - 1].team,
            headshot: p.headshot,
            gp: rs.length,
            w: dec.filter(d => d === 'W').length,
            l: dec.filter(d => d === 'L').length,
            o: dec.filter(d => d === 'O').length,
            sa: rs.reduce((a, r) => a + r.sa, 0),
            ga,
            xga: Math.round(rs.reduce((a, r) => a + r.xga, 0) * 100) / 100,
            gsax: Math.round(rs.reduce((a, r) => a + r.ps, 0) * 100) / 100,
            gaa: toi ? Math.round(((ga * 3600) / toi) * 100) / 100 : null,
            hdSa: rs.reduce((a, r) => a + (r.box?.hdSa ?? 0), 0),
            hdGa: rs.reduce((a, r) => a + (r.box?.hdGa ?? 0), 0),
            starts: starts.length,
            qs: starts.filter(r => sv(r) >= QS_SV || (r.sa <= 20 && sv(r) >= QS_LIGHT_SV)).length,
            rbs: starts.filter(r => sv(r) < RBS_SV).length,
            model: typeof rating === 'number' ? Math.round(rating * 1000) / 1000 : null,
            trend: rs.slice(-10).map(r => Math.round(r.ps * 100) / 100),
        });
    }
    return out;
}
