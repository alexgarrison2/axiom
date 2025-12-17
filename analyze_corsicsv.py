import pandas as pd

# Load the CSV
df = pd.read_csv('data/gamestats.csv')

# Filter for Colorado Avalanche
# Check if team name is 'Avalanche' or 'Colorado Avalanche'
team_name = 'Avalanche'
avs_games = df[df['team'] == team_name]

print(f"Number of games found for {team_name}: {len(avs_games)}")

if len(avs_games) > 0:
    # Calculate sum and mean of attempts_for
    total_attempts = avs_games['attempts_for'].sum()
    mean_attempts = avs_games['attempts_for'].mean()
    
    print(f"Total Attempts For: {total_attempts}")
    print(f"Average Attempts For: {mean_attempts}")
    
    # Also check if there are any outliers
    print("\nTop 5 High Attempts Games:")
    print(avs_games[['game_date', 'opponent', 'attempts_for']].sort_values(by='attempts_for', ascending=False).head())

    # Check for duplicates (same game_id)
    duplicates = avs_games[avs_games.duplicated('game_id')]
    print(f"\nDuplicate Game IDs for {team_name}: {len(duplicates)}")
    if len(duplicates) > 0:
        print(duplicates)

else:
    print(f"No games found for {team_name}. Checking available teams:")
    print(df['team'].unique())
