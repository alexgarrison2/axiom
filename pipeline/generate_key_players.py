
import pandas as pd
import json

def generate_key_players():
    print("Generating Key Players from 2025-2026 Stats...")
    
    try:
        df = pd.read_csv('nhl_season_2025_2026_player_stats.csv')
        # Filter for Skaters only
        df = df[df['position'] != 'G']
        
        # Calculate Total Points per Player per Team
        # Group by team, player_id, name, position
        player_stats = df.groupby(['team', 'name', 'position'])['points'].sum().reset_index()
        
        # We also need Games Played to sort tie-breaks or use PPG?
        # Let's just use raw points for now, it's the standard "Best Player" metric over a season.
        
        key_players = {}
        
        teams = player_stats['team'].unique()
        
        # Map Tricode to Common Name (Needs a mapper, or consistent usage)
        # Predict Games uses Common Names (e.g. "Avalanche")
        # We need a mapper. Let's try to load team_ratings.json keys?
        # Or just use a hardcoded map since we know the 32 teams.
        
        common_name_map = {
            "ANA": "Ducks", "BOS": "Bruins", "BUF": "Sabres", "CGY": "Flames",
            "CAR": "Hurricanes", "CHI": "Blackhawks", "COL": "Avalanche", "CBJ": "Blue Jackets",
            "DAL": "Stars", "DET": "Red Wings", "EDM": "Oilers", "FLA": "Panthers",
            "LAK": "Kings", "MIN": "Wild", "MTL": "Canadiens", "NSH": "Predators",
            "NJD": "Devils", "NYI": "Islanders", "NYR": "Rangers", "OTT": "Senators",
            "PHI": "Flyers", "PIT": "Penguins", "SJS": "Sharks", "SEA": "Kraken",
            "STL": "Blues", "TBL": "Lightning", "TOR": "Maple Leafs", "UTA": "Mammoth",
            "VAN": "Canucks", "VGK": "Golden Knights", "WSH": "Capitals", "WPG": "Jets"
        }
        
        for tri in teams:
            team_df = player_stats[player_stats['team'] == tri]
            
            # Sort by Points Descending
            sorted_players = team_df.sort_values(by='points', ascending=False)
            
            # Pick Top 3
            # We explicitly want the BEST players.
            # Strategy: Top 3 scorers regardless of position.
            # Or: Top 2 F, Top 1 D?
            # "Connor McDavid, Leon Draisaitl, Evan Bouchard" -> 2F, 1D
            # "Cale Makar, Nathan MacKinnon, Mikko Rantanen" -> 2F, 1D (Makar is D)
            # Let's just take Top 3 Points. Simpler and usually captures the stars.
            
            top_3 = sorted_players.head(3)['name'].tolist()
            
            # Clean Names (S. Bennett -> Sam Bennett? No, initials are fine if consistent with DFO news)
            # DFO News uses full names usually (e.g. "Aleksander Barkov").
            # player_stats.csv uses "S. Bennett".
            # We need to match what's in `player_news.json`. 
            # DFO News: "Connor McDavid". 
            # Stats CSV: "C. McDavid".
            # We need a robust "Partial Match" in predict_games.
            # predict_games already does `if kp in p_name`.
            # If kp is "C. McDavid", it fits in "Connor McDavid"? No. "Connor McDavid" contains "C. McDavid"? No.
            # We need to rely on Last Name, or ensure loose matching.
            # Actually, let's print what we get.
            
            common_name = common_name_map.get(tri, tri)
            key_players[common_name] = top_3
            
        # Output as Python Dict String
        print("key_players = {")
        for k, v in sorted(key_players.items()):
            # Format: "Team": ["P1", "P2", "P3"],
            v_str = ", ".join([f'"{x}"' for x in v])
            print(f'    "{k}": [{v_str}],')
        print("}")
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    generate_key_players()
