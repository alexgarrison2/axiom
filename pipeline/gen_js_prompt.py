
import csv

TEAMS = ["BOS", "DAL", "FLA", "LAK", "TBL", "UTA"]
SEASONS = [2025, 2026]
MAPPING = {
    "VGK": "VEG",
    "UTA": "UTA", 
}

# The JS to inject
JS_CODE = """
(function() {
    var rows = document.querySelectorAll('#games tbody tr:not(.thead)');
    var totalAtt = 0;
    var count = 0;
    var log = [];
    
    rows.forEach(function(row) {
        var dateCell = row.querySelector('[data-stat="date_game"]');
        var locCell = row.querySelector('[data-stat="game_location"]');
        var attCell = row.querySelector('[data-stat="attendance"]');
        
        if (!dateCell || !attCell) return;
        
        var dateStr = dateCell.innerText.trim();
        var dateObj = new Date(dateStr);
        // check valid date
        if (isNaN(dateObj.getTime())) return;
        
        // Day of week: 6 is Saturday
        // Note: JS Date(dateStr) treats string as UTC or local depending on browser? 
        // "2024-10-12" usually parses as UTC midnight.
        // Let's use getUTCDay() just to be safe if input is YYYY-MM-DD
        // Actually, let's verify. '2024-10-12' is Saturday.
        // new Date('2024-10-12').getUTCDay() -> 6?
        
        var day = dateObj.getUTCDay(); // 0=Sun, 6=Sat
        // Wait, standard YYYY-MM-DD parsing in JS:
        // new Date("2024-10-12") -> Fri Oct 11 2024 17:00:00 GMT-0700 (PDT) in some browsers?
        // It's inconsistent. 
        // Better to parse manually.
        var parts = dateStr.split('-');
        if(parts.length !== 3) return;
        // manually construct date to avoid timezone issues. 
        // We want the day of week of that date.
        // Date(year, monthIndex, day)
        dateObj = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]));
        day = dateObj.getDay(); 
        
        var isHome = (locCell && locCell.innerText.trim() === "");
        var attText = attCell.innerText.trim().replace(/,/g, '');
        var att = parseInt(attText);
        
        if (day === 6 && isHome && !isNaN(att) && att > 0) {
            totalAtt += att;
            count++;
            log.push(dateStr + ": " + att);
        }
    });
    
    return JSON.stringify({
        team: document.title.split(' ')[0], 
        season: window.location.href.split('/')[5] || 'unknown',
        total_att: totalAtt,
        games_count: count,
        details: log
    });
})();
"""

clean_js = JS_CODE.replace('\n', ' ').replace('    ', ' ').strip()

print("Visit these URLs sequentially. For EACH URL:")
print("1. Navigate to page.")
print("2. Execute this Javascript to get the stats:")
print(f"   `{clean_js}`")
print("3. Print the Result JSON.")
print("")
print("URLs:")

for s in SEASONS:
    for t in TEAMS:
        code = MAPPING.get(t, t)
        url = f"https://www.hockey-reference.com/teams/{code}/{s}_games.html"
        print(f"- {url}")
