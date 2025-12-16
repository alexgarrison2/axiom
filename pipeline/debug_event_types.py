
import urllib.request
import json
import ssl

ssl._create_default_https_context = ssl._create_unverified_context

def get_pbp(game_id):
    url = f"https://api-web.nhle.com/v1/gamecenter/{game_id}/play-by-play"
    print(f"Fetching {url}")
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as response:
        return json.loads(response.read().decode())

def main():
    game_id = 2025020462 # Use the known game
    pbp = get_pbp(game_id)
    
    types = set()
    for p in pbp.get('plays', []):
        types.add((p.get('typeCode'), p.get('typeDescKey')))
        
    print("\nEvent Types Found:")
    for code, desc in sorted(list(types)):
        print(f"Code: {code}, Desc: {desc}")

    print("\n--- Inspecting Stoppages (516) ---")
    count = 0
    for p in pbp.get('plays', []):
        if p.get('typeCode') == 516:
            details = p.get('details', {})
            if details.get('reason', '').lower() == 'icing':
                print(f"Full Play (Icing): {p}")
                count += 1
                if count > 2: break

    print("\n--- Inspecting Missed Shots (507) ---")
    count = 0
    for p in pbp.get('plays', []):
        if p.get('typeCode') == 507:
            print(f"Code: 507, Owner: {p.get('details', {}).get('eventOwnerTeamId')}, Details: {p.get('details')}")
            count += 1
            if count > 3: break


if __name__ == "__main__":
    main()
