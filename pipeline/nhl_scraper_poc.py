"""Deprecated name kept as a shim: the scraper now lives in scrape_games.py."""
from scrape_games import *  # noqa: F401,F403
from scrape_games import (  # noqa: F401
    main, aggregate_game_stats, extract_pbp_rows, get_pbp, get_boxscore, parse_boxscore, assign_bin,
)

if __name__ == "__main__":
    import sys
    print(main(sys.argv[1:]))
