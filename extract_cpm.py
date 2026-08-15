#!/usr/bin/python3

import urllib.request, json

GAME_MASTER_URL = "https://raw.githubusercontent.com/PokeMiners/game_masters/refs/heads/master/latest/latest.json"

with urllib.request.urlopen(GAME_MASTER_URL) as response:
  gm = json.loads(response.read())

player_level_settings = [ t for t in gm if t["templateId"] == 'PLAYER_LEVEL_SETTINGS' ][0]

print(player_level_settings["data"])
cpm_list = player_level_settings["data"]['playerLevel']["cpMultiplier"]

level = 0
for cpm in cpm_list:
    level += 1
    print(level, cpm)

