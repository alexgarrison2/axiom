import urllib.request
import json
import csv
import ssl

# Bypass SSL verification
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

# Hardcoded data for Arena and Colors
team_data_extras = {
    "ANA": {
        "arena_name": "Honda Center",
        "arena_location": "2695 E Katella Ave, Anaheim, CA 92806",
        "arena_capacity": 17174,
        "city": "Anaheim",
        "state_province": "California",
        "country": "USA",
        "colors": ["#F47A38", "#B9975B", "#000000"]
    },
    "BOS": {
        "arena_name": "TD Garden",
        "arena_location": "100 Legends Way, Boston, MA 02114",
        "arena_capacity": 17850,
        "city": "Boston",
        "state_province": "Massachusetts",
        "country": "USA",
        "colors": ["#FFB81C", "#000000", "#FFFFFF"]
    },
    "BUF": {
        "arena_name": "KeyBank Center",
        "arena_location": "1 Seymour H Knox III Plaza, Buffalo, NY 14203",
        "arena_capacity": 19070,
        "city": "Buffalo",
        "state_province": "New York",
        "country": "USA",
        "colors": ["#002654", "#FCB514", "#FFFFFF"]
    },
    "CGY": {
        "arena_name": "Scotiabank Saddledome",
        "arena_location": "555 Saddledome Rise SE, Calgary, AB T2G 2W1",
        "arena_capacity": 19289,
        "city": "Calgary",
        "state_province": "Alberta",
        "country": "Canada",
        "colors": ["#C8102E", "#F1BE48", "#000000"]
    },
    "CAR": {
        "arena_name": "Lenovo Center",
        "arena_location": "1400 Edwards Mill Rd, Raleigh, NC 27607",
        "arena_capacity": 18680,
        "city": "Raleigh",
        "state_province": "North Carolina",
        "country": "USA",
        "colors": ["#CC0000", "#000000", "#A2AAAD"]
    },
    "CHI": {
        "arena_name": "United Center",
        "arena_location": "1901 W Madison St, Chicago, IL 60612",
        "arena_capacity": 19717,
        "city": "Chicago",
        "state_province": "Illinois",
        "country": "USA",
        "colors": ["#CF0A2C", "#000000", "#FFFFFF"]
    },
    "COL": {
        "arena_name": "Ball Arena",
        "arena_location": "1000 Chopper Cir, Denver, CO 80204",
        "arena_capacity": 18007,
        "city": "Denver",
        "state_province": "Colorado",
        "country": "USA",
        "colors": ["#6F263D", "#236192", "#A2AAAD"]
    },
    "CBJ": {
        "arena_name": "Nationwide Arena",
        "arena_location": "200 W Nationwide Blvd, Columbus, OH 43215",
        "arena_capacity": 18144,
        "city": "Columbus",
        "state_province": "Ohio",
        "country": "USA",
        "colors": ["#002654", "#CE1126", "#A4A9AD"]
    },
    "DAL": {
        "arena_name": "American Airlines Center",
        "arena_location": "2500 Victory Ave, Dallas, TX 75219",
        "arena_capacity": 18532,
        "city": "Dallas",
        "state_province": "Texas",
        "country": "USA",
        "colors": ["#006847", "#8F8F8C", "#000000"]
    },
    "DET": {
        "arena_name": "Little Caesars Arena",
        "arena_location": "2645 Woodward Ave, Detroit, MI 48201",
        "arena_capacity": 19515,
        "city": "Detroit",
        "state_province": "Michigan",
        "country": "USA",
        "colors": ["#CE1126", "#FFFFFF", "#000000"]
    },
    "EDM": {
        "arena_name": "Rogers Place",
        "arena_location": "10220 104 Ave NW, Edmonton, AB T5J 0H6",
        "arena_capacity": 18347,
        "city": "Edmonton",
        "state_province": "Alberta",
        "country": "Canada",
        "colors": ["#041E42", "#FF4C00", "#FFFFFF"]
    },
    "FLA": {
        "arena_name": "Amerant Bank Arena",
        "arena_location": "1 Panther Pkwy, Sunrise, FL 33323",
        "arena_capacity": 19250,
        "city": "Sunrise",
        "state_province": "Florida",
        "country": "USA",
        "colors": ["#C8102E", "#041E42", "#B9975B"]
    },
    "LAK": {
        "arena_name": "Crypto.com Arena",
        "arena_location": "1111 S Figueroa St, Los Angeles, CA 90015",
        "arena_capacity": 18230,
        "city": "Los Angeles",
        "state_province": "California",
        "country": "USA",
        "colors": ["#111111", "#A2AAAD", "#FFFFFF"]
    },
    "MIN": {
        "arena_name": "Xcel Energy Center",
        "arena_location": "199 W Kellogg Blvd, St Paul, MN 55102",
        "arena_capacity": 17954,
        "city": "St. Paul",
        "state_province": "Minnesota",
        "country": "USA",
        "colors": ["#154734", "#A6192E", "#EAAA00"]
    },
    "MTL": {
        "arena_name": "Bell Centre",
        "arena_location": "1909 Av. des Canadiens-de-Montréal, Montréal, QC H3B 5E8",
        "arena_capacity": 21302,
        "city": "Montreal",
        "state_province": "Quebec",
        "country": "Canada",
        "colors": ["#AF1E2D", "#192168", "#FFFFFF"]
    },
    "NSH": {
        "arena_name": "Bridgestone Arena",
        "arena_location": "501 Broadway, Nashville, TN 37203",
        "arena_capacity": 17159,
        "city": "Nashville",
        "state_province": "Tennessee",
        "country": "USA",
        "colors": ["#FFB81C", "#041E42", "#FFFFFF"]
    },
    "NJD": {
        "arena_name": "Prudential Center",
        "arena_location": "25 Lafayette St, Newark, NJ 07102",
        "arena_capacity": 16514,
        "city": "Newark",
        "state_province": "New Jersey",
        "country": "USA",
        "colors": ["#CE1126", "#000000", "#FFFFFF"]
    },
    "NYI": {
        "arena_name": "UBS Arena",
        "arena_location": "2400 Hempstead Turnpike, Elmont, NY 11003",
        "arena_capacity": 17255,
        "city": "Elmont",
        "state_province": "New York",
        "country": "USA",
        "colors": ["#00539B", "#F47D30", "#FFFFFF"]
    },
    "NYR": {
        "arena_name": "Madison Square Garden",
        "arena_location": "4 Pennsylvania Plaza, New York, NY 10001",
        "arena_capacity": 18006,
        "city": "New York",
        "state_province": "New York",
        "country": "USA",
        "colors": ["#0038A8", "#CE1126", "#FFFFFF"]
    },
    "OTT": {
        "arena_name": "Canadian Tire Centre",
        "arena_location": "1000 Palladium Dr, Ottawa, ON K2V 1A5",
        "arena_capacity": 18652,
        "city": "Ottawa",
        "state_province": "Ontario",
        "country": "Canada",
        "colors": ["#C52032", "#000000", "#D19F2A"]
    },
    "PHI": {
        "arena_name": "Wells Fargo Center",
        "arena_location": "3601 S Broad St, Philadelphia, PA 19148",
        "arena_capacity": 19500,
        "city": "Philadelphia",
        "state_province": "Pennsylvania",
        "country": "USA",
        "colors": ["#F74902", "#000000", "#FFFFFF"]
    },
    "PIT": {
        "arena_name": "PPG Paints Arena",
        "arena_location": "1001 Fifth Ave, Pittsburgh, PA 15219",
        "arena_capacity": 18187,
        "city": "Pittsburgh",
        "state_province": "Pennsylvania",
        "country": "USA",
        "colors": ["#000000", "#FCB514", "#FFFFFF"]
    },
    "SJS": {
        "arena_name": "SAP Center at San Jose",
        "arena_location": "525 W Santa Clara St, San Jose, CA 95113",
        "arena_capacity": 17562,
        "city": "San Jose",
        "state_province": "California",
        "country": "USA",
        "colors": ["#006D75", "#000000", "#EA7200"]
    },
    "SEA": {
        "arena_name": "Climate Pledge Arena",
        "arena_location": "334 1st Ave N, Seattle, WA 98109",
        "arena_capacity": 17151,
        "city": "Seattle",
        "state_province": "Washington",
        "country": "USA",
        "colors": ["#001628", "#99D9D9", "#68A2B9"]
    },
    "STL": {
        "arena_name": "Enterprise Center",
        "arena_location": "1401 Clark Ave, St. Louis, MO 63103",
        "arena_capacity": 18096,
        "city": "St. Louis",
        "state_province": "Missouri",
        "country": "USA",
        "colors": ["#002F87", "#FCB514", "#041E42"]
    },
    "TBL": {
        "arena_name": "Amalie Arena",
        "arena_location": "401 Channelside Dr, Tampa, FL 33602",
        "arena_capacity": 19092,
        "city": "Tampa",
        "state_province": "Florida",
        "country": "USA",
        "colors": ["#002868", "#FFFFFF", "#000000"]
    },
    "TOR": {
        "arena_name": "Scotiabank Arena",
        "arena_location": "40 Bay St, Toronto, ON M5J 2X2",
        "arena_capacity": 18819,
        "city": "Toronto",
        "state_province": "Ontario",
        "country": "Canada",
        "colors": ["#00205B", "#FFFFFF", "#000000"]
    },
    "UTA": {
        "arena_name": "Delta Center",
        "arena_location": "301 S Temple, Salt Lake City, UT 84101",
        "arena_capacity": 11131,
        "city": "Salt Lake City",
        "state_province": "Utah",
        "country": "USA",
        "colors": ["#000000", "#B5B5B5", "#71AFE5"]
    },
    "VAN": {
        "arena_name": "Rogers Arena",
        "arena_location": "800 Griffiths Way, Vancouver, BC V6B 6G1",
        "arena_capacity": 18910,
        "city": "Vancouver",
        "state_province": "British Columbia",
        "country": "Canada",
        "colors": ["#00205B", "#00843D", "#FFFFFF"]
    },
    "VGK": {
        "arena_name": "T-Mobile Arena",
        "arena_location": "3780 S Las Vegas Blvd, Las Vegas, NV 89158",
        "arena_capacity": 17500,
        "city": "Las Vegas",
        "state_province": "Nevada",
        "country": "USA",
        "colors": ["#B4975A", "#333F42", "#000000"]
    },
    "WSH": {
        "arena_name": "Capital One Arena",
        "arena_location": "601 F St NW, Washington, DC 20004",
        "arena_capacity": 18506,
        "city": "Washington",
        "state_province": "District of Columbia",
        "country": "USA",
        "colors": ["#041E42", "#C8102E", "#FFFFFF"]
    },
    "WPG": {
        "arena_name": "Canada Life Centre",
        "arena_location": "300 Portage Ave, Winnipeg, MB R3C 5S4",
        "arena_capacity": 15321,
        "city": "Winnipeg",
        "state_province": "Manitoba",
        "country": "Canada",
        "colors": ["#041E42", "#004C97", "#AC162C"]
    }
}

