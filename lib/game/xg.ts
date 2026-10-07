/**
 * Live pony xG: the xG v2 shot model scored from a game's play-by-play, so a
 * game in progress has per-shot xG before the nightly run publishes it.
 *
 * A line-for-line port of the pipeline's serving path:
 *   pipeline/bu/lake/parse.py   parse_events + apply_sides (events, rink side)
 *   pipeline/bu/xg/features.py  shot_features (the 33 model inputs)
 *   pipeline/bu/xg/rink.py      RinkAdjuster.adjust (dist_rink)
 *   pipeline/bu/xg/model.py     XGv2.predict (booster, Platt maps, empty net, penalty shot)
 * over the same committed artifacts (pipeline/models/xg2_*.json and
 * pipeline/bu/xg/models/handedness.json). lib/game/__tests__/xg.test.ts checks
 * it shot by shot against the Python scorer; change both sides together.
 *
 * Missing values are NaN throughout, as in the pandas original. Pure (no I/O).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Raw = any;

const NET_X = 89;
const BLUE_LINE_X = 25;
const SHOT_CODES = new Set([505, 506, 507, 508]);
const UNBLOCKED = new Set([505, 506, 507]);
const GOAL = 505;
const SHOT_TYPES = ['wrist', 'snap', 'slap', 'backhand', 'tip-in', 'deflected', 'wrap-around', 'poke', 'bat', 'between-legs', 'cradle'];
const PREV_TYPES = ['faceoff', 'shot-on-goal', 'missed-shot', 'blocked-shot', 'goal', 'hit', 'giveaway', 'takeaway', 'stoppage', 'penalty', 'delayed-penalty', 'period-start', 'failed-shot-attempt'];
const PREV_SHOT = new Set(['shot-on-goal', 'missed-shot', 'blocked-shot', 'goal']);

export type StrengthClass = '5v5' | 'PP' | 'SH' | '4v4' | '3v3' | 'EA' | 'EN' | 'PS';

interface Tree {
    feat: Int32Array;
    cond: Float32Array;
    left: Int32Array;
    right: Int32Array;
    defLeft: Uint8Array;
}

interface Platt {
    a: number;
    b: number;
}

export interface XgArtifacts {
    features: string[];
    trees: Tree[];
    baseMargin: number;
    calibrators: Record<string, Platt>;
    emptyNet: { mu: number[]; sd: number[]; coef: number[]; intercept: number } | null;
    penaltyShotRate: number;
    trainGoalRate: number;
    rink: Record<string, { src: number[]; dst: number[]; w: number }>;
    hand: Map<number, 'L' | 'R'>;
}

/** The committed artifacts (XGBoost's own booster JSON, the calibrators sidecar, handedness) -> scorer inputs. */
export function loadArtifacts(booster: Raw, side: Raw, handedness: Record<string, string>): XgArtifacts {
    const learner = booster.learner;
    const gb = learner.gradient_booster;
    if (gb.name !== 'gbtree' || learner.objective.name !== 'binary:logistic') {
        throw new Error(`xG v2: unsupported booster ${gb.name}/${learner.objective.name}`);
    }
    const trees = gb.model.trees.map((t: Raw): Tree => {
        if (t.split_type.some((v: number) => v !== 0) || Number(t.tree_param.size_leaf_vector) > 1) {
            throw new Error('xG v2: categorical or vector-leaf trees are not supported');
        }
        return {
            feat: Int32Array.from(t.split_indices),
            cond: Float32Array.from(t.split_conditions),
            left: Int32Array.from(t.left_children),
            right: Int32Array.from(t.right_children),
            defLeft: Uint8Array.from(t.default_left, Number),
        };
    });
    if (Number(gb.model.gbtree_model_param.num_parallel_tree) !== 1) throw new Error('xG v2: forests are not supported');
    // base_score is stored as a probability ("[6.7903146E-2]"); the margin starts at its logit.
    const base = Number(String(learner.learner_model_param.base_score).replace(/[[\]]/g, ''));
    const meta = side.meta ?? {};
    const features: string[] = meta.features;
    if (!Array.isArray(features) || features.length !== Number(learner.learner_model_param.num_feature)) {
        throw new Error('xG v2: feature list does not match the booster');
    }
    const en = side.empty_net;
    const hand = new Map<number, 'L' | 'R'>();
    for (const [k, v] of Object.entries(handedness)) if (v === 'L' || v === 'R') hand.set(Number(k), v);
    return {
        features,
        trees,
        baseMargin: Math.log(base / (1 - base)),
        calibrators: side.calibrators ?? {},
        emptyNet: en && Array.isArray(en.coef) ? { mu: en.mu, sd: en.sd, coef: en.coef, intercept: en.intercept } : null,
        penaltyShotRate: side.penalty_shot_rate ?? 0.32,
        trainGoalRate: meta.train_goal_rate ?? 0.07,
        rink: side.rink?.knots ?? {},
        hand,
    };
}

