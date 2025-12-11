
import urllib.request
import json
import ssl

# Create unverified context for SSL to avoid cert errors
ssl._create_default_https_context = ssl._create_unverified_context

def get_url(url):
    """Helper to fetch URL with proper headers and error handling."""
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return json.loads(response.read().decode())
    except Exception as e:
        print(f"Error fetching {url}: {e}")
        return None

def get_schedule(date_str):
    """Fetch schedule for a specific date (YYYY-MM-DD)."""
    return get_url(f"https://api-web.nhle.com/v1/schedule/{date_str}")

# Test with a Saturday from 2023-24 season
date_str = "2023-11-04"
data = get_schedule(date_str)

if data:
    print(json.dumps(data, indent=2))
else:
    print("Failed to fetch data")
