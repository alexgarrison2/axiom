"""Deprecated name kept as a shim: the scraper now lives in scrape_games.py."""
from scrape_games import *  # noqa: F401,F403
from scrape_games import (  # noqa: F401
    main, aggregate_game_stats, extract_pbp_rows, get_pbp, get_boxscore, parse_boxscore, assign_bin,
    get_url, calculate_shot_metrics,
)


def load_href_stats():
    """Removed: PP/PK counts now come from the official NHL report
    (scrape_games.patch_special_teams).  Kept as a no-op so one-off tools
    that still call it (build_historical_2223.py) keep importing."""
    print("load_href_stats: Hockey-Reference stats were retired; use scrape_games.patch_special_teams()")

if __name__ == "__main__":
    import sys
    print(main(sys.argv[1:]))
