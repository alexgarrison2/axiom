"""
fetch_upcoming.py — today's and tomorrow's games (NHL local date) with
starting goalies, written to pipeline/upcoming_games.json AND
public/data/upcoming_games.json on every run.

Starting goalie resolution per team:
  1. DailyFaceoff (Confirmed / Likely / Unconfirmed), validated against the
     team's current NHL roster goalies (api-web /v1/roster/{TRI}/current).
  2. ESPN scoreboard ``probables`` when DFO has nothing usable for the game:
     status "Probable (ESPN)".
  3. When DFO and ESPN name different goalies the game carries
     <side>GoalieConflict=true and <side>GoalieAlt=<ESPN name>.

Also regenerates public/data/team_goalies.json from the same roster pull.
A schedule fetch failure keeps the previous upcoming_games.json untouched.
"""
from datetime import timedelta
import unicodedata

import fetch_dailyfaceoff
from season import today_local
from http_utils import try_get_json, get_json, HttpError
from io_utils import atomic_write_json, mark_stale
from paths import pipeline_path, public_path

UPCOMING_FILE = pipeline_path("upcoming_games.json")
PUBLIC_UPCOMING_FILE = public_path("upcoming_games.json")
ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates={d}"


def normalize_name(name):
    """Normalize names by removing accents and making lowercase."""
    if not name:
        return ""
    normalized = unicodedata.normalize('NFD', name)
    return "".join(c for c in normalized if unicodedata.category(c) != 'Mn').lower().strip()


def get_team_goalies():
    """{TRI: [goalie names]} from current NHL rosters; also rewrites
    public/data/team_goalies.json. Empty dict if rosters are unavailable."""
    try:
        from fetch_player_bio import build_team_goalies, fetch_rosters
        rosters = fetch_rosters()
        tg = build_team_goalies(rosters)
        if tg:
            return tg
        # partial roster pull: still use what we have for validation
        from fetch_player_bio import player_display_name
        return {t: [player_display_name(g) for g in r.get("goalies", [])] for t, r in rosters.items()}
    except Exception as e:
        print(f"Warning: could not build roster goalie map: {e}")
        return {}


def espn_probables(dates):
    """{(date, TRI): goalie name} from ESPN scoreboard probables (plain UA)."""
    from fetch_injuries import espn_tri
    out = {}
    for d in dates:
        data = try_get_json(ESPN_SCOREBOARD.format(d=d.replace("-", "")), ua="espn", retries=2)
        if not data:
            continue
        for ev in data.get("events", []) or []:
            for comp in (ev.get("competitions") or [])[:1]:
                for c in comp.get("competitors", []) or []:
                    tri = espn_tri((c.get("team") or {}).get("abbreviation"))
                    for pr in c.get("probables", []) or []:
                        if pr.get("name") == "probableStartingGoalie" or (pr.get("abbreviation") == "SG"):
                            nm = (pr.get("athlete") or {}).get("fullName") or (pr.get("athlete") or {}).get("displayName")
                            if nm:
                                out[(d, tri)] = nm
    return out


def _dfo_lookup(dfo_goalies, team_common, target_date):
    for key, info in dfo_goalies.items():
        if not isinstance(info, dict) or target_date not in key:
            continue
        if team_common in key.replace(f"_{target_date}", ""):
            return info
    return None


def _status_label(raw):
    s = (raw or "").lower()
    if s == "confirmed":
        return "Confirmed"
    if "probable" in s or "likely" in s or "expected" in s:
        return "Likely"
    return "Unconfirmed"


def resolve_goalie(side_label, team_common, tri, target_date, dfo_goalies, roster_goalies, espn):
    """Return (goalie, status, source, conflict, alt) for one team in one game."""
    info = _dfo_lookup(dfo_goalies, team_common, target_date)
    goalie, status, source = None, "Unconfirmed", None
    if info and info.get("goalie"):
        g_name = info["goalie"]
        status_val = (info.get("status") or "").lower()
        valid = True
        if roster_goalies:
            if normalize_name(g_name) not in {normalize_name(x) for x in roster_goalies}:
                if status_val in ("confirmed", "likely", "probable"):
                    print(f"  [VALIDATION WARNING] {g_name} ({status_val}) for {tri} is not on the roster. "
                          "Accepting (possible recall/trade).")
                else:
                    print(f"  [VALIDATION FAILED] {g_name} reported for {tri} but not on the roster. Rejecting.")
                    valid = False
        if valid:   # only now is the DFO info used
            goalie, status, source = g_name, _status_label(info.get("status")), "dailyfaceoff"

    alt = espn.get((target_date, tri))
    conflict = False
    if alt:
        if goalie is None:
            goalie, status, source = alt, "Probable (ESPN)", "espn"
        elif normalize_name(alt) != normalize_name(goalie):
            conflict = True
            print(f"  [CONFLICT] {tri} {target_date}: DFO {goalie} ({status}) vs ESPN {alt}")
    return goalie, status, source, conflict, (alt if conflict else None)


def _tv_key(network):
    """Dedupe key: 'HBO MAX' / 'Max' / 'max' collapse to the same broadcaster."""
    k = "".join(ch for ch in (network or "").lower() if ch.isalnum())
    return "max" if k in ("hbomax", "max") else k


