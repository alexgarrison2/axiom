
import csv
import os

CSV_PATH = 'public/data/gamestats.csv'

def fix_csv():
    if not os.path.exists(CSV_PATH):
        print(f"File not found: {CSV_PATH}")
        return

    rows = []
    with open(CSV_PATH, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        for row in reader:
            try:
                saves_for = int(row['saves_for'])
                sog_ag = int(row['sog_ag'])
                
                saves_against = int(row['saves_against'])
                sog_for = int(row['sog_for'])
                
                # Recalculate SV% (Saves / Shots Faced)
                new_sv_pct = round(saves_for / sog_ag, 3) if sog_ag > 0 else 0.0
                new_sv_pct_ag = round(saves_against / sog_for, 3) if sog_for > 0 else 0.0
                
                row['save_percentage'] = new_sv_pct
                row['save_percentage_against'] = new_sv_pct_ag
                
            except (ValueError, KeyError) as e:
                print(f"Error processing row {row.get('game_id', 'unknown')}: {e}")
            
            rows.append(row)

    # Write back
    with open(CSV_PATH, 'w', encoding='utf-8', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    
    print(f"Successfully updated {len(rows)} rows in {CSV_PATH}")

if __name__ == "__main__":
    fix_csv()
