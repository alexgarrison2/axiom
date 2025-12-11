import urllib.request
import json
import datetime
import ssl
from datetime import timedelta
import pandas as pd

# Schedule Cache to avoid hitting API repeatedly
SCHEDULE_CACHE = {}

def get_schedule_context(team_abbrev, game_date_str):
    """
    Fetches the last 7 days of schedule for the team to determine:
    - Days since last game
    - Games in last 4 days
    - Games in last 6 days
    - Games in last 8 days
    - Travel status (Home vs Road)
    """
    
    # Range: Look back 9 days to be safe
    game_date = datetime.datetime.strptime(game_date_str, "%Y-%m-%d").date()
    start_date = game_date - timedelta(days=9)
    end_date = game_date # Up to today
    
    # Use cached season schedule if possible, otherwise fetch range
    # For MVP simplicity, we'll fetch the specific week range matching this
    
    # To avoid N+1 API calls, we ideally fetch the whole season once.
    # But for now, let's fetch the relevant week(s) 
    
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    url = f"https://api-web.nhle.com/v1/club-schedule/{team_abbrev}/week/now" 
    # Note: club-schedule/MIN/week/now gives current week. We might need previous weeks.
    # Better to just deduce from a pre-loaded full season CSV if available, or fetch specific dates.
    # Reverting to v1/schedule/{date} is heavy.
    
    # Strategy: Assume "predict_games.py" creates a context where it knows the previous games.
    # If not, we will default to a neutral rest score for V1 to avoid API rate limits.
    
    # ACTUALLY: Let's assume we can pass in the "previous_game_date" if we have it from our gamestats.
    # If not, let's build a separate "fetch_schedule_history()" helper.
    pass