def select_tv(broadcasts, home_tri, away_tri, max_national=2):
    """The broadcasters a US viewer should look for, as [{network, market, team, country}].

    NHL ``tvBroadcasts`` rows carry market N (national), H (home) or A (away)
    and countryCode US/CA. US only:
      - any US national feed wins (deduped, at most ``max_national``, API order);
      - otherwise the first US away and first US home regional network, each
        tagged with its team (one entry, team None, when both sides share it);
      - a game with no US feed at all (Canada-only) falls back to its Canadian
        national feed(s) so the card is never blank.
    """
    rows = [b for b in (broadcasts or []) if b.get('network')]
    us = [b for b in rows if b.get('countryCode') == 'US']

    def pick(cands, limit):
        out, seen = [], set()
        for b in cands:
            k = _tv_key(b['network'])
            if k in seen:
                continue
            seen.add(k)
            out.append(b)
            if len(out) >= limit:
                break
        return out

    national = pick([b for b in us if b.get('market') == 'N'], max_national)
    if national:
        return [{'network': b['network'], 'market': 'N', 'team': None, 'country': 'US'} for b in national]

    out = []
    for market, tri in (('A', away_tri), ('H', home_tri)):
        b = next((b for b in us if b.get('market') == market), None)
        if not b:
            continue
        dup = next((o for o in out if _tv_key(o['network']) == _tv_key(b['network'])), None)
        if dup:
            dup['team'] = None  # shared feed: shown once, untagged
            continue
        out.append({'network': b['network'], 'market': market, 'team': tri, 'country': 'US'})
    if out or us:
        return out

    ca = pick([b for b in rows if b.get('countryCode') == 'CA' and b.get('market') == 'N'], max_national)
    return [{'network': b['network'], 'market': 'N', 'team': None, 'country': 'CA'} for b in ca]


def fetch_schedule(now=None):
    print("Fetching confirmed goalies from Daily Faceoff...")
    try:
        dfo_goalies = fetch_dailyfaceoff.fetch_dailyfaceoff_goalies(now=now)
    except Exception as e:
        print(f"Warning: DFO goalies unavailable: {e}")
        dfo_goalies = {}

    today = today_local(now)
    dates_to_fetch = [today.isoformat(), (today + timedelta(days=1)).isoformat()]
    team_goalie_map = get_team_goalies()
    espn = espn_probables(dates_to_fetch)

    all_games, failed_dates = [], []
    for target_date in dates_to_fetch:
        print(f"Fetching schedule for {target_date}...")
        try:
            data = get_json(f"https://api-web.nhle.com/v1/schedule/{target_date}", ua="plain")
        except HttpError as e:
            print(f"Error fetching schedule for {target_date}: {e}")
            failed_dates.append(target_date)
            continue
        for day in data.get('gameWeek', []):
            if day.get('date') != target_date:
                continue
            for game in day.get('games', []):
                home_common = game['homeTeam']['commonName']['default']
                away_common = game['awayTeam']['commonName']['default']
                h_tri, a_tri = game['homeTeam']['abbrev'], game['awayTeam']['abbrev']
                hg, hs, hsrc, hconf, halt = resolve_goalie("Home", home_common, h_tri, target_date, dfo_goalies,
                                                          team_goalie_map.get(h_tri, []), espn)
                ag, as_, asrc, aconf, aalt = resolve_goalie("Away", away_common, a_tri, target_date, dfo_goalies,
                                                           team_goalie_map.get(a_tri, []), espn)
                broadcasts = game.get('tvBroadcasts', []) or []
                national_us = [b['network'] for b in broadcasts if b.get('market') == 'N' and b.get('countryCode') == 'US']
                all_games.append({
                    'id': game['id'],
                    'gameDate': target_date,
                    'startTimeUTC': game['startTimeUTC'],
                    'gameType': game.get('gameType'),
                    'gameState': game.get('gameState'),
                    'homeTeam': home_common,
                    'awayTeam': away_common,
                    'homeTeamAbbrev': h_tri,
                    'awayTeamAbbrev': a_tri,
                    'homeGoalieConfirmed': hg,
                    'homeGoalieStatus': hs,
                    'homeGoalieSource': hsrc,
                    'homeGoalieConflict': hconf,
                    'homeGoalieAlt': halt,
                    'awayGoalieConfirmed': ag,
                    'awayGoalieStatus': as_,
                    'awayGoalieSource': asrc,
                    'awayGoalieConflict': aconf,
                    'awayGoalieAlt': aalt,
                    'tvNetwork': national_us[0] if national_us else '',
                    'tvDisplay': select_tv(broadcasts, h_tri, a_tri),
                    'tvBroadcasts': [{'network': b.get('network'), 'market': b.get('market'),
                                      'countryCode': b.get('countryCode')} for b in broadcasts],
                })
            break

    print(f"Found {len(all_games)} games total.")
    if failed_dates:
        mark_stale("upcoming_games.json", f"schedule fetch failed for {', '.join(failed_dates)}")
        print("[GUARD] Schedule incomplete — keeping the previous upcoming_games.json")
        return {"status": "fail", "rows_written": 0, "games": all_games,
                "reason": f"schedule fetch failed for {failed_dates}"}

    validator = lambda gs: None if all(g.get('id') and g.get('startTimeUTC') for g in gs) else "malformed game"  # noqa: E731
    atomic_write_json(UPCOMING_FILE, all_games, indent=4, validator=validator, label="upcoming_games.json")
    atomic_write_json(PUBLIC_UPCOMING_FILE, all_games, indent=4, validator=validator,
                      label="public/upcoming_games.json")
    print("Saved upcoming_games.json (pipeline/ and public/data/)")
    return {"status": "ok", "rows_written": len(all_games), "games": all_games}


if __name__ == "__main__":
    res = fetch_schedule()
    print({k: v for k, v in res.items() if k != "games"})