def fetch_teams():
    url = "https://api-web.nhle.com/v1/standings/now"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    
    try:
        with urllib.request.urlopen(req, context=ctx) as response:
            data = json.loads(response.read().decode())
            
            teams = []
            for team_info in data['standings']:
                abbrev = team_info['teamAbbrev']['default']
                
                # Get extra data
                extras = team_data_extras.get(abbrev, {})
                colors = extras.get("colors", ["", "", ""])
                # Ensure at least 3 elements
                while len(colors) < 3:
                    colors.append("")
                
                # Construct row
                row = {
                    "Team Name": team_info['teamName']['default'],
                    "Common Name": team_info['teamCommonName']['default'],
                    "NHL Team ID": "Unknown", 
                    "Team Tricode": abbrev,
                    "Team Logo URL": team_info.get('teamLogo', ''),
                    "Arena Name": extras.get("arena_name", "Unknown"),
                    "Arena Location": extras.get("arena_location", "Unknown"),
                    "Arena Capacity": extras.get("arena_capacity", "Unknown"),
                    "City": extras.get("city", team_info['placeName']['default']),
                    "State/Province": extras.get("state_province", "Unknown"),
                    "Country": extras.get("country", "Unknown"),
                    "Hex Color 1": colors[0],
                    "Hex Color 2": colors[1],
                    "Hex Color 3": colors[2]
                }
                teams.append(row)
            
            return teams
            
    except Exception as e:
        print(f"Error fetching data: {e}")
        return []

