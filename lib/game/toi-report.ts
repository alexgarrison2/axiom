/**
 * The NHL's HTML time-on-ice reports (www.nhl.com/scores/htmlreports/<season>/TH|TV<game>.HTM,
 * home and visitor) list every completed shift and update during the game, while the JSON
 * shift-chart API stays empty until well after it. This turns a report into the JSON API's
 * shift rows, so a live game's on-ice views (rail, lines, units, matchups, zone starts,
 * goalies) fill in as it is played. A shift still in progress appears once it ends.
 */

export interface ToiPlayer {
    num: number;
    name: string;
    shifts: { period: number; start: string; end: string }[];
}

const clean = (s: string) =>
    s
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();

/** Players in report order, each with their shifts (period, start and end as elapsed "m:ss"). */
export function parseToiReport(html: string): ToiPlayer[] {
    const out: ToiPlayer[] = [];
    const heads = [...html.matchAll(/<td[^>]*class="playerHeading[^"]*"[^>]*>([\s\S]*?)<\/td>/g)];
    heads.forEach((h, i) => {
        const m = clean(h[1]).match(/^(\d+)\s+(.+)$/);
        if (!m) return;
        const seg = html.slice(h.index! + h[0].length, i + 1 < heads.length ? heads[i + 1].index : undefined);
        const shifts: ToiPlayer['shifts'] = [];
        for (const row of seg.matchAll(/<tr class="\s*(?:odd|even)Color">([\s\S]*?)<\/tr>/g)) {
            const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => clean(c[1]));
            // Shift #, period, "start elapsed / remaining", "end elapsed / remaining", duration, event.
            // The per-period summary rows under each player have no "elapsed / remaining" pairs.
            if (cells.length < 5 || !/^\d+$/.test(cells[0]) || !cells[2].includes('/') || !cells[3].includes('/')) continue;
            const period = cells[1] === 'OT' ? 4 : Number(cells[1]);
            const start = cells[2].split('/')[0].trim();
            const end = cells[3].split('/')[0].trim();
            if (!Number.isFinite(period) || !/^\d+:\d\d$/.test(start) || !/^\d+:\d\d$/.test(end)) continue;
            shifts.push({ period, start, end });
        }
        out.push({ num: Number(m[1]), name: m[2], shifts });
    });
    return out;
}

/** The report's game code: 2026020070 -> "020070". */
export const reportCode = (gameId: number) => String(gameId).slice(4);

/**
 * A team's report as shift-chart API rows, matched to player ids by sweater number on that
 * team's roster. Unmatched numbers are dropped.
 */
export function reportShiftRows(html: string, roster: Map<number, number>): ShiftRow[] {
    const rows: ShiftRow[] = [];
    for (const p of parseToiReport(html)) {
        const playerId = roster.get(p.num);
        if (!playerId) continue;
        for (const s of p.shifts) rows.push({ typeCode: 517, playerId, period: s.period, startTime: s.start, endTime: s.end });
    }
    return rows;
}

type ShiftRow = { typeCode: 517; playerId: number; period: number; startTime: string; endTime: string };

interface PbpPlay {
    periodDescriptor?: { number?: number };
    timeInPeriod?: string;
    situationCode?: string;
    details?: { goalieInNetId?: number; eventOwnerTeamId?: number };
}

const secs = (t: string | undefined) => {
    const m = /^(\d+):(\d\d)$/.exec(t ?? '');
    return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/**
 * The time-on-ice reports leave goalies out, so a live game's goalie "shifts" come from the
 * play-by-play: the goalie in net is the one each shot names (goalieInNetId), a pulled goalie is
 * the situation code's goalie flag at 0, and every stretch is cut at period ends. The last
 * stretch runs to the latest play (a game in progress) or the period's end (a finished one).
 */
export function goalieShiftRows(
    plays: PbpPlay[],
    teams: { away: number; home: number },
    opts: { otLength: number; final: boolean },
): ShiftRow[] {
    const rows: ShiftRow[] = [];
    const sides = ['away', 'home'] as const;
    const periodEnd = (p: number) => (p <= 3 ? 1200 : opts.otLength);
    const cur: Record<(typeof sides)[number], { id: number | null; open: { period: number; at: number } | null; seen: boolean }> = {
        away: { id: null, open: null, seen: false },
        home: { id: null, open: null, seen: false },
    };
    const close = (side: (typeof sides)[number], period: number, at: number) => {
        const c = cur[side];
        if (c.open && c.id != null && (period > c.open.period || at > c.open.at)) {
            rows.push({ typeCode: 517, playerId: c.id, period: c.open.period, startTime: clock(c.open.at), endTime: clock(period > c.open.period ? periodEnd(c.open.period) : at) });
        }
        c.open = null;
    };
    let lastPeriod = 1;
    let lastAt = 0;
    for (const p of plays) {
        const period = p.periodDescriptor?.number ?? lastPeriod;
        const at = secs(p.timeInPeriod);
        if (period > 5) break; // shootout rounds
        if (period !== lastPeriod) {
            for (const side of sides) {
                const had = cur[side].open != null;
                close(side, lastPeriod, periodEnd(lastPeriod));
                if (had || cur[side].id != null) cur[side].open = { period, at: 0 };
            }
        }
        // Situation code: away goalie, away skaters, home skaters, home goalie.
        const sc = p.situationCode;
        const inNet = { away: !sc || sc[0] !== '0', home: !sc || sc[3] !== '0' };
        const g = p.details?.goalieInNetId;
        const owner = p.details?.eventOwnerTeamId;
        if (g && owner) {
            const defending = owner === teams.away ? 'home' : owner === teams.home ? 'away' : null;
            if (defending) {
                const c = cur[defending];
                if (c.id !== g) {
                    close(defending, period, at);
                    // The first goalie a team shows was in from the opening faceoff.
                    c.open = c.seen ? { period, at } : { period: 1, at: 0 };
                    if (!c.seen && period > 1) {
                        for (let q = 1; q < period; q++) rows.push({ typeCode: 517, playerId: g, period: q, startTime: '0:00', endTime: clock(periodEnd(q)) });
                        c.open = { period, at: 0 };
                    }
                    c.id = g;
                    c.seen = true;
                }
            }
        }
        for (const side of sides) {
            const c = cur[side];
            if (!inNet[side] && c.open) close(side, period, at);
            else if (inNet[side] && !c.open && c.id != null) c.open = { period, at };
        }
        lastPeriod = period;
        lastAt = at;
    }
    for (const side of sides) close(side, lastPeriod, opts.final ? periodEnd(lastPeriod) : lastAt);
    return rows;
}
