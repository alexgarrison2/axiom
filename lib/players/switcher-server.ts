import { loadPonySeason, ponySeasons } from '@/lib/pony/data';
import { loadRatings } from '@/lib/players/server';
import { SEASON_ID } from '@/lib/season';
import { loadRoster } from '@/utils/team-stats/server-team';
import { TEAM_TRICODES } from '@/utils/team-stats/teams';
import { defaultHeadshot, ROSTER_BIT, type IndexRow, type PlayersIndexDoc } from './switcher';

/* Server-only (node:fs, NHL API at build). Never import from a client component.
 *
 * The player switcher's index: everyone with Pony Score games in the newest
 * two seasons plus every current NHL roster (api-web /v1/roster, the same
 * build-time read the team pages use; the ratings file and this season's
 * games stand in when a roster is unreachable). Team, number and position
 * come from the roster when he is on one, else from his latest games.
 */

interface Entry {
    id: number;
    first: string;
    last: string;
    team: string;
    pos: string;
    num: number | null;
    flags: number;
    headshot: string | null;
}

export async function buildPlayersIndex(): Promise<PlayersIndexDoc> {
    const seasons = ponySeasons().slice(0, 2);
    const byId = new Map<number, Entry>();

    // Newest season first: his latest team, number and headshot win.
    seasons.forEach((s, i) => {
        const data = loadPonySeason(s);
        if (!data) return;
        const played = new Set<number>();
        for (const r of data.skaters) played.add(r.player);
        for (const r of data.goalies) played.add(r.player);
        for (const p of data.players.values()) {
            if (!played.has(p.id)) continue;
            const e = byId.get(p.id);
            const bit = 1 << i;
            if (e) {
                e.flags |= bit;
                continue;
            }
            byId.set(p.id, { id: p.id, first: p.first, last: p.last, team: p.team, pos: p.pos, num: p.num, flags: bit, headshot: p.headshot });
        }
    });
    const ratings = loadRatings();
    const rosters = await Promise.all(TEAM_TRICODES.map(async tri => ({ tri, ...(await loadRoster(tri)) })));
    for (const { tri, players, source } of rosters) {
        const ids: { id: number; name: string; pos: string; num: number | null }[] = [];
        for (const r of players) {
            const id = Number(r.id);
            if (Number.isInteger(id) && id > 0) ids.push({ id, name: r.name, pos: r.pos, num: r.number });
        }
        // Fallback roster (skaters from the ratings file): add this season's goalies who last played for the team.
        if (source === 'fallback') {
            for (const e of byId.values()) if (e.flags & 1 && e.team === tri && e.pos === 'G') ids.push({ id: e.id, name: `${e.first} ${e.last}`, pos: 'G', num: e.num });
        }
        for (const r of ids) {
            const e = byId.get(r.id);
            const headshot = `https://assets.nhle.com/mugs/nhl/${SEASON_ID}/${tri}/${r.id}.png`;
            if (e) {
                Object.assign(e, { team: tri, pos: r.pos || e.pos, num: r.num ?? e.num, flags: e.flags | ROSTER_BIT, headshot });
            } else {
                const name = ratings.byId.get(r.id)?.name ?? r.name;
                const sp = name.indexOf(' ');
                byId.set(r.id, {
                    id: r.id,
                    first: sp > 0 ? name.slice(0, sp) : '',
                    last: sp > 0 ? name.slice(sp + 1) : name,
                    team: tri,
                    pos: r.pos,
                    num: r.num,
                    flags: ROSTER_BIT,
                    headshot,
                });
            }
        }
    }

    const doc: PlayersIndexDoc = { seasons, cur: SEASON_ID, players: [] };
    const rows: IndexRow[] = [...byId.values()]
        .sort((a, b) => a.id - b.id)
        .map(e => {
            const row: IndexRow = [e.id, e.first, e.last, e.team, e.pos, e.num, e.flags];
            if (e.headshot && e.headshot !== defaultHeadshot(doc, e.id, e.team, e.flags)) row.push(e.headshot);
            return row;
        });
    doc.players = rows;
    return doc;
}
