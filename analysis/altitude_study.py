
import pandas as pd
import os

# Altitude Data (Feet)
# Sources based on earlier research
ALTITUDES = {
    'Avalanche': 5280, # Ball Arena
    'Flames': 3438,    # Scotiabank Saddledome
    'Oilers': 2201,    # Rogers Place
    'Golden Knights': 2030, # T-Mobile Arena
    'Coyotes': 1181,   # Mullett Arena (Inactive/Moved but important for history)
    'Mammoth': 4226,   # Delta Center
    'Hurricanes': 315, # Raleigh
    'Red Wings': 600,  # Detroit
    'Utah': 4226,      # Delta Center
    'Blue Jackets': 902,
    'Jets': 790,
    'Penguins': 784,
    'Wild': 751,
    'Sabres': 600,
    'Blackhawks': 579,
    'Predators': 550,
    'Blues': 466,
    'Stars': 430,
    'Maple Leafs': 251,
    'Canadiens': 233,
    'Senators': 230,
    'Kings': 233,
    'Ducks': 161,
    'Kraken': 159,
    'Devils': 150,
    'Canucks': 33, # Rogers Arena ~10m-30m depending on source, using low
    'Panthers': 97, # Sunrise
    'Sharks': 89,
    'Lightning': 48,
    'Flyers': 39,
    'Islanders': 33, # UBS
    'Rangers': 33,   # MSG
    'Bruins': 19,
    'Capitals': 20
}

# Mapping common names in CSV to keys above if needed
# The CSV uses: Panthers, Blackhawks, Rangers, Penguins, Kings, etc.
# These match the keys I used above (common names).

def get_altitude_bucket(feet):
    if feet >= 2000:
        return 'High (>2000 ft)'
    elif feet > 100:
        return 'Medium (100-2000 ft)'
    else:
        return 'Sea Level (<=100 ft)'

def analyze_altitude():
    # Load data
    data_path = os.path.join('analysis', 'data', 'historical_avs_games.csv')
    if not os.path.exists(data_path):
        print(f"Error: {data_path} not found.")
        return

    df = pd.read_csv(data_path)
    
    # Filter for Avalanche
    # My parser already filtered for team='Avalanche'
    avs_df = df.copy()
    
    # Filter for date >= 2021-10-01
    avs_df['date'] = pd.to_datetime(avs_df['date'])
    avs_df = avs_df[avs_df['date'] >= '2021-10-01']
    
    print(f"Found {len(avs_df)} Avalanche games since Oct 2021.")
    
    results = []
    
    for _, row in avs_df.iterrows():
        is_home = row['home_away'] == 'Home'
        opponent = row['opponent']
        
        # Determine Venue Team to look up altitude
        if is_home:
            venue_team = 'Avalanche'
        else:
            venue_team = opponent
            
        # Handle team name changes/edge cases
        if venue_team == 'Utah': venue_team = 'Mammoth' # Handle high altitude mapping
        if 'Arizona' in venue_team: venue_team = 'Coyotes' # Handle Arizona games -> Coyotes (Med/High?) 1181ft

        altitude = ALTITUDES.get(venue_team)
        
        if altitude is None:
            # Try finding key
            found = False
            for k in ALTITUDES.keys():
                if k in venue_team:
                    altitude = ALTITUDES[k]
                    found = True
                    break
            if not found:
                # Fallback: maybe it's just the full name in dict
                pass
                
            if not found:
                print(f"Warning: Could not find altitude for {venue_team}")
                altitude = 0 # Default to low?
        
        bucket = get_altitude_bucket(altitude)
        
        # Parse Result
        result_code = str(row['result']) # cast to string
        if 'W' in result_code:
            outcome = 'Win'
        elif 'L' in result_code:
            outcome = 'Loss'
        else:
            outcome = 'Unknown'
        
        # OTL check
        is_ot_loss = 'OTL' in result_code or 'SOL' in result_code or result_code == 'OL'
        
        results.append({
            'date': row['date'],
            'opponent': opponent,
            'venue': 'Home' if is_home else 'Away',
            'venue_team': venue_team,
            'altitude': altitude,
            'bucket': bucket,
            'result': result_code,
            'outcome': outcome,
            'is_ot_loss': is_ot_loss
        })
        
    results_df = pd.DataFrame(results)
    
    # Aggregation
    summary = results_df.groupby('bucket').agg(
        GP=('result', 'count'),
        Wins=('outcome', lambda x: (x == 'Win').sum()),
        Losses=('outcome', lambda x: (x == 'Loss').sum()),
        OTL=('is_ot_loss', 'sum') # Only counts overtime losses, which are included in Losses column usually in NHL standings but here we want W-L-OTL
    ).reset_index()
    
    # Correction: In NHL Standings, W is W (Reg+OT+SO), L is Reg Loss, OTL is OT/SO Loss.
    # My logic above: 'outcome' = Win if W in code. 'outcome' = Loss if L in code.
    # So 'Losses' right now includes OTL. I should subtract OTL from Losses to get Regulation Losses.
    
    summary['Reg_Losses'] = summary['Losses'] - summary['OTL']
    summary['Points_Pct'] = (summary['Wins'] * 2 + summary['OTL']) / (summary['GP'] * 2)
    summary['Win_Pct'] = summary['Wins'] / summary['GP']
    
    # Sort by Altitude logic (High to Low roughly)
    # Map bucket to sort order
    order = {'High (>2000 ft)': 0, 'Medium (500-2000 ft)': 1, 'Low (<500 ft)': 2}
    summary['sort'] = summary['bucket'].map(order)
    summary = summary.sort_values('sort').drop('sort', axis=1)
    
    print("\nCorrected Record (W-L-OTL) by Altitude Bucket:")
    print(summary.to_string(index=False))
    
    # Detailed Arena Stats
    arena_summary = results_df.groupby(['venue_team', 'altitude', 'bucket']).agg(
        GP=('result', 'count'),
        Wins=('outcome', lambda x: (x == 'Win').sum()),
        OTL=('is_ot_loss', 'sum')
    ).reset_index()
    arena_summary['Losses'] = arena_summary['GP'] - arena_summary['Wins'] - arena_summary['OTL'] # Reg Losses
    arena_summary['Pts%'] = (arena_summary['Wins'] * 2 + arena_summary['OTL']) / (arena_summary['GP'] * 2)
    
    # Filter for away games only? User asked "playing in those arenas", usually implies away.
    # But "Colorado Avalanche records playing in those arenas" includes Ball Arena (Home).
    # I will stick to All Games, but maybe also provide "Away Only" split for high/med/low.
    
    print("\n--- Away Games Only Analysis ---")
    away_df = results_df[results_df['venue'] == 'Away']
    away_summary = away_df.groupby('bucket').agg(
        GP=('result', 'count'),
        Wins=('outcome', lambda x: (x == 'Win').sum()),
        Losses=('outcome', lambda x: (x == 'Loss').sum()),
        OTL=('is_ot_loss', 'sum')
    ).reset_index()
    away_summary['Reg_Losses'] = away_summary['Losses'] - away_summary['OTL']
    away_summary['Points_Pct'] = (away_summary['Wins'] * 2 + away_summary['OTL']) / (away_summary['GP'] * 2)
    away_summary['sort'] = away_summary['bucket'].map(order)
    away_summary = away_summary.sort_values('sort').drop('sort', axis=1)
    
    print(away_summary.to_string(index=False))

if __name__ == "__main__":
    analyze_altitude()
