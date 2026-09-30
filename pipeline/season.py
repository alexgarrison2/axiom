"""Single source of truth for the current NHL season.

The season rolls over on July 1 (start of the NHL league year), so offseason
runs already point at the upcoming season's (empty) files and the first
regular-season game lands in the right place without a code change.
"""
from datetime import date, datetime

try:
    from zoneinfo import ZoneInfo
    NHL_TZ = ZoneInfo("America/New_York")   # the NHL schedules by Eastern time
except Exception:  # pragma: no cover - zoneinfo is stdlib on 3.9+
    import pytz
    NHL_TZ = pytz.timezone("America/New_York")


def today_local(now=None):
    """Today's date in America/New_York.

    GitHub runners use UTC, so at 00:00-04:00 UTC ``date.today()`` is already
    tomorrow while tonight's late games are still to be played.  Anything
    keyed by "today's slate" must use this instead.
    """
    now = now or datetime.now(NHL_TZ)
    if now.tzinfo is None:
        now = now.replace(tzinfo=NHL_TZ)
    return now.astimezone(NHL_TZ).date()


def season_start_year(today=None):
    today = today or date.today()
    return today.year if today.month >= 7 else today.year - 1


START_YEAR = season_start_year()                  # 2026
SEASON_ID = f"{START_YEAR}{START_YEAR + 1}"       # "20262027" (NHL API id)
SEASON_LABEL = f"{START_YEAR}-{str(START_YEAR + 1)[2:]}"  # "2026-27"

PREV_START_YEAR = START_YEAR - 1
PREV_SEASON_ID = f"{PREV_START_YEAR}{START_YEAR}"

# Scrape window start. Preseason games are filtered out by game type, so
# any date before opening night works.
SEASON_START_DATE = f"{START_YEAR}-09-01"

# NHL game-type codes (digits 5-6 of a gameId): 01 preseason, 02 regular
# season, 03 playoffs, 04 all-star, 09+ international/exhibition.
REGULAR_SEASON = "02"
PLAYOFFS = "03"
COUNTED_GAME_TYPES = (REGULAR_SEASON, PLAYOFFS)


def season_file(kind, start_year=START_YEAR):
    """nhl_season_2026_2027_<kind>.csv, e.g. kind='gamestats'."""
    return f"nhl_season_{start_year}_{start_year + 1}_{kind}.csv"


def season_of_game_id(game_id):
    """Start year of the season a game belongs to (2026020001 -> 2026)."""
    return int(str(game_id)[:4])


def season_id_of_game_id(game_id):
    """NHL season id of a game (2026020001 -> '20262027')."""
    y = season_of_game_id(game_id)
    return f"{y}{y + 1}"


def game_type_of(game_id):
    """Two-digit game type of a game id (2026020001 -> '02')."""
    s = str(game_id).split(".")[0]
    return s[4:6] if len(s) >= 6 else ""


def is_counted_game(game_id, game_types=COUNTED_GAME_TYPES):
    return game_type_of(game_id) in game_types


def filter_game_types(df, game_types=COUNTED_GAME_TYPES, start_year=None, col="game_id"):
    """Keep only rows whose game id has one of ``game_types`` (default 02/03),
    optionally also restricted to one season. Frames without the id column are
    returned unchanged."""
    if df is None or getattr(df, "empty", True) or col not in df.columns:
        return df
    ids = df[col].astype(str).str.split(".").str[0]
    mask = ids.str[4:6].isin(game_types)
    if start_year is not None:
        mask &= ids.str[:4] == str(start_year)
    return df[mask]


def read_season_csv(kind, path=None, game_types=COUNTED_GAME_TYPES, start_year=START_YEAR, **kwargs):
    """Read this season's CSV, filtered to counted game types (02/03) of this season.

    Before the first game is scraped the file doesn't exist yet; return an
    empty frame with last season's columns so callers can filter/aggregate
    without special-casing opening night. Pass game_types=None to skip the
    filter."""
    import os
    import pandas as pd

    path = path or season_file(kind, start_year)
    if os.path.exists(path):
        df = pd.read_csv(path, **kwargs)
        if game_types:
            df = filter_game_types(df, game_types, start_year=start_year)
        return df
    prev = os.path.join(os.path.dirname(path), season_file(kind, start_year - 1))
    if os.path.exists(prev):
        return pd.read_csv(prev, nrows=0, **{k: v for k, v in kwargs.items() if k != 'nrows'})
    return pd.DataFrame()


# Player models (MoneyPuck impact, PBP HD metrics, RAPM) rebuild once the
# season has this many games (~15 per team). Until then last season's
# committed player ratings (and their team assignments) stay in use.
PLAYER_MODEL_MIN_GAMES = 240

# Regular-season length: 84 games from 2026-27 (2025 CBA), 82 before.
SEASON_GAMES = 84 if START_YEAR >= 2026 else 82
