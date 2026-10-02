"""Vectorised continuous-time game simulator (one game, ``n`` simulations at once).

State per simulation: clock (game seconds), score, each team's penalty slots (two releasable
minor slots, one of them possibly a double minor, and one non-releasable slot for majors and
coincidental 4v4 minors), and each team's pulled-goalie window.  Between events every hazard is
constant, so each round draws one exponential waiting time per simulation and either resolves
an event (home goal, away goal, home penalty, away penalty, coincidental minors) or advances to
the next scheduled change (period end, a penalty expiring, a goalie being pulled / returning).

Goal hazard of the attacking team X in state (own skaters, opposing skaters, own goalie, opposing
goalie), with r[state] the league goal rate of the state relative to 5v5:

  5v5 / 4v4 / 3v3      L5 * r * E_X * C_X * se[segment, score from X's view]
                       (segments: P1, P2, P3 0-10 / 10-18 / 18-20 min)
  power play           L5 * r * P_X * C_X * Lpp / (L5 * r[5v4])
  shorthanded          L5 * r * C_X
  extra attacker       L5 * r * E_X * C_X            (X's goalie pulled)
  empty net            L5 * r                        (Y's goalie pulled)
  3v3 OT (reg. season) L5 * r_ot * E_X * C_X

all times the game's pace shock Z (Gamma, mean 1, shared), X's team shock Z_X, the anchoring
pace and exp(+-tilt / 2).  Penalty hazard of X: Lpen * Q_X * pen_score[score] *
pen_period[period] * pen_state (5v5 or not), split minor / double / major; coincidental minors
(4v4 for two minutes) at 5v5 at a league rate.  A power-play goal ends the shortest releasable
minor of the shorthanded team (a double minor's first half).  Pulled goalies: the trailing team
in the 3rd period has its goalie out while the seconds left lie in the window where the fitted
pull curve of its deficit exceeds the simulation's own uniform draw (comonotone across the
period, so the time pulled matches the league curve exactly).  Regular-season ties after 60
minutes play 5 minutes of sudden-death 3v3 (penalties add skaters to the other side), then a
shootout won by the home team with probability ``so_home``; playoff ties play 20-minute 5v5
sudden-death periods.  Delayed-penalty extra attackers are not modelled (about 0.03 goals a
game; the league level absorbs them).
"""
from __future__ import annotations

import numpy as np

REG_END = 3600.0
P3_SEG = (3000.0, 3480.0)        # score-effect segments in the 3rd period (10 and 18 minutes in)
OT_LEN = 300.0
PO_OT_LEN = 1200.0
MAX_PO_OT = 6
INF = 1e18


def state_index(sk, osk, g, og):
    return ((np.asarray(sk) - 3) * 4 + (np.asarray(osk) - 3)) * 4 + np.asarray(g) * 2 + np.asarray(og)


def _fallback_key(sk, osk, g, og):
    if og == 0:
        return "5v6_10"
    if g == 0:
        return "6v5_01"
    if sk > osk:
        return "5v4_11"
    if sk < osk:
        return "4v5_11"
    return "5v5_11"


