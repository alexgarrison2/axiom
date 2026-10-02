#!/usr/bin/env python3
"""
ml_predict.py - runtime wrapper for the game model (v5: logistic + Elo prior).

One code path all season.  The feature state is always rebuilt from the
historical archive plus whatever current-season games exist, so opening
night (0 games scraped) uses exactly the same model and feature builder as
game 20.  ``last_path`` records which path produced the last prediction and
is 'ml' for every successful call; there is no silent Poisson fallback in
this module (predict() returns None only if the model file is missing).

Displayed xG comes from goal_model.display_xg(win %, expected total), so the
xG favourite always matches the win % favourite.

Usage (predict_games.py):
    ml = MLPredictor(game_stats_df)
    h_prob, a_prob, h_xg, a_xg = ml.predict(home, away, date, h_goalie=..., a_goalie=...)
    detail = ml.last_detail   # features, logit terms, model_version, total, ...
"""

from __future__ import annotations

import json
import math
import os
import pickle
import sys

import numpy as np
import pandas as pd

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

import features as F  # noqa: E402
import goal_model  # noqa: E402

PROB_FLOOR, PROB_CEIL = 0.03, 0.97   # numerical guard only (no 25/75 clamp)

# Grouping of model terms for the 'why this pick' breakdown (A11).
TERM_GROUPS = [
    ('home_ice', 'Home ice', None),
    # bu_d_net: tonight's dressed skaters' RAPM v2 even-strength net xG/60 (player-level EV strength);
    # bu_d_fin: the same skaters' finishing talent (EV goals above xG / 60)
    ('strength_5v5', '5v5 strength', ('d_xg_share', 'd_elo', 'd_pts_pct', 'bu_d_net', 'bu_d_fin')),
    ('special_teams', 'Special teams & all-situations play', ('d_xg_share_all', 'd_st')),
    ('goaltending', 'Goaltending', ('d_goalie_gsax',)),
    ('rest', 'Rest & travel', ('h_b2b', 'a_b2b', 'd_rest', 'd_travel_km', 'h_tz_shift', 'a_tz_shift')),
    # Who dresses and who starts in net, vs the team's usual: fast track F1 (d_lineup) or the
    # RAPM v2 lineup term (bu_d_delta: tonight's 18 vs the team's last 10 lineups)
    ('lineup_goalie', 'Lineup & starter vs usual', ('d_lineup', 'd_lineup_level', 'd_goalie_swap', 'bu_d_delta')),
]
# Groups shown only when the model has one of their features (older models
# keep their exact factor list).
OPTIONAL_GROUPS = {'lineup_goalie'}

BU_ENV = 'PONYXG_BU'
BU_MODES = ('on', 'off', 'shadow', 'nofin')


def bu_mode() -> str:
    """Rollback switch for the RAPM v2 lineup term (DESIGN §5.2 ``PONYXG_BU``).

    on (default)   the live model gets tonight's bu_d_net / bu_d_delta (/ bu_d_fin)
    nofin          predict_games serves the joint model WITHOUT the FIN term (``shadow.rapm`` in
                   the meta, models/shadow/game_model_rapm.pkl) as the live model, term on;
                   its own F1 rollback chain is unchanged
    off | shadow   predict_games publishes the incumbent WITHOUT the term, the F1 rollback
                   model (``shadow.f1`` in the meta), as it also does per game when the term is
                   unavailable (stale bundle, coverage gate); the joint model's term-on
                   probability is still logged in ``bu_shadow_home_win_pct``.  Zero-filling the
                   two features is not neutral (bu_d_net carries team strength in the joint fit).
    Full rollback to the previous model: restore game_model.pkl/meta from git (the F1
    model is also kept in models/shadow/ and logged every run)."""
    v = (os.environ.get(BU_ENV) or 'on').strip().lower()
    return v if v in BU_MODES else 'on'


