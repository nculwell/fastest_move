#!/usr/bin/python3

import json, sys

GMFILE = "gamemaster.json"

TYPE_ABBR = {
        'normal': 'nrm',
        'fighting': 'fig',
        'flying': 'fly',
        'poison': 'poi',
        'ground': 'grd',
        'rock': 'rck',
        'bug': 'bug',
        'ghost': 'gho',
        'steel': 'stl',
        'fire': 'fir',
        'water': 'wtr',
        'grass': 'grs',
        'electric': 'elc',
        'psychic': 'psy',
        'ice': 'ice',
        'dragon': 'drg',
        'dark': 'drk',
        'fairy': 'fai',
        }

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

if True:
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
                fm_power = fm["power"] * turns / (turns + 1)
                cm_power = cm["power"] / (turns + 1)
                if fm["type"] in mon["types"]: fm_power *= 1.25 # STAB
                if cm["type"] in mon["types"]: cm_power *= 1.25 # STAB
                power = fm_power + cm_power
                attack = mon["baseStats"]["atk"]
                best_movesets.append( (fm, cm, power * attack) )
    if best_movesets:
        for ms in best_movesets:
            mon_fastest_movesets.append({
                "mon": mon,
                "fm": ms[0],
                "cm": ms[1],
                "damage": ms[2],
                "turns": best_turns,
                })

def sort_key(moveset):
    return "%05.2f--%d--%s" % (moveset["turns"], 1000000-moveset["damage"], moveset["mon"]["speciesId"])
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
    (fmt, cmt) = ( TYPE_ABBR[ms[x]["type"]] for x in ["fm","cm"] )
    print("%s:" % ms["mon"]["speciesName"],
          "%s [%s] / %s [%s];" % (
              ms["fm"]["name"], fmt,
              ms["cm"]["name"], cmt),
          "Turns: %s;" % str(turns),
          "Damage: %d" % int(ms["damage"]),
          end=''
          )
    if fmt == cmt:
        print(" [%s]" % fmt, end='')
    print()


