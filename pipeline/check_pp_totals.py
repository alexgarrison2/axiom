
import pandas as pd

def check_totals(team_abbr):
    print(f"--- Checking PP Stats for {team_abbr} ---")
    
    # 1. Load Our Data
    df_game = pd.read_csv('public/data/gamestats.csv')
    df_team = df_game[df_game['team'] == team_abbr].copy()
    
    our_goals = df_team['pp_goals'].sum()
    our_opps = df_team['pp_opportunities'].sum()
    our_pct = (our_goals / our_opps) * 100 if our_opps > 0 else 0
    
    print(f"APP (gamestats.csv): {our_goals}/{our_opps} ({our_pct:.2f}%)")
    
    # 2. Load H-Ref Data (Source of Truth)
    df_href = pd.read_csv('href_stats.csv')
    # Filter for team (using H-Ref mapping if needed, but standard abbrs usually match)
    # Note: local file uses 'team' column
    # Map "Oilers" -> "EDM" (hack for this script, better to load from nhl_teams.csv in prod)
    team_map = {"Oilers": "EDM"}
    href_abbr = team_map.get(team_abbr, team_abbr)
    print(f"Mapping '{team_abbr}' -> '{href_abbr}'")
    
    df_href_team = df_href[df_href['team'] == href_abbr].copy()
    
    href_goals = pd.to_numeric(df_href_team['pp_goals']).sum()
    href_opps = pd.to_numeric(df_href_team['pp_opportunities']).sum()
    href_pct = (href_goals / href_opps) * 100 if href_opps > 0 else 0
    
    print(f"H-REF (Source):      {href_goals}/{href_opps} ({href_pct:.2f}%)")
    
    diff = our_pct - href_pct
    print(f"Variance: {diff:.2f}%")
    
    # 3. Drill down to find mismatched games
    print("\n--- Mismatched Games ---")
    # Convert dates to string for matching
    df_team['date_str'] = pd.to_datetime(df_team['game_date']).dt.strftime('%Y-%m-%d')
    # Create lookup from H-Ref
    href_lookup = {}
    for _, row in df_href_team.iterrows():
        href_lookup[row['date']] = (int(row['pp_goals']), int(row['pp_opportunities']))
        
    for _, row in df_team.iterrows():
        d = row['date_str']
        if d in href_lookup:
            h_g, h_o = href_lookup[d]
            o_g = int(row['pp_goals'])
            o_o = int(row['pp_opportunities'])
            
            if h_g != o_g or h_o != o_o:
                print(f"{d} vs {row['opponent']}: App({o_g}/{o_o}) vs HRef({h_g}/{h_o})")
    

if __name__ == "__main__":
    check_totals("Oilers") # Match the user's screenshot example