// ------------------------------------------------------------------ helpers

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const toNum = (v: unknown): number => (v == null || v === '' ? NaN : Number(v));
const deg = (r: number) => (r * 180) / Math.PI;

function mmss(s: unknown): number {
    if (typeof s !== 'string' || !s.includes(':')) return NaN;
    const [m, sec] = s.split(':');
    const a = Number.parseInt(m, 10);
    const b = Number.parseInt(sec, 10);
    return /^\s*[-+]?\d+\s*$/.test(m) && /^\s*[-+]?\d+\s*$/.test(sec) ? a * 60 + b : NaN;
}

/** '1551' -> [away_g, away_sk, home_sk, home_g]; null if malformed. */
function splitSituation(code: unknown): [number, number, number, number] | null {
    if (code == null) return null;
    const s = String(code).trim();
    if (!/^\d{4}$/.test(s)) return null;
    return [Number(s[0]), Number(s[1]), Number(s[2]), Number(s[3])];
}

/** np.interp: linear, clamped to the end values. */
function interp(x: number, xp: number[], fp: number[]): number {
    if (Number.isNaN(x)) return NaN;
    const n = xp.length;
    if (x <= xp[0]) return fp[0];
    if (x >= xp[n - 1]) return fp[n - 1];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (xp[mid] <= x) lo = mid;
        else hi = mid;
    }
    return fp[lo] + ((x - xp[lo]) * (fp[hi] - fp[lo])) / (xp[hi] - xp[lo]);
}

// ------------------------------------------------------------------ events (parse.py)

interface Ev {
    eventId: number;
    sortOrder: number;
    period: number;
    periodType: string | null;
    periodSeconds: number;
    gameSeconds: number;
    typeCode: number;
    typeDesc: string | null;
    situation: string | null;
    sit: [number, number, number, number] | null;
    eventTeamId: number;
    x: number;
    y: number;
    zone: string | null;
    homeDefSideRaw: string | null;
    shotType: string | null;
    shooterId: number;
    actingTeamId: number;
    actingIsHome: boolean | null;
    eventTeamIsHome: boolean | null;
    ownSk: number;
    oppSk: number;
    emptyNetAgainst: boolean | null;
    ownGoaliePulled: boolean | null;
    isShootout: boolean;
    isPenaltyShot: boolean;
    homeScore: number;
    awayScore: number;
    xHome: number;
    yHome: number;
}