class Structure:
    """The fitted structural tables as arrays (built once from ``params['structural']``)."""

    def __init__(self, structural: dict, dispersion: dict | None = None):
        st = structural["states"]
        reg, ot = st["reg"], st["ot"]
        self.r_reg = np.ones(64)
        self.r_ot = np.ones(64)
        self.cls = np.zeros(64, dtype=np.int8)     # 0 EV, 1 PP, 2 SH, 3 extra attacker, 4 empty net
        for sk in range(3, 7):
            for osk in range(3, 7):
                for g in (0, 1):
                    for og in (0, 1):
                        i = state_index(sk, osk, g, og)
                        key = f"{sk}v{osk}_{g}{og}"
                        fb = _fallback_key(sk, osk, g, og)
                        self.r_reg[i] = reg.get(key, reg.get(fb, 1.0))
                        self.r_ot[i] = ot.get(key, self.r_reg[i])
                        self.cls[i] = 4 if og == 0 else (3 if g == 0 else (1 if sk > osk else (2 if sk < osk else 0)))
        self.r_5v4 = float(reg["5v4_11"])
        se = structural["score_effects"]["table"]
        self.se = np.ones((5, 7))                    # segments P1, P2, P3 0-10, 10-18, 18-20 min
        for g in range(5):
            for d in range(-3, 4):
                self.se[g, d + 3] = float(se[f"{g}|{d}"])
        pen = structural["penalties"]
        self.pen_score = np.array([float(pen["score"].get(str(d), 1.0)) for d in range(-2, 3)])
        self.pen_period = np.array([float(pen["period"].get(str(p), 1.0)) for p in (1, 2, 3)])
        self.pen_ot = float(pen.get("ot_mult", 0.65))
        self.pen_state5 = float(pen["state5"])
        self.pen_other = float(pen["state_other"])
        k = pen["kinds"]
        tot = k["minor"] + k["double"] + k["major"]
        self.p_double = k["double"] / tot
        self.p_major = k["major"] / tot
        self.c44 = float(pen["c44_per_5v5_game_s"])
        pulls = structural["pulls"]
        self.pull_bin = float(pulls["bin_s"])
        # pulled window per deficit as a function of the simulation's uniform: (lo, hi] seconds left
        self.u_grid = np.linspace(0.0, 1.0, 2001)
        self.pull_lo = np.zeros((3, len(self.u_grid)))
        self.pull_hi = np.zeros((3, len(self.u_grid)))
        for j, d in enumerate(("1", "2", "3")):
            c = np.asarray(pulls["curves"][d], dtype=float)
            for i, u in enumerate(self.u_grid):
                on = np.nonzero(c > u)[0]
                if len(on):
                    self.pull_lo[j, i] = on.min() * self.pull_bin
                    self.pull_hi[j, i] = (on.max() + 1) * self.pull_bin
                else:
                    self.pull_lo[j, i] = self.pull_hi[j, i] = -1.0
        lull = (structural.get("lull") or {}).get("phases") or []
        self.lull_end = np.array([float(e) for e, _ in lull] or [0.0])
        self.lull_mult = np.array([float(m) for _, m in lull] or [1.0])
        disp = dispersion or {}
        self.k_game = float(disp.get("k_game", 0.0) or 0.0)    # Gamma shape; 0 = no shock
        self.k_team = float(disp.get("k_team", 0.0) or 0.0)
        self.sd_tilt = float(disp.get("sd_tilt", 0.0) or 0.0)   # game-level strength tilt (log scale)
        self.scale = float(disp.get("scale", 1.0) or 1.0)       # total-goals calibration (fit seasons)

    def pull_window(self, u):
        i = np.clip(np.rint(u * (len(self.u_grid) - 1)).astype(int), 0, len(self.u_grid) - 1)
        return self.pull_lo[:, i], self.pull_hi[:, i]          # (3, n)


class Outcomes:
    """Per-simulation results of one game (arrays of length n)."""
    __slots__ = ("hg", "ag", "h1", "a1", "hreg", "areg", "dec", "so_home", "en_h", "en_a", "n",
                 "cum_h", "cum_a")

    def __init__(self, n):
        self.n = n


