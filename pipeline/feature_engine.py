
import os
import json
import math
import pandas as pd
import numpy as np
from glob import glob

RAW_DIR = "data/raw_pbp"
OUTPUT_FILE = "data/training_data_advanced_shots.csv"

def get_coords(play):
    """Safely extract x,y from play details"""
    details = play.get('details', {})
    if 'xCoord' in details and 'yCoord' in details:
        return float(details['xCoord']), float(details['yCoord'])
    return None

def calculate_angle(x, y):
    """Calculate angle to net (approx simple version, treating net as center of end line)"""
    # Net is approx at x=89, y=0.
    # We normalized x to be positive (0..100) for this? 
    # Or we handle both ends.
    # Simple absolute angle from center line:
    if x == 0: return 0
    return math.degrees(math.atan2(y, 89 - abs(x)))

def process_game(file_path):
    with open(file_path, 'r') as f:
        data = json.load(f)
        
    game_id = data.get('id')
    plays = data.get('plays', [])
    
    shot_events = []
    
    last_event = None
    last_period = None
    
    # Sort just in case? Usually sorted.
    
    for play in plays:
        period = play.get('periodDescriptor', {}).get('number')
        type_key = play.get('typeDescKey')
        
        # Reset on period change
        if period != last_period:
            last_event = None
            last_period = period
            
        coords = get_coords(play)
        
        # We only care about SHOT or GOAL for the dataset rows
        is_shot_event = type_key in ['shot-on-goal', 'goal', 'missed-shot', 'blocked-shot']
        
        if is_shot_event and coords:
            # Calculate Features based on Last Event
            feat_time_since = 0
            feat_dist = 0
            feat_speed = 0
            feat_is_rebound = 0
            feat_royal_road = 0
            feat_angle_change = 0
            
            x, y = coords
            
            if last_event and last_event.get('coords'):
                lx, ly = last_event['coords']
                l_time = last_event['time_seconds'] # Need to parse time
                
                # Parse current time
                time_in_period = play.get('timeInPeriod', '00:00')
                m, s = map(int, time_in_period.split(':'))
                curr_seconds = m * 60 + s
                
                dt = curr_seconds - l_time
                dx = x - lx
                dy = y - ly
                dist = math.sqrt(dx*dx + dy*dy)
                
                feat_time_since = dt
                feat_dist = dist
                if dt > 0:
                    feat_speed = dist / dt
                
                # Rebound logic
                if (dt < 3.0) and (last_event['type'] in ['shot-on-goal', 'goal']):
                    feat_is_rebound = 1
                    
                # Royal Road: Crossed center line (y=0)
                # Check sign change
                if (ly > 0 and y < 0) or (ly < 0 and y > 0):
                    feat_royal_road = 1
                    
            # Basic Features
            dist_to_net = math.sqrt((89 - abs(x))**2 + y**2)
            angle = calculate_angle(x, y)
            
            # Target
            is_goal = 1 if type_key == 'goal' else 0
            
            # Valid Team ID?
            event_team = play.get('details', {}).get('eventOwnerTeamId')
            
            row = {
                'game_id': game_id,
                'team_id': event_team,
                'period': period,
                'time_seconds': curr_seconds if 'curr_seconds' in locals() else 0, # Careful if last_event was None
                'event_type': type_key,
                'x': x,
                'y': y,
                'dist_to_net': dist_to_net,
                'angle': angle,
                'last_event_type': last_event['type'] if last_event else 'NONE',
                'time_since_last': feat_time_since,
                'dist_from_last': feat_dist,
                'implied_speed': feat_speed,
                'is_rebound': feat_is_rebound,
                'royal_road': feat_royal_road,
                'is_goal': is_goal
            }
            shot_events.append(row)
            
        # Update Last Event (We track ALL events as context, even if they aren't shots)
        if coords: # Only track if it had location
            # Parse time again if needed
            time_in_period = play.get('timeInPeriod', '00:00')
            m, s = map(int, time_in_period.split(':'))
            curr_seconds = m * 60 + s
            
            last_event = {
                'type': type_key,
                'coords': coords,
                'time_seconds': curr_seconds
            }
            
    return shot_events

def main():
    all_shots = []
    files = glob(os.path.join(RAW_DIR, "*.json"))
    print(f"Processing {len(files)} games...")
    
    for f in files:
        try:
            shots = process_game(f)
            all_shots.extend(shots)
        except Exception as e:
            print(f"Error processing {f}: {e}")
            
    df = pd.DataFrame(all_shots)
    print(f"Generated {len(df)} shot events.")
    
    # Filter insane speeds (bad data)
    # 50 ft/s is approx 34 mph, very fast but possible for puck. Player max is ~25mph.
    # Implied speed includes puck speed if last event was pass.
    # Let's clip at 100 to remove teleportation bugs.
    df = df[df['implied_speed'] < 100]
    
    df.to_csv(OUTPUT_FILE, index=False)
    print(f"Saved to {OUTPUT_FILE}")

if __name__ == "__main__":
    main()
