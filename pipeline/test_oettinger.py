import fetch_goalie_history

def test():
    print("Fetching Oettinger vs MIN...")
    # Dallas Stars (DAL) vs Minnesota Wild (MIN)
    stats = fetch_goalie_history.fetch_goalie_vs_opponent("Jake Oettinger", "DAL", "MIN")
    
    if stats:
        print("Stats found:", stats)
    else:
        print("No stats found.")

if __name__ == "__main__":
    test()