def simulate_game(rates, i: int, S: Structure, n: int, seed: int) -> Outcomes:
    """Simulate game ``i`` of ``rates`` (a ``rates.GameRates``) ``n`` times."""
    rng = np.random.Generator(np.random.PCG64(int(seed) & 0xFFFFFFFFFFFF))
    L5 = float(rates.L5[i]) * S.scale * float(rates.pace[i])
    tilt = float(rates.tilt[i])
    E, C, P, Q = rates.E[i], rates.C[i], rates.P[i], rates.Q[i]
    kpp = float(rates.Lpp[i]) * S.scale * float(rates.pace[i]) / (L5 * S.r_5v4) if L5 > 0 else 1.0
    Lpen = float(rates.Lpen[i])
    playoff = bool(rates.playoff[i])
    so_home = float(rates.so_home[i])

    # per-simulation shocks
    if S.k_game > 0:
        zg = rng.gamma(S.k_game, 1.0 / S.k_game, n)
    else:
        zg = np.ones(n)
    if S.k_team > 0:
        zh = rng.gamma(S.k_team, 1.0 / S.k_team, n)
        za = rng.gamma(S.k_team, 1.0 / S.k_team, n)
    else:
        zh = za = np.ones(n)
    if S.sd_tilt > 0:
        eps = rng.normal(0.0, S.sd_tilt, n)                 # which side has the better night
    else:
        eps = np.zeros(n)
    base_h = L5 * zg * zh * np.exp(0.5 * tilt + eps)
    base_a = L5 * zg * za * np.exp(-0.5 * tilt - eps)
    # class multipliers for the attacking side (EV, PP, SH, EA, EN)
    mh = np.array([E[0] * C[0], P[0] * C[0] * kpp, C[0], E[0] * C[0], 1.0])
    ma = np.array([E[1] * C[1], P[1] * C[1] * kpp, C[1], E[1] * C[1], 1.0])
    ph_base, pa_base = Lpen * Q[0], Lpen * Q[1]
    ulo_h, uhi_h = S.pull_window(rng.random(n))
    ulo_a, uhi_a = S.pull_window(rng.random(n))

    t = np.zeros(n)
    hg = np.zeros(n, dtype=np.int16)
    ag = np.zeros(n, dtype=np.int16)
    h1 = np.zeros(n, dtype=np.int16)
    a1 = np.zeros(n, dtype=np.int16)
    hreg = np.full(n, -1, dtype=np.int16)
    areg = np.full(n, -1, dtype=np.int16)
    dec = np.zeros(n, dtype=np.int8)          # 0 regulation, 1 OT, 2 shootout
    so_w = np.zeros(n, dtype=np.int8)         # 1 home won the shootout, -1 away
    en_h = np.zeros(n, dtype=np.int16)
    en_a = np.zeros(n, dtype=np.int16)
    last_goal = np.full(n, -1e9)               # time of the last goal (post-goal lull)
    cum_h = np.zeros(n)                       # integrated goal hazards (likelihood-ratio reweighting)
    cum_a = np.zeros(n)
    # penalty slots: [team, slot] end times; dbl marks a double minor
    mn = np.zeros((n, 2, 2))                  # releasable minors: (sim, team, slot)
    dbl = np.zeros((n, 2, 2), dtype=bool)
    mj = np.zeros((n, 2))                     # non-releasable (major / coincidental)
    done = np.zeros(n, dtype=bool)
    period_end = np.full(n, 1200.0)
    p1_recorded = np.zeros(n, dtype=bool)
    ot_left = np.zeros(n, dtype=np.int16)     # playoff OT periods played

    for _ in range(10000):
        act = np.nonzero(~done)[0]
        if not len(act):
            break
        ta = t[act]
        in_ot = ta >= REG_END
        period = np.where(in_ot, 4, np.minimum((ta // 1200).astype(int) + 1, 3))
        mna, mja = mn[act], mj[act]
        act_min = mna > ta[:, None, None]
        act_maj = mja > ta[:, None]
        npen = act_min.sum(axis=2) + act_maj.astype(int)                 # (m, 2)
        npen = np.minimum(npen, 2)
        diff = hg[act].astype(int) - ag[act].astype(int)
        # skaters
        reg_sk = 5 - npen
        ot33 = in_ot & (not playoff)
        dpen = npen[:, 1] - npen[:, 0]                                    # >0: away more penalised
        sk_h = np.where(ot33, np.minimum(3 + np.maximum(dpen, 0), 5), reg_sk[:, 0])
        sk_a = np.where(ot33, np.minimum(3 + np.maximum(-dpen, 0), 5), reg_sk[:, 1])
        sk_h = np.maximum(sk_h, 3)
        sk_a = np.maximum(sk_a, 3)
        # pulled goalies (trailing team, 3rd period of regulation)
        trem = REG_END - ta
        p3 = (period == 3)
        dh = np.clip(-diff, 0, 3)                                         # home deficit
        da = np.clip(diff, 0, 3)
        idx = np.arange(len(act))
        lo_h = np.where(dh > 0, ulo_h[np.maximum(dh - 1, 0), act], -1.0)
        hi_h = np.where(dh > 0, uhi_h[np.maximum(dh - 1, 0), act], -1.0)
        lo_a = np.where(da > 0, ulo_a[np.maximum(da - 1, 0), act], -1.0)
        hi_a = np.where(da > 0, uhi_a[np.maximum(da - 1, 0), act], -1.0)
        pull_h = p3 & (dh > 0) & (trem > lo_h) & (trem <= hi_h)
        pull_a = p3 & (da > 0) & (trem > lo_a) & (trem <= hi_a)
        sk_h = sk_h + pull_h
        sk_a = sk_a + pull_a
        gh = (~pull_h).astype(int)
        ga = (~pull_a).astype(int)
        si_h = state_index(sk_h, sk_a, gh, ga)
        si_a = state_index(sk_a, sk_h, ga, gh)
        r_tab = np.where(ot33, 1, 0)
        rh = np.where(r_tab == 1, S.r_ot[si_h], S.r_reg[si_h])
        ra = np.where(r_tab == 1, S.r_ot[si_a], S.r_reg[si_a])
        ch, ca = S.cls[si_h], S.cls[si_a]
        pidx = np.clip(period - 1, 0, 2)
        dc = np.clip(diff, -3, 3)
        seg = np.where(period >= 3, 2 + (ta >= P3_SEG[0]) + (ta >= P3_SEG[1]), pidx)
        se_h = np.where((ch == 0) & ~in_ot, S.se[seg, dc + 3], 1.0)
        se_a = np.where((ca == 0) & ~in_ot, S.se[seg, -dc + 3], 1.0)
        since = ta - last_goal[act] + 1e-6          # tolerance: a change point lands exactly on t
        ph = np.searchsorted(S.lull_end, since, side="right")
        lull = np.where(ph < len(S.lull_end), S.lull_mult[np.minimum(ph, len(S.lull_end) - 1)], 1.0)
        lam_h = base_h[act] * rh * mh[ch] * se_h * lull
        lam_a = base_a[act] * ra * ma[ca] * se_a * lull
        # penalties
        five = (sk_h == 5) & (sk_a == 5) & (gh == 1) & (ga == 1) & ~in_ot
        pst = np.where(five, S.pen_state5, S.pen_other)
        pper = np.where(in_ot, S.pen_ot, S.pen_period[pidx])
        dcp = np.clip(diff, -2, 2)
        pen_h = ph_base * S.pen_score[dcp + 2] * pper * pst
        pen_a = pa_base * S.pen_score[-dcp + 2] * pper * pst
        c44 = np.where(five, S.c44, 0.0)
        H = lam_h + lam_a + pen_h + pen_a + c44
        # next scheduled change
        nxt = period_end[act].copy()
        nxt = np.where(p3 & (ta < P3_SEG[0]), np.minimum(nxt, P3_SEG[0]),
                       np.where(p3 & (ta < P3_SEG[1]), np.minimum(nxt, P3_SEG[1]), nxt))
        exp_min = np.where(act_min, mna, INF).min(axis=(1, 2))
        exp_maj = np.where(act_maj, mja, INF).min(axis=1)
        nxt = np.minimum(nxt, np.minimum(exp_min, exp_maj))
        in_lull = ph < len(S.lull_end)
        nxt = np.where(in_lull, np.minimum(nxt, last_goal[act] + S.lull_end[np.minimum(ph, len(S.lull_end) - 1)]), nxt)
        for pull, lo, hi, dd in ((pull_h, lo_h, hi_h, dh), (pull_a, lo_a, hi_a, da)):
            cand = np.where(p3 & (dd > 0) & (trem > hi) & (hi > 0), REG_END - hi, INF)
            cand = np.where(pull & (lo > 0), REG_END - lo, cand)
            nxt = np.minimum(nxt, cand)
        wait = rng.exponential(1.0, len(act)) / np.maximum(H, 1e-12)
        ev = ta + wait < nxt
        step = np.where(ev, wait, nxt - ta)
        cum_h[act] += lam_h * step
        cum_a[act] += lam_a * step
        # ---- advance to the scheduled change
        adv = act[~ev]
        t[adv] = nxt[~ev]
        # ---- events
        e_idx = act[ev]
        t[e_idx] = (ta + wait)[ev]
        u = rng.random(len(e_idx)) * H[ev]
        c1 = lam_h[ev]
        c2 = c1 + lam_a[ev]
        c3 = c2 + pen_h[ev]
        c4 = c3 + pen_a[ev]
        is_hg, is_ag = u < c1, (u >= c1) & (u < c2)
        is_hp, is_ap = (u >= c2) & (u < c3), (u >= c3) & (u < c4)
        is_c44 = u >= c4
        te = t[e_idx]
        sub_np = npen[ev]
        for scorer, mask, ga_cls in ((0, is_hg, ca[ev]), (1, is_ag, ch[ev])):
            if not mask.any():
                continue
            sims = e_idx[mask]
            last_goal[sims] = t[sims]
            if scorer == 0:
                hg[sims] += 1
                en_h[sims] += (ga_cls[mask] == 3).astype(np.int16)    # away goalie pulled: EN goal
            else:
                ag[sims] += 1
                en_a[sims] += (ga_cls[mask] == 3).astype(np.int16)
            # power-play goal releases the shorthanded team's shortest minor
            opp = 1 - scorer
            ppg = sub_np[mask, opp] > sub_np[mask, scorer]
            if ppg.any():
                s2 = sims[ppg]
                tt = t[s2]
                ends = mn[s2, opp, :]
                live = ends > tt[:, None]
                cand = np.where(live, ends, INF)
                j = np.argmin(cand, axis=1)
                has = live[np.arange(len(s2)), j]
                s3, j3, t3 = s2[has], j[has], tt[has]
                rem = mn[s3, opp, j3] - t3
                isd = dbl[s3, opp, j3] & (rem > 120.0)
                mn[s3, opp, j3] = np.where(isd, t3 + 120.0, t3)
                dbl[s3, opp, j3] = False
        # sudden death in OT
        ot_goal = (is_hg | is_ag) & (te >= REG_END)
        if ot_goal.any():
            s = e_idx[ot_goal]
            dec[s] = 1
            done[s] = True
        for team, mask in ((0, is_hp), (1, is_ap)):
            if not mask.any():
                continue
            sims = e_idx[mask]
            tt = t[sims]
            r = rng.random(len(sims))
            major = r < S.p_major
            double = (~major) & (r < S.p_major + S.p_double)
            if major.any():
                sm = sims[major]
                mj[sm, team] = np.maximum(mj[sm, team], t[sm]) + 300.0
            mnr = sims[~major]
            if len(mnr):
                tm = t[mnr]
                free0 = mn[mnr, team, 0] <= tm
                free1 = (~free0) & (mn[mnr, team, 1] <= tm)
                dur = np.where(double[~major], 240.0, 120.0)
                s0, s1 = mnr[free0], mnr[free1]
                mn[s0, team, 0] = tm[free0] + dur[free0]
                dbl[s0, team, 0] = double[~major][free0]
                mn[s1, team, 1] = tm[free1] + dur[free1]
                dbl[s1, team, 1] = double[~major][free1]
        if is_c44.any():
            s = e_idx[is_c44]
            mj[s, 0] = np.maximum(mj[s, 0], t[s] + 120.0)
            mj[s, 1] = np.maximum(mj[s, 1], t[s] + 120.0)
        # ---- period ends
        pe = (~done) & (t >= period_end)
        if pe.any():
            s = np.nonzero(pe)[0]
            ends = period_end[s]
            first = (ends == 1200.0) & ~p1_recorded[s]
            h1[s[first]] = hg[s[first]]
            a1[s[first]] = ag[s[first]]
            p1_recorded[s[first]] = True
            reg_end = ends == REG_END
            if reg_end.any():
                r = s[reg_end]
                hreg[r], areg[r] = hg[r], ag[r]
                tied = hg[r] == ag[r]
                done[r[~tied]] = True
                tr = r[tied]
                period_end[tr] = REG_END + (PO_OT_LEN if playoff else OT_LEN)
            mid = (ends < REG_END)
            period_end[s[mid]] = ends[mid] + 1200.0
            ot_end = ends > REG_END
            if ot_end.any():
                o = s[ot_end]
                if playoff:
                    ot_left[o] += 1
                    more = ot_left[o] < MAX_PO_OT
                    period_end[o[more]] += PO_OT_LEN
                    last = o[~more]
                    w = rng.random(len(last)) < 0.5      # never reached in practice
                    hg[last[w]] += 1
                    ag[last[~w]] += 1
                    dec[last] = 1
                    done[last] = True
                else:
                    w = rng.random(len(o)) < so_home
                    so_w[o] = np.where(w, 1, -1)
                    dec[o] = 2
                    done[o] = True
    if not done.all():
        raise RuntimeError(f"simulation did not finish for {int((~done).sum())} of {n} runs")
    out = Outcomes(n)
    out.hg, out.ag, out.h1, out.a1 = hg, ag, h1, a1
    out.hreg, out.areg, out.dec, out.so_home = hreg, areg, dec, so_w
    out.en_h, out.en_a = en_h, en_a
    out.cum_h, out.cum_a = cum_h, cum_a
    return out


def tilt_weights(o: Outcomes, tilt: float, pace: float = 1.0) -> np.ndarray:
    """Self-normalised likelihood-ratio weights that turn simulations run at the game's rates into
    simulations at goal hazards x pace * exp(+-tilt / 2) (home / away).  Exact for this point
    process (every goal hazard scaled by a constant, whatever the history dependence): the
    weight of a path is a^N_h b^N_a exp(-(a - 1) Lambda_h - (b - 1) Lambda_a)."""
    a, b = pace * np.exp(0.5 * tilt), pace * np.exp(-0.5 * tilt)
    nh = o.hg.astype(float)
    na = o.ag.astype(float)
    lw = nh * np.log(a) + na * np.log(b) - (a - 1.0) * o.cum_h - (b - 1.0) * o.cum_a
    lw -= lw.max()
    w = np.exp(lw)
    return w / w.sum()


def ess(w: np.ndarray) -> float:
    return float(1.0 / np.sum(w * w))


def game_seed(base_seed: int, game_key) -> int:
    """Deterministic per-game seed (independent of the slate the game is simulated with)."""
    import hashlib
    h = hashlib.sha256(f"{int(base_seed)}:{game_key}".encode()).hexdigest()
    return int(h[:12], 16)
