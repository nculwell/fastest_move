#!/usr/bin/python3

import json, sys

TURNS_THRESHOLD = 10

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

# Here we filter out any Pokemon that we want to exclude.
pokemon = {
        mon["speciesId"]: mon

        for mon in gm["pokemon"]

        if mon["released"]
            and ((not "tags" in mon)
                or ("shadow" not in mon["tags"] 
                    and "mega" not in mon["tags"]))
}

# These print statements are exploratory and should be turned off "in production"
if False:
    print([ mon for mon in gm["pokemon"] if mon["speciesId"].startswith("maushold") ], file=sys.stderr)

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

def do_move_cycle(fm, fm_stab, cm, cm_stab, residual_energy):
    turns = 0
    energy = residual_energy
    damage = 0
    # Apply fast moves until enough energy is generated to fire a charged move
    while energy < cm["energy"]:
        turns += fm["turns"]
        energy += fm["energyGain"]
        damage += fm["power"] * fm_stab
    # Apply the charged move
    damage += cm["power"] * cm_stab
    turns += 1
    energy -= cm["energy"]
    return (turns, damage, energy)

def stab(mon, move):
    if move["type"] in mon["types"]:
        return 1.2
    else:
        return 1.0

def do_move_cycles(mon, fm, cm, cycle_count):
    fm_stab = stab(mon, fm)
    cm_stab = stab(mon, cm)
    turns = 0
    damage = 0
    residual_energy = 0
    for i in range(cycle_count):
        (t, d, e) = do_move_cycle(fm, fm_stab, cm, cm_stab, residual_energy)
        turns += t
        damage += d
        residual_energy = e
    return (turns, damage)

def calc_damage(mon, fm, cm):
    # We calculate damage across three charged moves. This allows us to account
    # for different move counts due to residual energy left over from the first
    # move.
    (turns, damage) = do_move_cycles(mon, fm, cm, 3)
    # We calculate damage per turn, then scale it by the attacking mon's attack
    # stat.
    attack = mon["baseStats"]["atk"]
    return attack * damage / turns

for mon in pokemon.values():
    if mon["speciesId"] == "smeargle":
        continue
    tags = mon.get("tags")
    if tags:
        if "shadow" in tags or "mega" in tags:
            continue
    fast_moves = [ moves[m] for m in mon["fastMoves"] if m in moves  and moves[m]["energyGain"]>0 ]
    chrg_moves = [ moves[m] for m in mon["chargedMoves"] if m in moves ]
    eliteMoves = mon.get("eliteMoves") or []
    movesets = []
    for fm in fast_moves:
        for cm in chrg_moves:
            try:
                turns = (cm["energy"] / fm["energyGain"]) * fm["turns"]
            except ZeroDivisionError:
                # We don't expect this to happen, but if it does we want to see
                # which pokemon triggered it so we can fix the problem.
                print("ZeroDivisionError for fm:", fm, file=sys.stderr)
                sys.exit(1)
            if turns <= TURNS_THRESHOLD:
                damage = calc_damage(mon, fm, cm)
                movesets.append({
                    "mon": mon,
                    "turns": turns,
                    "fm": fm,
                    "cm": cm,
                    "fm_elite": fm["moveId"] in eliteMoves,
                    "cm_elite": cm["moveId"] in eliteMoves,
                    "damage": damage,
                    })
    if len(movesets) == 0:
        continue
    movesets.sort(key = lambda ms: ms["turns"])
    best_turns = movesets[0]["turns"]
    for ms in movesets:
        ms["best"] = (ms["turns"] == best_turns)
    mon_fastest_movesets.extend(movesets)

def sort_key(moveset):
    return (moveset["turns"], -moveset["damage"], moveset["mon"]["speciesId"])
    #return "%05.2f--%d--%s" % (moveset["turns"], 1000000-moveset["damage"], moveset["mon"]["speciesId"])
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
    print("%s" % ms["mon"]["speciesName"], end='')
    if not ms["best"]:
        print("*", end='')
    print(": %s%s [%s] / %s%s [%s];" % (
              '*' if ms["fm_elite"] else '',
              ms["fm"]["name"],
              fmt,
              '*' if ms["cm_elite"] else '',
              ms["cm"]["name"],
              cmt),
          "Turns: %s;" % str(turns),
          "Damage: %d" % int(ms["damage"]),
          end=''
          )
    if fmt == cmt:
        print(" (both %s)" % ms["fm"]["type"], end='')
    print()


