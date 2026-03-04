"""
fetch_contracts.py
Scrapes contract data (cap hit, UFA/RFA status) from PuckPedia for all NHL
teams and writes public/data/contracts.json.

Output format (keyed by player_id string):
{
  "8482740": {
    "cap_hit": 12000000,
    "status": "UFA",
    "year": 2033
  },
  ...
}

- cap_hit: integer, annual cap hit in dollars
- status: "UFA" or "RFA"
- year: integer year they become UFA/RFA, or null if UFA/RFA THIS off-season

Run: python3 pipeline/fetch_contracts.py
"""

import urllib.request
import json
import os
import re
import ssl
import time

try:
    from bs4 import BeautifulSoup
except ImportError:
    raise ImportError("beautifulsoup4 is required: pip install beautifulsoup4")

BASE_URL = "https://puckpedia.com/team"
NHL_API = "https://api-web.nhle.com/v1"
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_FILE = os.path.join(_ROOT, "public", "data", "contracts.json")

SEASON = "20252026"

# Map NHL 3-letter code → PuckPedia URL slug
TEAM_SLUGS = {
    "ANA": "anaheim-ducks",
    "BOS": "boston-bruins",
    "BUF": "buffalo-sabres",
    "CAR": "carolina-hurricanes",
    "CBJ": "columbus-blue-jackets",
    "CGY": "calgary-flames",
    "CHI": "chicago-blackhawks",
    "COL": "colorado-avalanche",
    "DAL": "dallas-stars",
    "DET": "detroit-red-wings",
    "EDM": "edmonton-oilers",
    "FLA": "florida-panthers",
    "LAK": "los-angeles-kings",
    "MIN": "minnesota-wild",
    "MTL": "montreal-canadiens",
    "NJD": "new-jersey-devils",
    "NSH": "nashville-predators",
    "NYI": "new-york-islanders",
    "NYR": "new-york-rangers",
    "OTT": "ottawa-senators",
    "PHI": "philadelphia-flyers",
    "PIT": "pittsburgh-penguins",
    "SEA": "seattle-kraken",
    "SJS": "san-jose-sharks",
    "STL": "st-louis-blues",
    "TBL": "tampa-bay-lightning",
    "TOR": "toronto-maple-leafs",
    "UTA": "utah-hockey-club",
    "VAN": "vancouver-canucks",
    "VGK": "vegas-golden-knights",
    "WSH": "washington-capitals",
    "WPG": "winnipeg-jets",
}

ssl._create_default_https_context = ssl._create_unverified_context

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.google.com/",
}


def get_html(url: str) -> str | None:
    """Fetch HTML from a URL with browser-like headers."""
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.read().decode("utf-8", errors="replace")
    except Exception as e:
        print(f"  Error fetching {url}: {e}")
        return None


def get_json(url: str):
    """Fetch JSON from a URL."""
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        print(f"  Error fetching JSON {url}: {e}")
        return None


def normalize_name(name: str) -> str:
    """Normalize a player name for matching: lowercase, strip accents, strip suffixes."""
    import unicodedata
    name = unicodedata.normalize("NFD", name)
    name = "".join(c for c in name if unicodedata.category(c) != "Mn")
    name = name.lower().strip()
    # Remove common suffixes
    name = re.sub(r"\s+(jr\.?|sr\.?|ii|iii|iv)$", "", name)
    return name


def parse_cap_hit(text: str) -> int:
    """Parse a dollar amount string into integer cents.
    Handles: '$12,000,000', '$12.00M', '$975K', '$975,000'
    """
    text = text.strip().replace(",", "").replace("$", "")
    if not text:
        return 0
    # Handle M suffix
    m = re.match(r"([\d.]+)\s*M", text, re.IGNORECASE)
    if m:
        return int(float(m.group(1)) * 1_000_000)
    # Handle K suffix
    m = re.match(r"([\d.]+)\s*K", text, re.IGNORECASE)
    if m:
        return int(float(m.group(1)) * 1_000)
    # Plain number
    try:
        return int(float(text))
    except ValueError:
        return 0


def build_roster_lookup(team: str) -> dict[str, int]:
    """Build name → player_id lookup from NHL roster API.
    Returns dict mapping normalized 'first last' name to player_id.
    """
    data = get_json(f"{NHL_API}/roster/{team}/{SEASON}")
    if not data:
        return {}

    lookup: dict[str, int] = {}
    for group in ("forwards", "defensemen", "goalies"):
        for player in data.get(group, []):
            pid = player.get("id")
            first = player.get("firstName", {}).get("default", "")
            last = player.get("lastName", {}).get("default", "")
            if pid and (first or last):
                full = normalize_name(f"{first} {last}")
                lookup[full] = pid
                # Also store by last name only (fallback)
                last_norm = normalize_name(last)
                if last_norm not in lookup:
                    lookup[f"_last_{last_norm}"] = pid
    return lookup


