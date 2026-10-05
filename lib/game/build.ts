/**
 * Raw NHL feeds -> GameModel. Pure (no I/O) so it runs in tests on saved
 * fixtures; lib/game/fetch.ts does the fetching.
 */
import type { EventType, GameEvent, GameModel, GameState, Player, Pos, Pregame, Shift, Side, Situation, Star, Strength } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = any;

const TYPE: Record<string, EventType> = {
    goal: 'goal',
    'shot-on-goal': 'shot',
    'missed-shot': 'miss',
    'blocked-shot': 'block',
    faceoff: 'faceoff',
    hit: 'hit',
    giveaway: 'giveaway',
    takeaway: 'takeaway',
    penalty: 'penalty',
};

const mmss = (s: string | null | undefined): number => {
    if (!s) return 0;
    const [m, sec] = s.split(':').map(Number);
    return (m || 0) * 60 + (sec || 0);
};

/** Game seconds at the start of a period. */
export function periodStart(period: number, otLength: number): number {
    return period <= 3 ? (period - 1) * 1200 : 3600 + (period - 4) * otLength;
}

/** "1451" -> away goalie, away skaters, home skaters, home goalie. */
export function parseSituation(code: string | null | undefined): Situation {
    const c = (code ?? '1551').padStart(4, '1');
    return { awayGoalie: c[0] === '1', away: Number(c[1]), home: Number(c[2]), homeGoalie: c[3] === '1' };
}

/** Skaters a side really has: an extra attacker for a pulled goalie is not a power play. */
export function effectiveSkaters(side: Side, s: Situation): number {
    const n = side === 'away' ? s.away : s.home;
    const goalie = side === 'away' ? s.awayGoalie : s.homeGoalie;
    return goalie ? n : n - 1;
}

export function strengthFor(side: Side, s: Situation): Strength {
    const own = effectiveSkaters(side, s);
    const opp = effectiveSkaters(side === 'away' ? 'home' : 'away', s);
    return own > opp ? 'pp' : own < opp ? 'sh' : 'ev';
}

const flipZone = (z: 'O' | 'N' | 'D'): 'O' | 'N' | 'D' => (z === 'O' ? 'D' : z === 'D' ? 'O' : 'N');

export interface RawFeeds {
    pbp: Raw;
    landing?: Raw | null;
    box?: Raw | null;
    shifts?: Raw | null;
    rightRail?: Raw | null;
}

