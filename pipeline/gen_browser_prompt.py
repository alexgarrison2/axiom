
MAPPING = {
    "VGK": "VEG",
    "UTA": "UTA", 
}

TEAMS = ["ANA", "BOS", "BUF", "CAR", "CBJ"] # First 5 teams
SEASONS = [2025, 2026]

urls = []
for s in SEASONS:
    for t in TEAMS:
        code = MAPPING.get(t, t)
        if t == "UTA" and s < 2025: code = "ARI"
        url = f"https://www.hockey-reference.com/teams/{code}/{s}_games.html"
        name = f"{s}_{t}.html"
        urls.append((url, name))

print("I need you to visit the following URLs and extract the HTML of the schedule table (id='games').")
print("For each URL, output the content in the following format:")
print("=== FILE: [Filename] ===")
print("[HTML Content]")
print("=== END FILE ===")
print("")
print("URLs:")
for u, n in urls:
    print(f"- URL: {u} (Filename: {n})")
