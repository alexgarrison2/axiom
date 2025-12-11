import pandas as pd
import numpy as np

def analyze_advanced_metrics():
    print("Loading game data...")
    df = pd.read_csv('nhl_season_2025_2026_gamestats.csv')
    df['game_date'] = pd.to_datetime(df['game_date'])
    df = df.sort_values('game_date')
    
    # We need to calculate rolling metrics for each team BEFORE the game starts.
    # So we iterate through time.
    
    results = []
    
    # Dictionary to track team stats
    # team_stats[team] = { 'games': [], 'rolling_pdo': [], 'rolling_hits': [] }
    team_history = {}
    
    print("Processing games...")
    for index, row in df.iterrows():
        team = row['team']
        opp = row['opponent']
        date = row['game_date']
        
        # Get Pre-Game Stats from History
        t_hist = team_history.get(team, [])
        o_hist = team_history.get(opp, [])
        
        # Need at least 5 games to have a trend
        if len(t_hist) >= 5 and len(o_hist) >= 5:
            # Calculate Rolling PDO
            # PDO = (Goals / SOG) + (Saves / SA)
            # We take last 5 games
            t_recent = pd.DataFrame(t_hist[-5:])
            o_recent = pd.DataFrame(o_hist[-5:])
            
            t_sh_pct = t_recent['goals_for'].sum() / t_recent['sog_for'].sum() if t_recent['sog_for'].sum() > 0 else 0
            t_sv_pct = t_recent['saves_for'].sum() / t_recent['sog_ag'].sum() if t_recent['sog_ag'].sum() > 0 else 0
            t_pdo = (t_sh_pct + t_sv_pct) * 1000
            
            o_sh_pct = o_recent['goals_for'].sum() / o_recent['sog_for'].sum() if o_recent['sog_for'].sum() > 0 else 0
            o_sv_pct = o_recent['saves_for'].sum() / o_recent['sog_ag'].sum() if o_recent['sog_ag'].sum() > 0 else 0
            o_pdo = (o_sh_pct + o_sv_pct) * 1000
            
            # Calculate Rolling Hits
            t_hits_avg = t_recent['hits_for'].mean()
            o_hits_avg = o_recent['hits_for'].mean()
            
            # Outcome
            is_win = row['result'] in ['RW', 'OTW', 'SOW']
            
            results.append({
                'date': date,
                'team': team,
                'is_win': is_win,
                't_pdo': t_pdo,
                'o_pdo': o_pdo,
                'pdo_diff': t_pdo - o_pdo,
                't_hits': t_hits_avg,
                'o_hits': o_hits_avg,
                'hits_diff': t_hits_avg - o_hits_avg
            })
        
        # Update History with THIS game's stats
        # We store what happened in this game to use for NEXT game
        game_stats = {
            'goals_for': row['goals_for'],
            'sog_for': row['sog_for'],
            'saves_for': row['saves_for'],
            'sog_ag': row['sog_ag'],
            'hits_for': row['hits_for']
        }
        
        if team not in team_history: team_history[team] = []
        team_history[team].append(game_stats)

    res_df = pd.DataFrame(results)
    
    print("\n--- ANALYSIS RESULTS ---")
    print(f"Total Games Analyzed: {len(res_df)}")
    
    # 1. PDO Analysis (Luck)
    # Hypothesis: High PDO teams (lucky) will lose to Low PDO teams (unlucky/due)
    # Let's filter for "Unlucky" vs "Lucky" matchups
    
    # Team is "Due" (Low PDO < 980) vs Opponent "Lucky" (High PDO > 1020)
    due_vs_lucky = res_df[ (res_df['t_pdo'] < 980) & (res_df['o_pdo'] > 1020) ]
    win_rate = due_vs_lucky['is_win'].mean()
    print(f"\n[PDO REGRESSION] Low PDO (<980) vs High PDO (>1020):")
    print(f"  Games: {len(due_vs_lucky)}")
    print(f"  Win Rate for Low PDO Team: {win_rate:.2%}")
    
    # 2. Hits Analysis (Physicality)
    # Hypothesis: More physical teams win?
    # Big Hit Advantage (> 10 hits diff)
    bully_games = res_df[ res_df['hits_diff'] > 10 ]
    bully_win_rate = bully_games['is_win'].mean()
    print(f"\n[PHYSICALITY] Hit Advantage (> +10 avg diff):")
    print(f"  Games: {len(bully_games)}")
    print(f"  Win Rate for Physical Team: {bully_win_rate:.2%}")

if __name__ == "__main__":
    analyze_advanced_metrics()