function parseEvents(pbp: Raw): Ev[] {
    const homeId = toNum(pbp.homeTeam?.id);
    const awayId = toNum(pbp.awayTeam?.id);
    const rosterTeam = new Map<number, number>();
    for (const r of pbp.rosterSpots ?? []) if (r.playerId != null) rosterTeam.set(Number(r.playerId), toNum(r.teamId));

    const plays = [...(pbp.plays ?? [])].sort((a: Raw, b: Raw) => (a.sortOrder || 0) - (b.sortOrder || 0) || (a.eventId || 0) - (b.eventId || 0));
    const out: Ev[] = [];
    let curH = 0;
    let curA = 0;
    for (const p of plays) {
        const d = p.details ?? {};
        const pd = p.periodDescriptor ?? {};
        const period = toNum(pd.number);
        const ptype: string | null = pd.periodType ?? null;
        const tc = toNum(p.typeCode);
        const psec = mmss(p.timeInPeriod);
        const sit = splitSituation(p.situationCode);
        const owner = toNum(d.eventOwnerTeamId);
        const isShot = SHOT_CODES.has(tc);

        let shooter = NaN;
        if (isShot) {
            shooter = tc === GOAL ? toNum(d.scoringPlayerId) : toNum(d.shootingPlayerId);
            if (Number.isNaN(shooter)) shooter = toNum(d.shootingPlayerId);
        }
        // Shooting team: the shooter's roster team (blocked-shot ownership changed over the years), else the owner.
        let shootTeam = NaN;
        if (isShot) {
            const t = isNum(shooter) ? rosterTeam.get(shooter) : undefined;
            if (t != null && !Number.isNaN(t)) shootTeam = t;
            else {
                shootTeam = owner;
                if (tc === 508) {
                    const bid = toNum(d.blockingPlayerId);
                    const bteam = isNum(bid) ? rosterTeam.get(bid) : undefined;
                    if (bteam != null && owner === bteam) shootTeam = owner === homeId ? awayId : homeId;
                }
            }
        }
        const acting = isShot ? shootTeam : owner;
        const actingIsHome = Number.isNaN(acting) ? null : acting === homeId;
        let ownSk = NaN;
        let oppSk = NaN;
        let ownG = NaN;
        let oppG = NaN;
        if (actingIsHome != null && sit) {
            const [ag, ask, hsk, hg] = sit;
            [ownSk, oppSk, ownG, oppG] = actingIsHome ? [hsk, ask, hg, ag] : [ask, hsk, ag, hg];
        }
        out.push({
            eventId: toNum(p.eventId),
            sortOrder: toNum(p.sortOrder),
            period,
            periodType: ptype,
            periodSeconds: psec,
            gameSeconds: isNum(period) && period !== 0 && !Number.isNaN(psec) ? (period - 1) * 1200 + psec : NaN,
            typeCode: tc,
            typeDesc: p.typeDescKey ?? null,
            situation: p.situationCode == null ? null : String(p.situationCode),
            sit,
            eventTeamId: owner,
            x: toNum(d.xCoord),
            y: toNum(d.yCoord),
            zone: d.zoneCode ?? null,
            homeDefSideRaw: p.homeTeamDefendingSide ?? null,
            shotType: d.shotType ?? null,
            shooterId: shooter,
            actingTeamId: acting,
            actingIsHome,
            eventTeamIsHome: Number.isNaN(owner) ? null : owner === homeId,
            ownSk,
            oppSk,
            emptyNetAgainst: Number.isNaN(oppG) ? null : oppG === 0,
            ownGoaliePulled: Number.isNaN(ownG) ? null : ownG === 0,
            isShootout: ptype === 'SO',
            isPenaltyShot: ownSk === 1 && oppSk === 0,
            homeScore: curH,
            awayScore: curA,
            xHome: NaN,
            yHome: NaN,
        });
        if (tc === GOAL && ptype !== 'SO') {
            const hs = d.homeScore;
            const as = d.awayScore;
            if (hs != null && as != null) {
                curH = Number(hs);
                curA = Number(as);
            } else if (owner === homeId) curH++;
            else if (owner === awayId) curA++;
        }
    }
    applySides(out);
    return out;
}

/** Per-period home defending side: the feed's field (most common value), else a vote over zone codes (sides.py). */
function applySides(ev: Ev[]) {
    const periods = [...new Set(ev.map(e => e.period).filter(p => !Number.isNaN(p)))];
    const sideOf = new Map<number, 'left' | 'right' | null>();
    for (const period of periods) {
        const g = ev.filter(e => e.period === period);
        if (g.every(e => e.periodType === 'SO')) {
            sideOf.set(period, null);
            continue;
        }
        const counts = new Map<string, number>();
        for (const e of g) if (e.homeDefSideRaw != null) counts.set(e.homeDefSideRaw, (counts.get(e.homeDefSideRaw) ?? 0) + 1);
        // pandas mode(): most frequent, ties broken by sort order
        const raw = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? null;
        let s = 0;
        let n = 0;
        for (const e of g) {
            if (Number.isNaN(e.x) || e.x === 0 || (e.zone !== 'O' && e.zone !== 'D') || e.eventTeamIsHome == null) continue;
            s += Math.sign(e.x) * (e.zone === 'O' ? 1 : -1) * (e.eventTeamIsHome ? 1 : -1);
            n++;
        }
        const vote = n && s !== 0 ? (s > 0 ? 'left' : 'right') : null;
        sideOf.set(period, raw === 'left' || raw === 'right' ? raw : vote);
    }
    for (const e of ev) {
        const side = sideOf.get(e.period) ?? null;
        const homeRight = side === 'left' ? 1 : side === 'right' ? -1 : NaN;
        e.xHome = e.x * homeRight;
        e.yHome = e.y * homeRight;
    }
}

// ------------------------------------------------------------------ features (features.py)

