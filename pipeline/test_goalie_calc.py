import json

with open('goalie_ratings.json', 'r') as f:
    goalie_ratings = json.load(f)

GOALIE_IMPACT_FACTOR = 0.5

goalies_to_check = ["David Rittich", "Akira Schmid", "Pyotr Kochetkov"]

for name in goalies_to_check:
    stats = goalie_ratings.get(name, {})
    gsax = stats.get('gsax_per_game', 0)
    impact = -(gsax * GOALIE_IMPACT_FACTOR)
    print(f"Goalie: {name}")
    print(f"  GSAx/Game: {gsax}")
    print(f"  Calculated Impact: {impact:.2f}")
    print(f"  GSAx Total: {stats.get('gsax_total', 0)}")
    print("-" * 20)
