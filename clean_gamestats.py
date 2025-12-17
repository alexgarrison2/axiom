
import pandas as pd
import os

FILE_PATH = "data/gamestats.csv"
BACKUP_PATH = "data/gamestats.csv.bak_dirty"

if os.path.exists(FILE_PATH):
    # Backup first
    os.rename(FILE_PATH, BACKUP_PATH)
    print(f"Backed up to {BACKUP_PATH}")

    # Read and clean
    # Shot rows have empty 'team' column.
    
    # We need to handle potential mixed types or parsing errors, so read as string first for safety or just reliance on pandas
    df = pd.read_csv(BACKUP_PATH, dtype=str)
    
    initial_count = len(df)
    print(f"Read {initial_count} rows.")
    
    # Filter: 'team' column must not be NaN or empty string
    clean_df = df[df['team'].notna() & (df['team'] != '')]
    
    cleaned_count = len(clean_df)
    print(f"Filtered to {cleaned_count} rows. Removed {initial_count - cleaned_count} rows.")
    
    if cleaned_count > 0:
        clean_df.to_csv(FILE_PATH, index=False)
        print(f"Wrote cleaned data to {FILE_PATH}")
    else:
        print("Error: Cleaned dataframe is empty! Restoring backup.")
        os.rename(BACKUP_PATH, FILE_PATH)
else:
    print(f"File {FILE_PATH} not found.")