class GasCalculator:
    def __init__(self, gamestats_df):
        self.df = gamestats_df.copy() # Work on a copy
        # Ensure date column is datetime immediately
        if not self.df.empty and 'game_date' in self.df.columns:
            if not pd.api.types.is_datetime64_any_dtype(self.df['game_date']):
                self.df['game_date'] = pd.to_datetime(self.df['game_date'])
        
    def calculate_gas(self, team, game_date, opponent, is_home):
        """
        Calculates the Gas Score (0-100) for a team on a specific date.
        Returns: (score, breakdown_list)
        """
        if self.df.empty:
            return 65, ["No Data (Default: 65)"]
            
        # User Feedback: Base should decay based on games played (82 - GP) * 1.25
        games_played = self._get_season_games_count(team, game_date)
        base_gas = max(10, (82 - games_played) * 1.25) # Floor at 10 to avoid negative base
        
        breakdown = [f"Base (GP {games_played}): {base_gas}"]
        
        # 1. Schedule & Rest
        rest_score, rest_reasons = self._calculate_rest_score(team, game_date, is_home)
        breakdown.extend(rest_reasons)
        
        # 2. Recent Form
        form_score, form_reasons = self._calculate_form_score(team, game_date)
        breakdown.extend(form_reasons)
        
        # 3. Context
        context_score = 0
        
        total_gas = base_gas + rest_score + form_score + context_score
        final_score = int(max(0, min(100, round(total_gas))))
        
        return final_score, breakdown

    def _get_team_history(self, team, game_date, n_games=10):
        """Retrieves the last N games for a team before the target date."""
        target_dt = pd.to_datetime(game_date)
        
        # Ensure date column is datetime
        if not pd.api.types.is_datetime64_any_dtype(self.df['game_date']):
            self.df['game_date'] = pd.to_datetime(self.df['game_date'])
            
        team_games = self.df[
            (self.df['team'] == team) & 
            (self.df['game_date'] < target_dt)
        ].sort_values('game_date', ascending=False).head(n_games)
        
        return team_games

    def _get_season_games_count(self, team, game_date):
        """Counts how many games the team has played this season prior to game_date."""
        target_dt = pd.to_datetime(game_date)
        
        # Filter for this team's games before the target date
        # Assuming df contains only current season (or we should filter by season start if mixed)
        # For now, simplistic approach: all games in DF before date
        season_games = self.df[
            (self.df['team'] == team) & 
            (self.df['game_date'] < target_dt)
        ]
        return len(season_games)

    def _calculate_rest_score(self, team, game_date, is_home):
        """
        Determines rest days and schedule density.
        Returns: (score, list_of_reasons)
        """
        team_games = self._get_team_history(team, game_date, n_games=6)
        reasons = []
        
        if team_games.empty:
            return 10, ["Fresh Start: +10"]
            
        score = 0
        target_dt = pd.to_datetime(game_date)
        last_game_dt = team_games.iloc[0]['game_date']
        
        days_rest = (target_dt - last_game_dt).days - 1
        
        # --- Rest Bonuses (Positive Only) ---
        if days_rest >= 3: 
            score += 15 # Changed from 10 to 15 per user request
            reasons.append(f"Rest ({days_rest}d): +15")
        elif days_rest == 2: 
            score += 5
            reasons.append(f"Rest (2d): +5")
        
        # --- Schedule Density Penalties (Negative) ---
        # User Logic: Do not stack penalties. Use the SINGLE highest penalty.
        # Candidates: B2B, 3in4, 4in6, 5in8
        
        penalties = [] # List of (value_negative, reason_string)

        # 1. Back-to-Back
        if days_rest <= 0: 
            penalties.append((-10, "Back-to-Back: -10")) # Modified from -15 to -10
            
        # 2. 3-in-4 Nights
        if len(team_games) >= 2:
            second_last = team_games.iloc[1]['game_date']
            days_span_3in4 = (target_dt - second_last).days + 1
            if days_span_3in4 <= 4:
                penalties.append((-20, "3-in-4 Nights: -20"))

        # 3. 4-in-6 Nights
        if len(team_games) >= 3:
            third_last = team_games.iloc[2]['game_date']
            days_span_4in6 = (target_dt - third_last).days + 1
            if days_span_4in6 <= 6:
                penalties.append((-15, "4-in-6 Nights: -15")) # Modified from -20 to -15

        # 4. 5-in-8 Nights
        if len(team_games) >= 4:
            fourth_last = team_games.iloc[3]['game_date']
            days_span_5in8 = (target_dt - fourth_last).days + 1 # Fixed typo: was third_last
            if days_span_5in8 <= 8:
                penalties.append((-15, "5-in-8 Nights: -15")) # Modified from -30 to -15

        # Apply Max Penalty
        if penalties:
            # Sort by value (ascending, so most negative first)
            penalties.sort(key=lambda x: x[0])
            max_penalty = penalties[0]
            score += max_penalty[0]
            reasons.append(max_penalty[1]) 
            # Note: We only append the reason for the PRIMARY penalty to avoid clutter,
            # but user might want to know *all* factors even if they don't stack.
            # However, "Do not stack... use highest" usually implies the others are subsumed.
            
        return score, reasons

        # --- Travel Fatigue ---
        if is_home:
            score += 5
            reasons.append("Home: +5")
        else:
            road_streak = 0
            for _, row in team_games.iterrows():
                if row['home_away'] == 'Away':
                    road_streak += 1
                else:
                    break
            
            if road_streak == 0: 
                score -= 5
                reasons.append("Travel: -5")
            elif road_streak >= 3: 
                score -= 10
                reasons.append(f"Road Trip ({road_streak}+ gms): -10")
            
        return score, reasons

    def _calculate_form_score(self, team, game_date):
        team_games = self._get_team_history(team, game_date, n_games=8)
        reasons = []
        
        if team_games.empty:
            return 0, []
            
        score = 0
        
        # --- Winning/Losing Streaks ---
        streak_type = None
        streak_count = 0
        
        for _, row in team_games.iterrows():
            outcome = row['result']
            is_win = 'W' in str(outcome)
            current_type = 'W' if is_win else 'L'
            
            if streak_type is None:
                streak_type = current_type
                streak_count = 1
            elif streak_type == current_type:
                streak_count += 1
            else:
                break
                
        if streak_type == 'W':
            streak_bonus = min(20, streak_count * 2)
            score += streak_bonus
            if streak_bonus > 0:
                reasons.append(f"Win Streak ({streak_count}): +{streak_bonus}")
        elif streak_type == 'L':
            streak_penalty = min(30, streak_count * 4)
            score -= streak_penalty
            if streak_penalty > 0:
                reasons.append(f"Lost {streak_count} Straight: -{streak_penalty}")
            
        # --- Defensive Grind (GA) ---
        avg_ga = team_games.head(5)['goals_ag'].mean()
        if avg_ga >= 4.0: 
            score -= 10
            reasons.append(f"Leaky D ({avg_ga:.1f} GA): -10")
        elif avg_ga <= 2.0: 
            score += 5
            reasons.append(f"Solid D ({avg_ga:.1f} GA): +5")
        
        return score, reasons
