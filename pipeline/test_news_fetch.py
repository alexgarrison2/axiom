import subprocess
import re
import json

def test_fetch_news():
    print("Fetching DFO News...")
    cmd = [
        'curl', 
        '-A', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.114 Safari/537.36',
        'https://www.dailyfaceoff.com/hockey-player-news'
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        html = result.stdout
        
        match = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html)
        if not match:
            print("No __NEXT_DATA__ found.")
            return
            
        data = json.loads(match.group(1))
        
        # Traverse to find the news array
        # Usually props -> pageProps -> data or similar
        page_props = data.get('props', {}).get('pageProps', {})
        
        # Print keys to help debugging
        print(f"PageProps keys: {list(page_props.keys())}")
        
        if 'data' in page_props:
             print(f"Data type: {type(page_props['data'])}")
             # print(page_props['data']) # Might be huge
             
             # If it's a dict, maybe the list is inside
             if isinstance(page_props['data'], dict):
                 print(f"Data keys: {page_props['data'].keys()}")
                 if 'news' in page_props['data']:
                      news_list = page_props['data']['news']
                 elif 'articles' in page_props['data']:
                      news_list = page_props['data']['articles']
                 elif 'players' in page_props['data']:
                      # Maybe getting players?
                      pass

        # ... (keep older logic if needed)
        
        # New: Search recursively for a list of dicts with 'content' or 'title'
        def find_news_list(obj, depth=0):
            if depth > 3: return None
            if isinstance(obj, dict):
                for k, v in obj.items():
                    if isinstance(v, list) and len(v) > 0 and isinstance(v[0], dict) and ('content' in v[0] or 'title' in v[0] or 'news' in v[0]):
                        return v
                    res = find_news_list(v, depth+1)
                    if res: return res
            return None
            
        if not news_list:
             news_list = find_news_list(page_props)
             
        if news_list:
            print(f"Found news list of length: {len(news_list)}")
            print("First item keys:", news_list[0].keys())
            print(json.dumps(news_list[0], indent=2))
        else:
            print("Could not find news list.")

    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
            
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_fetch_news()
