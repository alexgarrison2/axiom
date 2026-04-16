"""
fetch_dfo_tweets.py
Fetches recent tweets (+ retweets) from @DFOFantasy via nitter RSS,
infers which playoff team each tweet is about using roster / coach /
team-name matching, then merges into playoff_player_news.json.

No API key or auth required — uses public nitter RSS endpoint.
"""

import html
import json
import re
import subprocess
import unicodedata
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

# ── Paths ─────────────────────────────────────────────────────────────────────
PIPELINE_DIR = Path(__file__).parent
PUBLIC_DATA  = PIPELINE_DIR / '..' / 'public' / 'data'
ACCUM_FILE   = PIPELINE_DIR / 'playoff_player_news.json'
PUBLIC_FILE  = PUBLIC_DATA  / 'playoff_player_news.json'

# Nitter instances to try in order (fallback if first is down)
NITTER_INSTANCES = [
    'https://nitter.net',
    'https://nitter.privacydev.net',
    'https://nitter.poast.org',
]
DFO_HANDLE  = 'DFOFantasy'

# ── Playoff team metadata ─────────────────────────────────────────────────────
TEAM_META: dict[str, dict] = {
    'CAR': {'names': ['hurricanes', 'carolina', 'canes'],
            'coaches': ["brind'amour", 'brindamour', 'rod brind']},
    'OTT': {'names': ['senators', 'ottawa', 'sens'],
            'coaches': ['travis green']},
    'BUF': {'names': ['sabres', 'buffalo'],
            'coaches': ['granato', 'don granato']},
    'BOS': {'names': ['bruins', 'boston'],
            'coaches': ['montgomery', 'jim montgomery']},
    'TBL': {'names': ['lightning', 'tampa', 'tampa bay'],
            'coaches': ['cooper', 'jon cooper']},
    'MTL': {'names': ['canadiens', 'montreal', 'habs'],
            'coaches': ['st. louis', 'martin st. louis', 'st louis']},
    'PIT': {'names': ['penguins', 'pittsburgh', 'pens'],
            'coaches': ['sullivan', 'mike sullivan']},
    'PHI': {'names': ['flyers', 'philadelphia'],
            'coaches': ['tortorella', 'john tortorella']},
    'COL': {'names': ['avalanche', 'colorado', 'avs', 'goavsgo', 'go avs go'],
            'coaches': ['bednar', 'jared bednar']},
    'LAK': {'names': ['kings', 'los angeles', 'la kings', 'lakings'],
            'coaches': ['mclellan', 'todd mclellan']},
    'DAL': {'names': ['stars', 'dallas', 'gogostars'],
            'coaches': ['deboer', "pete deboer", "de boer"]},
    'MIN': {'names': ['wild', 'minnesota'],
            'coaches': ['evason', 'dean evason']},
    'VGK': {'names': ['golden knights', 'vegas', 'vgk', 'goalden knights'],
            'coaches': ['cassidy', 'bruce cassidy']},
    'UTA': {'names': ['utah', 'hockey club'],
            'coaches': ['arniel', 'scott arniel']},
    'EDM': {'names': ['oilers', 'edmonton', 'oilersnation'],
            'coaches': ['knoblauch', 'kris knoblauch']},
    'ANA': {'names': ['ducks', 'anaheim'],
            'coaches': ['cronin', 'greg cronin']},
}
PLAYOFF_TRICODES = set(TEAM_META.keys())

# name-token → set of tricodes (built at runtime from rosters + coaches)
NAME_TO_TEAMS: dict[str, set[str]] = {}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _norm(s: str) -> str:
    s = unicodedata.normalize('NFD', s).encode('ascii', 'ignore').decode()
    return re.sub(r"[^a-z0-9 ]", '', s.lower()).strip()


def strip_html(text: str) -> str:
    text = re.sub(r'<[^>]+>', ' ', text)
    text = html.unescape(text)
    return re.sub(r'\s+', ' ', text).strip()