export interface ShotRow {
    eventId: number;
    strengthClass: StrengthClass;
    f: Record<string, number>;
}

function strengthClass(own: number, opp: number, en: boolean | null, pulled: boolean | null, ps: boolean): StrengthClass {
    if (ps) return 'PS';
    if (en) return 'EN';
    if (pulled) return 'EA';
    if (own < opp) return 'SH';
    if (own > opp) return 'PP';
    if (own === opp && own === 3) return '3v3';
    if (own === opp && own === 4) return '4v4';
    return '5v5';
}

const signedAngle = (x: number, y: number) => deg(Math.atan2(y, NET_X - x));

export function shotFeatures(pbp: Raw, art: Pick<XgArtifacts, 'hand' | 'rink'>): ShotRow[] {
    const ev = parseEvents(pbp);
    // features.py re-sorts by (sort_order, event_id) with missing values last (pandas na_position)
    const key = (v: number) => (Number.isNaN(v) ? Infinity : v);
    const idx = ev.map((_, i) => i).sort((a, b) => key(ev[a].sortOrder) - key(ev[b].sortOrder) || key(ev[a].eventId) - key(ev[b].eventId) || a - b);
    const evs = idx.map(i => ev[i]);
    const homeTeam = String(toNum(pbp.homeTeam?.id));
    const knots = art.rink[homeTeam];
    const isPlayoff = Number(pbp.gameType ?? String(pbp.id).slice(4, 6)) === 3 ? 1 : 0;

    const rows: ShotRow[] = [];
    let foT = NaN;
    let scT = NaN;
    for (let i = 0; i < evs.length; i++) {
        const e = evs[i];
        if (e.typeDesc === 'faceoff' && !Number.isNaN(e.gameSeconds)) foT = e.gameSeconds;
        const prevSit = i > 0 ? evs[i - 1].situation : null;
        const changed = i === 0 || (e.situation != null && prevSit != null && e.situation !== prevSit);
        if (changed && !Number.isNaN(e.gameSeconds)) scT = e.gameSeconds;
        if (!UNBLOCKED.has(e.typeCode) || e.isShootout) continue;

        // Previous event within the same period (any type).
        const p = i > 0 && evs[i - 1].period === e.period ? evs[i - 1] : null;
        const home = e.actingIsHome;
        const sign = home == null ? NaN : home ? 1 : -1;
        const xs = e.xHome * sign;
        const ys = e.yHome * sign;
        const dx = NET_X - xs;
        const distance = Math.sqrt(dx * dx + ys * ys);
        const st = e.shotType == null ? -1 : SHOT_TYPES.indexOf(e.shotType);
        const h = isNum(e.shooterId) ? art.hand.get(e.shooterId) : undefined;
        const offWing = Number.isNaN(ys) || !h ? NaN : h === 'L' ? Number(ys < 0) : Number(ys > 0);

        const pt = p?.typeDesc ?? null;
        const ptCode = pt == null ? -1 : PREV_TYPES.indexOf(pt);
        const pteam = p ? p.actingTeamId : NaN;
        const same = Number.isNaN(pteam) || Number.isNaN(e.actingTeamId) ? NaN : Number(pteam === e.actingTeamId);
        let dt = p ? e.gameSeconds - p.gameSeconds : NaN;
        if (dt < 0) dt = 0;
        const px = (p ? p.xHome : NaN) * sign;
        const py = (p ? p.yHome : NaN) * sign;
        const distPrev = Math.sqrt((xs - px) ** 2 + (ys - py) ** 2);
        const dtFloor = Number.isNaN(dt) ? NaN : Math.max(dt, 1);
        const prevIsShot = pt != null && PREV_SHOT.has(pt);
        let ach = 0;
        if (prevIsShot) {
            ach = Math.abs(signedAngle(xs, ys) - signedAngle(px, py));
            if (ach > 180) ach = 360 - ach;
        }
        const reb = prevIsShot && same === 1 && dt <= 3;
        // rush: previous event outside the offensive zone (shooter's frame) within 4 s
        const flip = p != null && p.actingIsHome != null && home != null && p.actingIsHome !== home;
        const pz = p?.zone ?? null;
        const zoneS = flip ? (pz === 'O' ? 'D' : pz === 'D' ? 'O' : pz === 'N' ? 'N' : null) : pz;
        const outside = Number.isNaN(px) ? zoneS === 'N' || zoneS === 'D' : px < BLUE_LINE_X;
        const t = e.gameSeconds;
        const diff = home === false ? e.awayScore - e.homeScore : e.homeScore - e.awayScore;
        const own = e.ownSk;
        const opp = e.oppSk;

        rows.push({
            eventId: e.eventId,
            strengthClass: strengthClass(own, opp, e.emptyNetAgainst, e.ownGoaliePulled, e.isPenaltyShot),
            f: {
                distance,
                angle: deg(Math.atan2(Math.abs(ys), dx)),
                x_s: xs,
                y_s: ys,
                abs_y: Math.abs(ys),
                behind_net: Number.isNaN(xs) ? NaN : Number(xs > NET_X),
                dist_rink: knots ? knots.w * interp(distance, knots.src.map((v, k) => v + k * 1e-6), knots.dst) + (1 - knots.w) * distance : distance,
                shot_type_code: st < 0 ? NaN : st,
                hand_code: h === 'L' ? 0 : h === 'R' ? 1 : NaN,
                off_wing: offWing,
                own_skaters: own,
                opp_skaters: opp,
                skater_diff: own - opp,
                own_goalie_pulled: e.ownGoaliePulled == null ? NaN : Number(e.ownGoaliePulled),
                prev_type_code: ptCode < 0 ? NaN : ptCode,
                prev_same_team: same,
                dt_prev: dt,
                prev_x_s: px,
                prev_y_s: py,
                dist_prev: distPrev,
                speed_prev: distPrev / dtFloor,
                angle_change: ach,
                angle_speed: ach / dtFloor,
                is_rebound: Number(reb),
                is_rush: Number(dt <= 4 && outside && !reb),
                secs_since_faceoff: t - foT,
                secs_since_strength_change: t - scT,
                score_diff: Math.min(3, Math.max(-3, diff)),
                period: Math.min(e.period, 4),
                period_seconds: e.periodSeconds,
                game_seconds: Math.min(t, 3900),
                is_home: home == null ? NaN : Number(home),
                is_playoff: isPlayoff,
            },
        });
    }
    return rows;
}