export function buildGame(feeds: RawFeeds, xg: Map<number, number> | null, pregame: Pregame | null): GameModel {
    const { pbp } = feeds;
    const awayId: number = pbp.awayTeam.id;
    const homeId: number = pbp.homeTeam.id;
    const sideOfTeam = (id: number | undefined): Side | null => (id === awayId ? 'away' : id === homeId ? 'home' : null);
    const gameType = Number(pbp.gameType ?? 2);
    const otLength = gameType === 3 ? 1200 : 300;

    const players: Player[] = (pbp.rosterSpots ?? []).map(
        (r: Raw): Player => ({
            id: r.playerId,
            side: r.teamId === awayId ? 'away' : 'home',
            first: r.firstName?.default ?? '',
            last: r.lastName?.default ?? '',
            num: r.sweaterNumber ?? null,
            pos: (r.positionCode ?? 'C') as Pos,
            headshot: r.headshot ?? null,
        }),
    );
    const sideOf = new Map(players.map(p => [p.id, p.side]));

    let away = 0;
    let home = 0;
    const events: GameEvent[] = [];
    const shootout: GameModel['shootout'] = [];
    for (const play of pbp.plays ?? []) {
        const type = TYPE[play.typeDescKey];
        const period = play.periodDescriptor?.number ?? 1;
        const d = play.details ?? {};
        if (play.periodDescriptor?.periodType === 'SO') {
            if (type === 'goal' || type === 'shot' || type === 'miss') {
                const shooter = d.scoringPlayerId ?? d.shootingPlayerId ?? null;
                const side = (shooter && sideOf.get(shooter)) || sideOfTeam(d.eventOwnerTeamId);
                if (side) shootout.push({ side, player: shooter, goal: type === 'goal' });
            }
            continue;
        }
        if (!type) continue;
        const t = periodStart(period, otLength) + mmss(play.timeInPeriod);
        const situation = parseSituation(play.situationCode);

        let player: number | null = null;
        let otherId: number | null = null;
        let side: Side | null = null;
        const assists: number[] = [];
        switch (type) {
            case 'goal':
                player = d.scoringPlayerId ?? null;
                otherId = d.goalieInNetId ?? null;
                if (d.assist1PlayerId) assists.push(d.assist1PlayerId);
                if (d.assist2PlayerId) assists.push(d.assist2PlayerId);
                break;
            case 'shot':
            case 'miss':
                player = d.shootingPlayerId ?? null;
                otherId = d.goalieInNetId ?? null;
                break;
            case 'block':
                player = d.shootingPlayerId ?? null;
                otherId = d.blockingPlayerId ?? null;
                break;
            case 'faceoff':
                player = d.winningPlayerId ?? null;
                otherId = d.losingPlayerId ?? null;
                break;
            case 'hit':
                player = d.hittingPlayerId ?? null;
                otherId = d.hitteePlayerId ?? null;
                break;
            case 'giveaway':
            case 'takeaway':
                player = d.playerId ?? null;
                break;
            case 'penalty':
                player = d.committedByPlayerId ?? d.servedByPlayerId ?? null;
                otherId = d.drawnByPlayerId ?? null;
                break;
        }
        // The acting side from the player when known (the owner team of a blocked shot is not always the shooter's).
        side = (player != null && sideOf.get(player)) || sideOfTeam(d.eventOwnerTeamId);
        if (!side) continue;

        // Normalize coordinates: away shoots at the left net, home at the right.
        let x: number | null = typeof d.xCoord === 'number' ? d.xCoord : null;
        let y: number | null = typeof d.yCoord === 'number' ? d.yCoord : null;
        if (x != null && y != null) {
            const homeAttacksRight = play.homeTeamDefendingSide ? play.homeTeamDefendingSide === 'left' : true;
            // The acting team's attack direction in raw coordinates.
            const attacksRight = side === 'home' ? homeAttacksRight : !homeAttacksRight;
            const wantRight = side === 'home';
            if (attacksRight !== wantRight) {
                x = -x;
                y = -y;
            }
            // A blocked shot is located where it was blocked; still the shooter's attack.
        }
        const ownerSide = sideOfTeam(d.eventOwnerTeamId);
        let zone: GameEvent['zone'] = d.zoneCode === 'O' || d.zoneCode === 'N' || d.zoneCode === 'D' ? d.zoneCode : null;
        if (zone && ownerSide && ownerSide !== side) zone = flipZone(zone);

        const isShot = type === 'goal' || type === 'shot' || type === 'miss';
        const oppGoalie = side === 'away' ? situation.homeGoalie : situation.awayGoalie;
        events.push({
            id: play.eventId,
            t,
            period,
            clock: play.timeInPeriod ?? '00:00',
            type,
            side,
            player,
            other: otherId,
            assists,
            x,
            y,
            shotType: d.shotType ?? null,
            xg: isShot && xg ? (xg.get(play.eventId) ?? null) : null,
            situation,
            strength: strengthFor(side, situation),
            fiveOnFive: situation.away === 5 && situation.home === 5 && situation.awayGoalie && situation.homeGoalie,
            emptyNet: (isShot || type === 'block') && !oppGoalie,
            score: { away, home },
            zone,
            detail: type === 'miss' ? (d.reason ?? null) : type === 'penalty' ? (d.descKey ?? null) : null,
            minutes: type === 'penalty' ? (d.duration ?? null) : null,
            clip: type === 'goal' ? (d.highlightClipSharingUrl ?? null) : null,
        });
        if (type === 'goal') {
            if (side === 'away') away++;
            else home++;
        }
    }

    const shifts: Record<number, Shift[]> = {};
    for (const s of feeds.shifts?.data ?? []) {
        if (s.typeCode !== 517 || !s.playerId) continue;
        const base = periodStart(s.period, otLength);
        const a = base + mmss(s.startTime);
        const b = base + mmss(s.endTime);
        if (b <= a) continue;
        (shifts[s.playerId] ??= []).push([a, b]);
    }
    for (const list of Object.values(shifts)) list.sort((p, q) => p[0] - q[0]);

    const box: GameModel['box'] = {};
    const stats = feeds.box?.playerByGameStats;
    for (const sideKey of ['awayTeam', 'homeTeam'] as const) {
        for (const group of ['forwards', 'defense', 'goalies'] as const) {
            for (const p of stats?.[sideKey]?.[group] ?? []) {
                box[p.playerId] = {
                    pim: p.pim ?? 0,
                    plusMinus: p.plusMinus ?? 0,
                    shifts: p.shifts ?? 0,
                    foPct: typeof p.faceoffWinningPctg === 'number' ? p.faceoffWinningPctg : null,
                };
            }
        }
    }

    const stars: Star[] = (feeds.landing?.summary?.threeStars ?? []).map((s: Raw) => ({
        star: s.star,
        playerId: s.playerId,
        side: sideOf.get(s.playerId) ?? (s.teamAbbrev === pbp.awayTeam.abbrev ? 'away' : 'home'),
        line: s.position === 'G' ? `${s.savePctg != null ? `.${Math.round(s.savePctg * 1000)}` : ''} SV%` : `${s.goals ?? 0}G ${s.assists ?? 0}A`,
    }));

    const raw = String(pbp.gameState ?? 'FUT');
    const state: GameState = raw === 'OFF' || raw === 'FINAL' ? 'final' : raw === 'LIVE' || raw === 'CRIT' ? 'live' : 'pre';
    const lastPeriod = pbp.periodDescriptor?.number ?? 1;
    const end =
        state === 'final'
            ? Math.max(3600, ...events.map(e => e.t))
            : state === 'live'
              ? periodStart(lastPeriod, otLength) + (lastPeriod <= 3 ? 1200 : otLength) - mmss(pbp.clock?.timeRemaining)
              : 0;
    const outcomeType = pbp.gameOutcome?.lastPeriodType;

    const team = (t: Raw, side: Side) => ({
        side,
        id: t.id,
        tri: t.abbrev,
        name: t.commonName?.default ?? t.abbrev,
        place: t.placeName?.default ?? '',
        score: t.score ?? (side === 'away' ? away : home),
        sog: t.sog ?? 0,
    });

    // Official power-play line ("3/4") from the NHL game summary.
    const ppStat = (feeds.rightRail?.teamGameStats ?? []).find((c: Raw) => c.category === 'powerPlay');
    const official = ppStat ? { pp: { away: String(ppStat.awayValue), home: String(ppStat.homeValue) } } : null;

    const unscored = events.some(e => (e.type === 'goal' || e.type === 'shot' || e.type === 'miss') && e.xg == null);

    return {
        id: pbp.id,
        season: String(pbp.season),
        gameType,
        date: pbp.gameDate,
        startUtc: pbp.startTimeUTC,
        venue: pbp.venue?.default ?? null,
        state,
        outcome: state === 'final' ? (outcomeType === 'OT' || outcomeType === 'SO' ? outcomeType : 'REG') : null,
        live: state === 'live' ? { period: lastPeriod, remaining: pbp.clock?.timeRemaining ?? '', intermission: !!pbp.clock?.inIntermission } : null,
        otLength,
        end,
        teams: { away: team(pbp.awayTeam, 'away'), home: team(pbp.homeTeam, 'home') },
        players,
        events,
        shifts,
        box,
        shootout,
        stars,
        pregame,
        official,
        xgPending: unscored,
    };
}