def build_name_index() -> None:
    """Populate NAME_TO_TEAMS from team_lineups.json + coach names."""
    path = PUBLIC_DATA / 'team_lineups.json'
    try:
        lineups: dict = json.loads(path.read_text())
    except Exception:
        print('  [WARN] Could not load team_lineups.json')
        lineups = {}

    for tri, lineup in lineups.items():
        if tri not in PLAYOFF_TRICODES:
            continue
        for key in ('f1', 'f2', 'f3', 'f4', 'd1', 'd2', 'd3', 'ir'):
            for player in (lineup.get(key) or []):
                full  = _norm(player.get('name', ''))
                parts = full.split()
                last  = parts[-1] if parts else ''
                for token in ([full] + ([last] if last and len(last) > 3 else [])):
                    NAME_TO_TEAMS.setdefault(token, set()).add(tri)

    # Coach names
    for tri, meta in TEAM_META.items():
        for coach in meta.get('coaches', []):
            token = _norm(coach)
            NAME_TO_TEAMS.setdefault(token, set()).add(tri)
            parts = token.split()
            if len(parts) > 1:
                NAME_TO_TEAMS.setdefault(parts[-1], set()).add(tri)

    print(f'  Name index: {len(NAME_TO_TEAMS)} tokens across {len(PLAYOFF_TRICODES)} teams')


def infer_teams(text: str) -> list[str]:
    """Return playoff tricodes that are referenced in the tweet text."""
    normed = _norm(text)
    scores: dict[str, int] = {}

    # 1. Roster / coach name matching (greedy longest-match)
    words = normed.split()
    n = len(words)
    found_phrases: set[str] = set()
    for length in (4, 3, 2, 1):
        for i in range(n - length + 1):
            phrase = ' '.join(words[i:i + length])
            if phrase in found_phrases:
                continue
            if phrase in NAME_TO_TEAMS:
                found_phrases.add(phrase)
                for tri in NAME_TO_TEAMS[phrase]:
                    scores[tri] = scores.get(tri, 0) + length

    # 2. Team nickname / city name matching
    for tri, meta in TEAM_META.items():
        for alias in meta.get('names', []):
            if _norm(alias) in normed:
                scores[tri] = scores.get(tri, 0) + 2

    # 3. Hashtag matching  e.g. #GoAvsGo → COL
    hashtags = re.findall(r'#(\w+)', text.lower())
    for tag in hashtags:
        nt = _norm(tag)
        for tri, meta in TEAM_META.items():
            for alias in meta.get('names', []):
                if _norm(alias).replace(' ', '') in nt or nt in _norm(alias).replace(' ', ''):
                    scores[tri] = scores.get(tri, 0) + 1

    if not scores:
        return []

    max_score = max(scores.values())
    return [t for t, s in sorted(scores.items(), key=lambda x: -x[1])
            if s >= max_score * 0.5]


def classify_category(text: str) -> str:
    t = text.lower()
    if any(w in t for w in ['out ', ' out,', ' out.', 'injured', 'injury', ' ir ', 'day-to-day',
                             'dtd', 'week-to-week', 'season-ending', 'placed on', 'unavailable',
                             "won't play", 'ruled out', 'doubtful', 'questionable', 'concussion',
                             'surgery', 'will not', 'upper-body', 'lower-body', 'missed']):
        return 'Injury'
    if any(w in t for w in ['will start', 'starting goalie', 'between the pipes', 'in net',
                             'confirmed goalie', 'likely start', '🥅']):
        return 'Goalie News'
    if any(w in t for w in ['scratch', 'healthy scratch', 'line change', 'promoted', 'recalled',
                             'reassigned', 'lineup']):
        return 'Line Change'
    return 'News'


def extract_players(text: str, teams: list[str]) -> str:
    """Return a comma-joined string of player names found in the tweet for the matched teams."""
    normed = _norm(text)
    found: list[str] = []
    seen:  set[str]  = set()

    for tri in teams:
        for token, tricodes in NAME_TO_TEAMS.items():
            if tri not in tricodes or token in seen or len(token) <= 3:
                continue
            if token in normed:
                # Find original capitalisation in source text
                last = token.split()[-1]
                m = re.search(r'\b' + re.escape(last) + r'\b', text, re.IGNORECASE)
                if m:
                    found.append(m.group(0))
                    seen.add(token)
    return ', '.join(found) if found else 'Team Update'


