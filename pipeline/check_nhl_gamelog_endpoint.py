
import urllib.request
import json
import ssl

TEAMS = ["PIT", "DET"]
SEASON = "20252026"

PATTERNS = [
    f"https://api-web.nhle.com/v1/club-stats/PIT/{SEASON}/gamelog",
    f"https://api-web.nhle.com/v1/club-gamelog/PIT/{SEASON}",
    f"https://api-web.nhle.com/v1/club-stats-season/PIT/{SEASON}",
    "https://api-web.nhle.com/v1/club-stats/PIT/now"
]

def check_endpoints():
    headers = {'User-Agent': 'Mozilla/5.0'}
    context = ssl._create_unverified_context()
    
    for url in PATTERNS:
        print(f"Trying {url}...")
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, context=context) as response:
                print(f"  [SUCCESS] {response.status}")
                data = json.loads(response.read().decode('utf-8'))
                print(f"  Keys: {list(data.keys())[:5]}")
        except Exception as e:
            print(f"  [FAILED] {e}")

if __name__ == "__main__":
    check_endpoints()
