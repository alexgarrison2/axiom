import json
import subprocess
import re
import datetime

def test_fetch_news_fields():
    print("Fetching Daily Faceoff Player News...")
    cmd = [
        'curl', 
        '-A', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36',
        'https://www.dailyfaceoff.com/hockey-player-news'
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        html = result.stdout
        
        match = re.search(r'<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.DOTALL)
        if not match:
            print("Could not find __NEXT_DATA__ in HTML.")
            return
            
        data = json.loads(match.group(1))
        news_items = data.get('props', {}).get('pageProps', {}).get('data', {}).get('data', [])
        
        if news_items:
            print(f"Total News Items: {len(news_items)}")
            first_item = news_items[0]
            print("First item full data:")
            print(json.dumps(first_item, indent=2))
        else:
            print("No news items found.")
            
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_fetch_news_fields()