// ------------------------------------------------------------------ model (model.py)

/** XGBoost tree walk: features and thresholds compared in float32, missing values follow default_left. */
function boosterProb(art: XgArtifacts, x: Float64Array): number {
    let margin = art.baseMargin;
    for (const t of art.trees) {
        let n = 0;
        while (t.left[n] !== -1) {
            const v = x[t.feat[n]];
            n = Number.isNaN(v) ? (t.defLeft[n] ? t.left[n] : t.right[n]) : Math.fround(v) < t.cond[n] ? t.left[n] : t.right[n];
        }
        margin += t.cond[n];
    }
    return 1 / (1 + Math.exp(-margin));
}

const logit = (p: number) => {
    const q = Math.min(1 - 1e-6, Math.max(1e-6, p));
    return Math.log(q / (1 - q));
};

/** Raw xG v2 (before the pipeline's league normalisation) per unblocked shot, keyed by NHL event id. */
export function scoreGame(pbp: Raw, art: XgArtifacts): Map<number, number> {
    const out = new Map<number, number>();
    const x = new Float64Array(art.features.length);
    for (const r of shotFeatures(pbp, art)) {
        const sc = r.strengthClass;
        const d = r.f.distance;
        let p = NaN;
        if (sc === 'PS') p = art.penaltyShotRate;
        else if (sc === 'EN') {
            if (!Number.isNaN(d) && art.emptyNet) {
                const { mu, sd, coef, intercept } = art.emptyNet;
                const a = Number.isNaN(r.f.angle) ? 30 : r.f.angle;
                const z = [d, Math.log1p(d), a].reduce((s, v, k) => s + ((v - mu[k]) / sd[k]) * coef[k], intercept);
                p = 1 / (1 + Math.exp(-z));
            }
        } else if (!Number.isNaN(d)) {
            art.features.forEach((name, k) => (x[k] = r.f[name] ?? NaN));
            p = boosterProb(art, x);
            const cal = art.calibrators[sc] ?? art.calibrators._pooled;
            if (cal) p = 1 / (1 + Math.exp(-(cal.a + cal.b * logit(p))));
        }
        if (Number.isNaN(p)) p = art.trainGoalRate;
        if (!Number.isNaN(r.eventId) && !out.has(r.eventId)) out.set(r.eventId, Math.min(0.999, Math.max(1e-4, p)));
    }
    return out;
}