def parse_puckpedia_team(html: str, roster_lookup: dict[str, int]) -> dict[str, dict]:
    """Parse a PuckPedia team page and return contract data keyed by player_id."""
    soup = BeautifulSoup(html, "html.parser")
    contracts: dict[str, dict] = {}

    tables = soup.find_all("table")

    for table in tables:
        # Check the table headers to find contract tables
        thead = table.find("thead")
        if not thead:
            continue
        headers = [th.get_text(strip=True) for th in thead.find_all("th")]
        if len(headers) < 3:
            continue

        # Contract tables have year headers like "2025-26"
        year_pattern = re.compile(r"20\d{2}-\d{2}")
        year_cols = [(i, h) for i, h in enumerate(headers) if year_pattern.match(h)]
        if not year_cols:
            continue

        # Find the current season column (2025-26)
        current_col_idx = None
        for idx, h in year_cols:
            if h == "2025-26":
                current_col_idx = idx
                break
        if current_col_idx is None:
            continue

        tbody = table.find("tbody")
        if not tbody:
            continue

        for row in tbody.find_all("tr"):
            cells = row.find_all("td")
            if len(cells) <= current_col_idx:
                continue

            # Extract player name
            name_cell = cells[0]
            name_link = name_cell.find("a")
            if not name_link:
                continue
            raw_name = name_link.get_text(strip=True)

            # PuckPedia uses "Last, First" format
            if "," in raw_name:
                parts = raw_name.split(",", 1)
                player_name = f"{parts[1].strip()} {parts[0].strip()}"
            else:
                player_name = raw_name

            norm = normalize_name(player_name)

            # Match to NHL player ID
            pid = roster_lookup.get(norm)
            if not pid:
                # Try last-name fallback
                last = norm.split()[-1] if norm else ""
                pid = roster_lookup.get(f"_last_{last}")
            if not pid:
                continue

            pid_str = str(pid)

            # Extract cap hit from current season column
            cap_cell = cells[current_col_idx]
            cap_hit = 0

            # Try data-ch attribute first
            data_ch = cap_cell.get("data-ch", "")
            if data_ch:
                cap_hit = parse_cap_hit(data_ch)

            # Fallback: parse the text content
            if cap_hit == 0:
                cap_text = cap_cell.get_text(strip=True)
                # The cell may contain both full and short format, e.g. "$12,000,000$12.00M"
                # Try to extract the full dollar amount
                dollar_match = re.search(r"\$[\d,]+(?:\.\d+)?(?!\.\d*M)", cap_text)
                if dollar_match:
                    cap_hit = parse_cap_hit(dollar_match.group())
                elif cap_text:
                    cap_hit = parse_cap_hit(cap_text)

            if cap_hit == 0:
                continue

            # Determine UFA/RFA status
            # Look through future year columns to find status
            status = "UFA"  # default
            year = None  # null = this off-season

            # Check the last column (expiry badge)
            last_cell = cells[-1]
            last_text = last_cell.get_text(strip=True).upper()

            # Check for UFA/RFA divs in the last cell
            ufa_div = last_cell.find(class_=re.compile(r"pp-ufa", re.IGNORECASE))
            rfa_div = last_cell.find(class_=re.compile(r"pp-rfa", re.IGNORECASE))

            if ufa_div or "UFA" in last_text:
                status = "UFA"
                # Extract year from the cell
                year_match = re.search(r"20\d{2}", last_cell.get_text())
                if year_match:
                    year = int(year_match.group())
            elif rfa_div or "RFA" in last_text:
                status = "RFA"
                year_match = re.search(r"20\d{2}", last_cell.get_text())
                if year_match:
                    year = int(year_match.group())

            # If no status found in last cell, scan year columns after current
            if year is None:
                for col_idx, col_header in year_cols:
                    if col_idx <= current_col_idx:
                        continue
                    cell = cells[col_idx] if col_idx < len(cells) else None
                    if not cell:
                        continue
                    cell_text = cell.get_text(strip=True).upper()
                    cell_ufa = cell.find(class_=re.compile(r"pp-ufa", re.IGNORECASE))
                    cell_rfa = cell.find(class_=re.compile(r"pp-rfa", re.IGNORECASE))

                    if cell_ufa or "UFA" in cell_text:
                        status = "UFA"
                        # Year is the start year of this column header (e.g., "2026-27" → 2027)
                        ym = re.match(r"(20\d{2})-\d{2}", col_header)
                        if ym:
                            year = int(ym.group(1)) + 1
                        break
                    elif cell_rfa or "RFA" in cell_text:
                        status = "RFA"
                        ym = re.match(r"(20\d{2})-\d{2}", col_header)
                        if ym:
                            year = int(ym.group(1)) + 1
                        break

            # If year equals next off-season (2026), it means UFA/RFA THIS off-season → null
            if year is not None and year <= 2026:
                year = None

            contracts[pid_str] = {
                "cap_hit": cap_hit,
                "status": status,
                "year": year,
            }

    return contracts


def main():
    print("--- Fetching Contract Data from PuckPedia ---")
    all_contracts: dict[str, dict] = {}

    for team, slug in TEAM_SLUGS.items():
        print(f"  {team} ({slug})...", end="", flush=True)

        # Build name → ID lookup from NHL roster API
        roster_lookup = build_roster_lookup(team)
        if not roster_lookup:
            print(" FAILED (no roster)")
            continue

        # Fetch PuckPedia page
        url = f"{BASE_URL}/{slug}"
        html = get_html(url)
        if not html:
            print(" FAILED (no HTML)")
            time.sleep(1)
            continue

        # Parse contracts
        team_contracts = parse_puckpedia_team(html, roster_lookup)
        all_contracts.update(team_contracts)
        print(f" {len(team_contracts)} players")

        time.sleep(0.5)  # Be polite to PuckPedia

    # Write output
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, "w") as f:
        json.dump(all_contracts, f)

    print(f"\nSaved contracts for {len(all_contracts)} players → {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
