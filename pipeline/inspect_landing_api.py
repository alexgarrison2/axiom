
import urllib.request
import json
import ssl

ssl._create_default_https_context = ssl._create_unverified_context

def get_landing(game_id):
    url = f"https://api-web.nhle.com/v1/gamecenter/{game_id}/landing"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            return json.loads(response.read().decode())
    except Exception as e:
        print(f"Error: {e}")
        return None

def find_key(data, target_key):
    if isinstance(data, dict):
        if target_key in data:
            return data[target_key]
        for key, value in data.items():
            result = find_key(value, target_key)
            if result: return result
    elif isinstance(data, list):
        for item in data:
            result = find_key(item, target_key)
            if result: return result
    return None

game_id = 2023020208
data = get_landing(game_id)
if data:
    attendance = find_key(data, "attendance")
    print(f"Attendance found: {attendance}")
    
    # Dump keys to see what we have
    print(f"Top keys: {list(data.keys())}")
    
    # Check inside 'summary' if it exists
    if 'summary' in data:
        print(f"Summary keys: {list(data['summary'].keys())}")
