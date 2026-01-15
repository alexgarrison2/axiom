
import csv

def check_csv_headers():
    with open('public/data/gamestats.csv', 'r') as f:
        reader = csv.reader(f)
        headers = next(reader)
        print(f"Headers: {headers}")
        
        row1 = next(reader)
        print(f"Row 1: {row1}")
        
        # Check for 'result' in headers
        try:
            res_idx = headers.index('result')
            print(f"'result' found at index {res_idx}")
            print(f"Row 1 value at {res_idx}: '{row1[res_idx]}'")
            
            # Check hex of header to detect invisible chars
            print(f"Hex of 'result' header: {'result'.encode('utf-8').hex()}")
            real_header = headers[res_idx]
            print(f"Hex of actual header '{real_header}': {real_header.encode('utf-8').hex()}")
            
        except ValueError:
            print("'result' NOT found in headers!")
            # Print all headers with their hex
            for h in headers:
                print(f"Header: '{h}' Hex: {h.encode('utf-8').hex()}")

if __name__ == "__main__":
    check_csv_headers()
