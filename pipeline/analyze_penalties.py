import json

def analyze_penalties():
    with open('pbp.json', 'r') as f:
        data = json.load(f)
    
    plays = data.get('plays', [])
    penalty_types = {}
    
    for play in plays:
        if play.get('typeCode') == 509:
            details = play.get('details', {})
            type_code = details.get('typeCode')
            desc_key = details.get('descKey')
            duration = details.get('duration')
            
            key = (type_code, desc_key, duration)
            if key not in penalty_types:
                penalty_types[key] = 0
            penalty_types[key] += 1
            
    print(f"{'Type Code':<10} | {'Duration':<8} | {'Desc Key'}")
    print("-" * 40)
    for (tc, dk, dur), count in sorted(penalty_types.items()):
        print(f"{tc:<10} | {dur:<8} | {dk} ({count})")

if __name__ == "__main__":
    analyze_penalties()
