
from nhlpy import NHLClient
import json

client = NHLClient()
# Fetch Oilers Team Speed
data = client.edge.team_skating_speed_detail(team_id='22', season='20232024')
print(json.dumps(data, indent=2))