# ── RSS fetch ─────────────────────────────────────────────────────────────────

def fetch_rss(handle: str) -> list[dict]:
    """Fetch nitter RSS and return list of {id, text, timestamp, author}."""
    for base in NITTER_INSTANCES:
        url = f'{base}/{handle}/rss'
        try:
            result = subprocess.run(
                ['curl', '-s', '--max-time', '15', '-A', 'Mozilla/5.0', url],
                capture_output=True, text=True
            )
            xml_text = result.stdout
            if not xml_text or '<item>' not in xml_text:
                continue

            root = ET.fromstring(xml_text)
            ns   = {'dc': 'http://purl.org/dc/elements/1.1/'}
            items: list[dict] = []

            for item in root.findall('.//item'):
                guid_el  = item.find('guid')
                title_el = item.find('title')
                date_el  = item.find('pubDate')
                creator_el = item.find('dc:creator', ns)

                tweet_id  = guid_el.text if guid_el is not None else ''
                raw_title = title_el.text if title_el is not None else ''
                pub_date  = date_el.text  if date_el  is not None else ''
                author    = creator_el.text if creator_el is not None else '@DFOFantasy'

                # Clean up title: strip "RT by @DFOFantasy:" prefix, decode entities
                text = re.sub(r'^R[Tt] by @\w+:\s*', '', raw_title).strip()
                text = html.unescape(text)

                # Parse timestamp to ISO 8601
                try:
                    dt = parsedate_to_datetime(pub_date)
                    ts = dt.astimezone(timezone.utc).isoformat()
                except Exception:
                    ts = pub_date

                items.append({'id': tweet_id, 'text': text, 'timestamp': ts, 'author': author})

            print(f'  RSS OK from {base}: {len(items)} items')
            return items
        except Exception as e:
            print(f'  RSS {base} failed: {e}')
            continue

    print('  [ERR] All nitter instances failed')
    return []


# ── Main ──────────────────────────────────────────────────────────────────────

def fetch_dfo_tweets() -> None:
    print('=== Fetching @DFOFantasy tweets (nitter RSS) ===')

    build_name_index()

    # Load accumulated news
    try:
        accumulated: dict = json.loads(ACCUM_FILE.read_text())
    except Exception:
        accumulated = {}

    # Build seen-tweet-id set
    seen_ids: set[str] = set()
    for items in accumulated.values():
        for item in items:
            if 'tweet_id' in item:
                seen_ids.add(str(item['tweet_id']))

    raw = fetch_rss(DFO_HANDLE)
    if not raw:
        return

    new_count = 0
    skipped   = 0
    for tweet in raw:
        tid = str(tweet['id'])
        if tid in seen_ids:
            skipped += 1
            continue

        teams = infer_teams(tweet['text'])
        if not teams:
            # still keep it under a special 'GENERAL' key so nothing is lost
            teams = ['GENERAL']

        date_str = tweet['timestamp'][:10]
        players  = extract_players(tweet['text'], [t for t in teams if t != 'GENERAL'])
        category = classify_category(tweet['text'])

        item = {
            'player':    players,
            'news':      tweet['text'],
            'category':  category,
            'date':      date_str,
            'timestamp': tweet['timestamp'],
            'source':    f"X/@DFOFantasy (via {tweet['author']})",
            'tweet_id':  tid,
        }

        for tri in teams:
            accumulated.setdefault(tri, []).append(dict(item))
        seen_ids.add(tid)
        new_count += 1

    # Sort each team newest-first
    for tri in accumulated:
        accumulated[tri].sort(
            key=lambda x: x.get('timestamp', x.get('date', '')), reverse=True
        )

    ACCUM_FILE.write_text(json.dumps(accumulated, indent=2))
    PUBLIC_FILE.write_text(json.dumps(accumulated, indent=2))

    x_teams = sorted(t for t, items in accumulated.items()
                     if any('tweet_id' in i for i in items) and t != 'GENERAL')
    print(f'  ✓ {new_count} new items  |  {skipped} already seen  |  teams: {x_teams}')
    print('=== Done ===')


if __name__ == '__main__':
    fetch_dfo_tweets()
