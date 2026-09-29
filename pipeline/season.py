"""Single source of truth for the current NHL season.

The season rolls over on July 1 (start of the NHL league year), so offseason
runs already point at the upcoming season's (empty) files and the first
regular-season game lands in the right place without a code change.
"""
from datetime import date


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


def season_file(kind, start_year=START_YEAR):
    """nhl_season_2026_2027_<kind>.csv, e.g. kind='gamestats'."""
    return f"nhl_season_{start_year}_{start_year + 1}_{kind}.csv"


def season_of_game_id(game_id):
    """Start year of the season a game belongs to (2026020001 -> 2026)."""
    return int(str(game_id)[:4])


def read_season_csv(kind, path=None, **kwargs):
    """Read this season's CSV. Before the first game is scraped the file
    doesn't exist yet; return an empty frame with last season's columns so
    callers can filter/aggregate without special-casing opening night."""
    import os
    import pandas as pd

    path = path or season_file(kind)
    if os.path.exists(path):
        return pd.read_csv(path, **kwargs)
    prev = os.path.join(os.path.dirname(path), season_file(kind, PREV_START_YEAR))
    if os.path.exists(prev):
        return pd.read_csv(prev, nrows=0, **{k: v for k, v in kwargs.items() if k != 'nrows'})
    return pd.DataFrame()


# Player models (MoneyPuck impact, PBP HD metrics, RAPM) rebuild once the
# season has this many games (~15 per team). Until then last season's
# committed player ratings (and their team assignments) stay in use.
PLAYER_MODEL_MIN_GAMES = 240

# Regular-season length: 84 games from 2026-27 (2025 CBA), 82 before.
SEASON_GAMES = 84 if START_YEAR >= 2026 else 82
