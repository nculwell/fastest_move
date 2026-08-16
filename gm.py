#!/usr/bin/python3

import json, sys
from math import floor

TURNS_THRESHOLD = 10

EXCLUDED = ["smeargle", "pikachu"]

GMFILE = "gamemaster.json"
CPMFILE = "cpm.txt"

# The reference matchup we score every moveset against. Attacker and defender are
# both level 40 with IV 15, so the CPM cancels out of the attack/defense ratio and
# the ranking doesn't depend on the level we picked; the constants are here so the
# assumption is visible and easy to change.
ATTACKER_LEVEL = 40
DEFENDER_LEVEL = 40
DEFENDER_BASE_DEF = 100
IV = 15

# The trainer-battle damage bonus, part of the damage formula.
PVP_BONUS = 1.3

# A Protect Shield reduces a charged move to 1 damage, it doesn't nullify it.
SHIELDED_DAMAGE = 1

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

# The CP multiplier for each level, one "<level> <cpm>" pair per line.
with open(CPMFILE) as f:
    cpm = { int(level): float(mult) for level, mult in (line.split() for line in f) }

defense = (DEFENDER_BASE_DEF + IV) * cpm[DEFENDER_LEVEL]

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

EXCLUDED_DEX_NUMBERS = [
        pokemon[excl_id]["dex"]
        for excl_id in EXCLUDED
        ]

# These print statements are exploratory and should be turned off "in production"
if True:
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

def move_damage(move, move_stab, attack):
    # The game's damage formula. Type effectiveness is deliberately left out: it's
    # situational, and we show the move types so players can account for it. Note
    # that the flooring and the +1 happen per hit, so this is not a simple scaling
    # of the move's power -- low-power fast moves gain proportionally more.
    return floor(0.5 * PVP_BONUS * move["power"] * move_stab * attack / defense) + 1

def do_move_cycle(fm, fm_stab, cm, cm_stab, attack, residual_energy, block):
    turns = 0
    energy = residual_energy
    damage = 0
    # Apply fast moves until enough energy is generated to fire a charged move
    while energy < cm["energy"]:
        turns += fm["turns"]
        energy += fm["energyGain"]
        damage += move_damage(fm, fm_stab, attack)
    # Apply the charged move. A blocked move still costs its energy and its turn.
    if block:
        damage += SHIELDED_DAMAGE
    else:
        damage += move_damage(cm, cm_stab, attack)
    turns += 1
    energy -= cm["energy"]
    return (turns, damage, energy)

def stab(mon, move):
    if move["type"] in mon["types"]:
        return 1.2
    else:
        return 1.0

def do_move_cycles(mon, fm, cm, cycle_count, block):
    fm_stab = stab(mon, fm)
    cm_stab = stab(mon, cm)
    attack = (mon["baseStats"]["atk"] + IV) * cpm[ATTACKER_LEVEL]
    turns = 0
    damage = 0
    residual_energy = 0
    blocks_left = 2 if block else 0
    for i in range(cycle_count):
        block_next = False
        if blocks_left > 0:
            block_next = True
            blocks_left -= 1
        (t, d, e) = do_move_cycle(fm, fm_stab, cm, cm_stab, attack,
                                  residual_energy, block_next)
        turns += t
        damage += d
        residual_energy = e
    return (turns, damage)

def calc_damage(mon, fm, cm, block):
    # We calculate damage across three charged moves. This allows us to account
    # for different move counts due to residual energy left over from the first
    # move.
    (turns, damage) = do_move_cycles(mon, fm, cm, 3, block)
    # The result is damage per turn, in HP, against our reference defender.
    return damage / turns

for mon in pokemon.values():
    if mon["dex"] in EXCLUDED_DEX_NUMBERS:
        continue
    fast_moves = [ moves[m] for m in mon["fastMoves"] if m in moves  and moves[m]["energyGain"]>0 ]
    chrg_moves = [ moves[m] for m in mon["chargedMoves"] if m in moves ]
    eliteMoves = mon.get("eliteMoves") or []
    movesets = []
    for fm in fast_moves:
        for cm in chrg_moves:
            turns = (cm["energy"] / fm["energyGain"]) * fm["turns"]
            if turns <= TURNS_THRESHOLD:
                damage = calc_damage(mon, fm, cm, False)
                damage_with_blocks = calc_damage(mon, fm, cm, True)
                movesets.append({
                    "mon": mon,
                    "turns": turns,
                    "fm": fm,
                    "cm": cm,
                    "fm_elite": fm["moveId"] in eliteMoves,
                    "cm_elite": cm["moveId"] in eliteMoves,
                    "damage": damage,
                    "damage_with_blocks": damage_with_blocks,
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
          "Damage: %.2f;" % ms["damage"],
          "Damage (blocks): %.2f;" % ms["damage_with_blocks"],
          end=''
          )
    if fmt == cmt:
        print(" (both %s)" % ms["fm"]["type"], end='')
    print()