def load_lineup_state(meta=None):
    """LineupState replayed over every stored completed game (F1 serving)."""
    import lineup_adjust as L
    cross = (meta or {}).get('fasttrack', {}).get('lineup_cross_season', L.LINEUP_CROSS_SEASON)
    st = L.LineupState(L.load_mp(), cross_season=cross,
                       value=(meta or {}).get('fasttrack', {}).get('rating_value', L.RATING_VALUE))
    store = L.load_lineup_store()
    for _, day in store.groupby('game_date', sort=True):
        st.update_day(day)
    latest = st.history_max_date.date() if st.history_max_date is not None else 'none'
    print(f"[ML] lineup state: {store['game_id'].nunique() if len(store) else 0} stored games, latest {latest}")
    return st


class MLPredictor:
    """Runtime predictor using the trained game model."""

    def __init__(self, game_stats_df=None, goalie_ratings=None, pipeline_dir=SCRIPT_DIR,
                 model_path=None, meta_path=None, games=None, xg='live', dedupe='event'):
        """``xg``: the shot-xG inputs of the feature state, 'live' (the files' ``xg_raw``) or
        'v1' (the xG v1 rollback inputs, for the F1 shadow model in models/shadow/);
        ``dedupe``: features.DEDUPE_MODES ('legacy' reproduces the F1 model's training inputs)."""
        self.available = False
        self._lineup_state = None
        self._bu_term = None
        self._bu_error = None
        self.xg_inputs = xg
        self.last_path = None
        self.last_detail = None
        self.model = None
        self.meta = {}
        self.pipeline_dir = pipeline_dir
        model_path = model_path or os.path.join(pipeline_dir, 'game_model.pkl')
        meta_path = meta_path or os.path.join(pipeline_dir, 'game_model_meta.json')
        try:
            with open(model_path, 'rb') as f:
                payload = pickle.load(f)
            with open(meta_path) as f:
                self.meta = json.load(f)
        except Exception as e:
            print(f"[ML] game model unavailable ({e}) - ML predictions disabled")
            return
        if not (isinstance(payload, dict) and payload.get('kind') == 'logit-v5'):
            print("[ML] game_model.pkl is not a v5 logistic model - run train_game_model.py")
            return
        self.model = payload['model']
        self.feature_cols = payload['feature_columns']
        self.model_version = payload.get('model_version') or self.meta.get('model_version', 'unknown')
        betas = self.meta.get('coefficients_raw') or {}
        self.betas = {c: float(betas.get(c, 0.0)) for c in self.feature_cols}
        self.home_logit = float(self.meta.get('home_ice_logit', 0.0))

        # Historical archive is ALWAYS loaded; an empty current season is fine.
        if games is None:
            cur = game_stats_df if game_stats_df is not None else None
            games, self.xg_source = F.load_feature_games(pipeline_dir, current_df=cur, xg=xg, dedupe=dedupe)
        else:
            self.xg_source = 'provided'
        self.games = games
        self.state = F.build_state(games)
        if self.meta.get('xg_source') and self.xg_source not in (self.meta['xg_source'], 'provided'):
            print(f"[ML] WARNING: serving xG source {self.xg_source} != training {self.meta['xg_source']}")
        # F1 lineup state: replayed from the stored boxscore lineups on first use
        # (~10 s), so consumers that never pass lineups (season simulator,
        # fixtures) do not pay for it.
        self._lineup_state = None
        self.available = True
        n_cur = int((games['season'] == games['season'].max()).sum() // 2) if len(games) else 0
        print(f"[ML] {self.model_version}: {len(self.feature_cols)} features, "
              f"state from {len(games) // 2} games (latest season {n_cur})")

    # ------------------------------------------------------------------ core
    @property
    def uses_lineups(self) -> bool:
        return self.available and any(c in self.feature_cols for c in F.LINEUP_COLUMNS)

    @property
    def uses_bu(self) -> bool:
        return self.available and any(c in self.feature_cols for c in F.BU_COLUMNS)

    @property
    def uses_fin(self) -> bool:
        return self.available and any(c in self.feature_cols for c in F.BU_FIN_COLUMNS)

    @property
    def bu_term(self):
        """The RAPM v2 serving bundle as a ``bu.lineup.serve.LiveLineupTerm`` (loaded once), or
        None when the model does not use it or the bundle cannot be read."""
        if self._bu_term is None and self._bu_error is None and self.uses_bu:
            rel = (self.meta.get('bu_lineup') or {}).get('serving_bundle', 'bu/lineup/out/serving_bundle.json.gz')
            path = rel if os.path.isabs(rel) else os.path.join(self.pipeline_dir, rel)
            try:
                from bu.lineup.serve import LiveLineupTerm
                self._bu_term = LiveLineupTerm.load(path)
                print(f"[ML] RAPM lineup bundle: built {self._bu_term.b['built_at']} "
                      f"({self._bu_term.age_hours():.1f} h old), {self._bu_term.b['n_games']} games of "
                      f"{self._bu_term.b['season']}, max source date {self._bu_term.b.get('max_source_date')}")
            except Exception as e:     # missing / unreadable bundle: neutral term, logged
                self._bu_error = f"{type(e).__name__}: {e}"
                print(f"[ML] WARNING: RAPM lineup bundle unavailable ({self._bu_error}); bu term neutral")
        return self._bu_term

    def bu_features(self, home_tri, away_tri, dfo_home, dfo_away):
        """``LiveLineupTerm.features`` for tonight's DailyFaceoff lines (``bu_ok`` False and
        neutral 0 features when stale / unmapped / under the coverage gate), or None when
        the model does not use the term.  ``fin_ok`` False: the bundle has no FIN table; for a
        model with ``bu_d_fin`` the result then also carries ``fin_missing`` (predict_games
        serves the joint model without FIN, never a zero-filled FIN).  Never raises."""
        if not self.uses_bu:
            return None
        term = self.bu_term
        if term is None:
            return {**{c: 0.0 for c in F.BU_COLUMNS}, 'bu_ok': False, 'fin_ok': False,
                    'reason': f"bundle unavailable ({self._bu_error})", 'home': None, 'away': None}
        out = term.features(home_tri, away_tri, dfo_home, dfo_away)
        if self.uses_fin and not out.get('fin_ok'):
            out['fin_missing'] = True
        return out

    @property
    def lineup_state(self):
        if self._lineup_state is None and self.uses_lineups:
            self._lineup_state = load_lineup_state(self.meta)
        return self._lineup_state

    def features_for(self, home_team, away_team, game_date, h_goalie=None, a_goalie=None,
                     h_rest_days=None, a_rest_days=None, h_is_b2b=None, a_is_b2b=None,
                     extra_features=None):
        if h_rest_days is None and h_is_b2b:
            h_rest_days = 1
        if a_rest_days is None and a_is_b2b:
            a_rest_days = 1
        feats = self.state.pregame(home_team, away_team, game_date, h_goalie, a_goalie,
                                   h_rest_days, a_rest_days)
        # Features computed outside FeatureState (the F1 lineup delta); absent = neutral 0
        for k, v in (extra_features or {}).items():
            if v is not None:
                feats[k] = float(v)
        return feats

    def logit_terms(self, feats, extra_terms=None):
        """Ordered additive logit terms: home ice, grouped feature terms, extras."""
        terms = [('home_ice', 'Home ice', self.home_logit)]
        used = set()
        for key, label, cols in TERM_GROUPS[1:]:
            if key in OPTIONAL_GROUPS and not any(c in self.betas for c in cols):
                continue
            d = sum(self.betas.get(c, 0.0) * float(feats.get(c, 0.0)) for c in cols if c in self.betas)
            used.update(c for c in cols if c in self.betas)
            terms.append((key, label, d))
        rest = [c for c in self.feature_cols if c not in used]
        if rest:
            terms.append(('other', 'Other', sum(self.betas[c] * float(feats.get(c, 0.0)) for c in rest)))
        for t in (extra_terms or []):
            terms.append(tuple(t))
        return terms

    def predict_detail(self, home_team, away_team, game_date, h_goalie=None, a_goalie=None,
                       h_rest_days=None, a_rest_days=None, h_is_b2b=None, a_is_b2b=None,
                       extra_terms=None, extra_features=None):
        """Full prediction record.  ``extra_terms`` are additional logit terms
        (e.g. ('lineup', 'Lineup & injuries', 0.04) from lineup_adjust);
        ``extra_features`` are model inputs computed outside FeatureState
        (e.g. {'d_lineup': 0.12} from lineup_adjust.LineupState)."""
        if not self.available:
            self.last_path = None
            return None
        feats = self.features_for(home_team, away_team, game_date, h_goalie, a_goalie,
                                  h_rest_days, a_rest_days, h_is_b2b, a_is_b2b, extra_features)
        X = np.array([[float(feats.get(c, 0.0)) for c in self.feature_cols]])
        p_model = float(self.model.predict_proba(X)[0][1])
        terms = self.logit_terms(feats, extra_terms)
        z_model = math.log(p_model / (1 - p_model))
        # The pipeline logit and the sum of raw-scale terms agree to ~1e-12.
        z = z_model + sum(t[2] for t in (extra_terms or []))
        p = min(max(1 / (1 + math.exp(-z)), PROB_FLOOR), PROB_CEIL)
        total = goal_model.expected_total(feats['league_gpg'], feats['pace'])
        h_xg, a_xg = goal_model.display_xg(p, total)
        detail = {
            'path': 'ml',
            'model_version': self.model_version,
            'home_win_prob': p,
            'model_prob_raw': p_model,
            'features': {c: float(feats.get(c, 0.0)) for c in self.feature_cols},
            'context': {k: feats[k] for k in ('h_gp', 'a_gp', 'h_rs_gp', 'a_rs_gp', 'h_goalie_gsax',
                                              'a_goalie_gsax', 'h_goalie_gp', 'a_goalie_gp',
                                              'h_goalie_ev', 'a_goalie_ev', 'h_rest', 'a_rest',
                                              'h_elo', 'a_elo', 'h_pts_pct', 'a_pts_pct', 'pace',
                                              'league_gpg', 'h_goalie_swap', 'a_goalie_swap')},
            'logit_terms': [{'factor': f, 'label': lab, 'logit': d} for f, lab, d in terms],
            'expected_total': total,
            'home_xg': h_xg,
            'away_xg': a_xg,
            'preseason_prior': bool(min(feats['h_rs_gp'], feats['a_rs_gp']) < 10),
        }
        self.last_path = 'ml'
        self.last_detail = detail
        return detail

    def predict(self, home_team, away_team, game_date,
                h_rest_days=None, a_rest_days=None,
                h_is_b2b=None, a_is_b2b=None,
                h_goalie=None, a_goalie=None, extra_terms=None):
        """Backward-compatible API: (home_prob, away_prob, home_xg, away_xg) or None."""
        d = self.predict_detail(home_team, away_team, game_date, h_goalie, a_goalie,
                                h_rest_days, a_rest_days, h_is_b2b, a_is_b2b, extra_terms)
        if d is None:
            return None
        return d['home_win_prob'], 1 - d['home_win_prob'], round(d['home_xg'], 2), round(d['away_xg'], 2)

    def lineup_features(self, home_tri, away_tri, game_date, home_players, away_players,
                        injured=None, season=None):
        """F1 lineup delta for an upcoming game, or None when the model does not
        use it.  See lineup_adjust.serve_lineup_features."""
        if self.lineup_state is None:
            return None
        import lineup_adjust as L
        return L.serve_lineup_features(self.lineup_state, home_tri, away_tri, game_date,
                                       home_players, away_players, injured=injured, season=season)

    def goalie_rating(self, name):
        """(regressed GSAx/game, weighted GP evidence, current GP) from the live state."""
        return self.state.goalie_rating(name)
