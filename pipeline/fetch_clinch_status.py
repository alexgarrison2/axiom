"""
fetch_clinch_status.py
Fetches official playoff clinch / elimination status from the NHL Standings API
and writes public/data/clinch_status.json.

Output format (keyed by team tricode, e.g. "COL", "VAN"):
{
  "COL": "z",   // z = Clinched Division
  "CAR": "x",   // x = Clinched Playoff Spot
  "VAN": "e",   // e = Eliminated
  "TOR": null,  // null = still competing
  ...
}

NHL clinchIndicator values (from api-web.nhle.com):
  p  = Presidents' Trophy (best record in league)
  z  = Clinched Division
  y  = Clinched Conference
  x  = Clinched Playoff Spot (wildcard)
  e  = Eliminated
  (absent / null) = still competing

Run: python3 pipeline/fetch_clinch_status.py
"""

import urllib.request
import json
import os
import ssl

BASE_URL = "https://api-web.nhle.com/v1"
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_FILE = os.path.join(_ROOT, "public", "data", "clinch_status.json")

ssl._create_default_https_context = ssl._create_unverified_context


def get_url(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        print(f"  Error fetching {url}: {e}")
        return None


def main():
    print("--- Fetching Clinch/Elimination Status ---")

    data = get_url(f"{BASE_URL}/standings/now")
    if not data:
        print("FAILED to fetch standings")
        return

    standings = data.get("standings", [])
    clinch_map: dict = {}

    for team in standings:
        # teamAbbrev is a dict {"default": "COL"} in the v1 API
        abbrev = team.get("teamAbbrev", {})
        if isinstance(abbrev, dict):
            abbrev = abbrev.get("default", "")

        # clinchIndicator: "p", "z", "y", "x", "e", or absent (None)
        indicator = team.get("clinchIndicator")  # None = still competing
        clinch_map[abbrev] = indicator

    with open(OUTPUT_FILE, "w") as f:
        json.dump(clinch_map, f, indent=2)

    clinched = sorted([t for t, v in clinch_map.items() if v and v != "e"])
    eliminated = sorted([t for t, v in clinch_map.items() if v == "e"])
    competing = sorted([t for t, v in clinch_map.items() if not v])

    print(f"Clinched   ({len(clinched)}):  {', '.join(clinched)}")
    print(f"Eliminated ({len(eliminated)}): {', '.join(eliminated)}")
    print(f"Competing  ({len(competing)}):  {', '.join(competing)}")
    print(f"\nSaved {len(clinch_map)} teams → {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