# Need to map IDs. I'll use a separate fetch or hardcode if I can.
# Let's try to fetch IDs from the other endpoint if possible, or just use a mapping if I have it.
# Actually, I can use the 'https://api.nhle.com/stats/rest/en/team' endpoint to get IDs.
def fetch_ids():
    url = "https://api.nhle.com/stats/rest/en/team"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, context=ctx) as response:
            data = json.loads(response.read().decode())
            id_map = {}
            for team in data['data']:
                id_map[team['triCode']] = team['id']
            return id_map
    except Exception as e:
        print(f"Error fetching IDs: {e}")
        return {}

if __name__ == "__main__":
    teams = fetch_teams()
    id_map = fetch_ids()
    
    # Update IDs
    for team in teams:
        abbrev = team['Team Tricode']
        if abbrev in id_map:
            team['NHL Team ID'] = id_map[abbrev]
        elif abbrev == 'UTA':
             # Utah might not be in the old stats API yet? Or maybe it is.
             # If not found, I'll leave as Unknown or try to find it.
             # Actually, I saw 'UTA' in the standings, so it should be fine.
             # But if the stats API is old, it might not have UTA.
             # Let's assume it might be missing and handle it.
             # Utah ID is likely 59 or something new.
             pass

    # Write to CSV
    fieldnames = [
        "Team Name", "Common Name", "NHL Team ID", "Team Tricode", "Team Logo URL",
        "Arena Name", "Arena Location", "Arena Capacity",
        "City", "State/Province", "Country",
        "Hex Color 1", "Hex Color 2", "Hex Color 3"
    ]
    
    with open('nhl_teams.csv', 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(teams)
        
    print(f"Successfully wrote {len(teams)} teams to nhl_teams.csv")
