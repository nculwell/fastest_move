#!/usr/bin/python3

import json, sys

GMFILE = "gamemaster.json"

with open(GMFILE) as f:
    gm = json.load(f)

moves = { move["moveId"]: move for move in gm["moves"] if not move.get("unlisted") == True }
pokemon = {
        mon["speciesId"]: mon
        for mon in gm["pokemon"]
        if (not "tags" in mon)
            or ("shadow" not in mon["tags"] 
                and "mega" not in mon["tags"])
}

if False:
    print(gm.keys(), file=sys.stderr)
    print(gm["moves"][0].keys(), file=sys.stderr)

    #print(moves.keys(), file=sys.stderr)
    print(moves["THUNDER_SHOCK"], file=sys.stderr)
    print(moves["RETURN"], file=sys.stderr)
    print(gm["pokemon"][0], file=sys.stderr)
    gn = [ mon for mon in gm["pokemon"] if mon["speciesId"].startswith("greninja") ]
    for x in gn: print(x, file=sys.stderr)

    #print([ mon for mon in gm["pokemon"] if "family" in mon and mon["family"]["id"] == "FAMILY_RATTATA" ], file=sys.stderr)

mon_fastest_movesets = []

for mon in pokemon.values():
    if mon["speciesId"] == "smeargle":
        continue
    tags = mon.get("tags")
    if tags:
        if "shadow" in tags or "mega" in tags:
            continue
    fms = [ moves[m] for m in mon["fastMoves"] if m in moves  and moves[m]["energyGain"]>0 ]
    cms = [ moves[m] for m in mon["chargedMoves"] if m in moves ]
    best_movesets = None
    best_turns = 100
    for fm in fms:
        for cm in cms:
            try:
                turns = (cm["energy"] / fm["energyGain"]) * fm["turns"]
            except ZeroDivisionError:
                print("ZeroDivisionError for fm:", fm, file=sys.stderr)
                sys.exit(1)
            if turns < best_turns:
                best_movesets = []
                best_turns = turns
            if turns <= best_turns:
                power = (fm["power"] * turns + cm["power"]) / (turns + 1)
                attack = mon["baseStats"]["atk"]
                best_movesets.append( (fm, cm, power * attack) )
    if best_movesets:
        for ms in best_movesets:
            mon_fastest_movesets.append({
                "speciesId": mon["speciesId"],
                "fm": ms[0],
                "cm": ms[1],
                "damage": ms[2],
                "turns": best_turns,
                })

def sort_key(moveset):
    return "%05.2f--%d--%s" % (moveset["turns"], 1000000-moveset["damage"], moveset["speciesId"])
mon_fastest_movesets.sort(key=sort_key)

count = 0
prev_turns = 0
for ms in mon_fastest_movesets:
    count += 1
    turns = ms["turns"]
    if turns > 10:
        break
    turns = round(turns, 2)
    if turns != prev_turns:
        print()
        print("TURNS:", turns)
        print()
        prev_turns = turns
    print(ms["speciesId"],
          ms["fm"]["moveId"],
          ms["cm"]["moveId"],
          "; Turns:", turns,
          "; Damage:", int(ms["damage"]),
          )


