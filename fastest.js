"use strict";

// Port of gm.py: finds the Pokemon with the fastest charged-move cycles for
// Pokemon Go PVP, loading the gamemaster data live from pvpoke.

const GM_URL =
  "https://raw.githubusercontent.com/pvpoke/pvpoke/refs/heads/master/src/data/gamemaster.json";

const CPM_URL = "cpm.txt";

const DEFAULT_TURNS_THRESHOLD = 10;

const EXCLUDED = [ "smeargle", "pikachu" ]

// The CP multiplier for each level, indexed by level - 1. We read this from cpm.txt
// at runtime the way gm.py does, and fall back to this built-in copy if the file
// can't be fetched -- opening the page from file:// rather than serving it, say.
// Regenerate both from the game master with extract_cpm.py. The repeated tail is
// padding upstream, not real levels.
const BUILTIN_CPM = [
  0.094, 0.16639787, 0.21573247, 0.25572005, 0.29024988, 0.3210876,
  0.34921268, 0.3752356, 0.39956728, 0.4225, 0.44310755, 0.4627984,
  0.48168495, 0.49985844, 0.51739395, 0.5343543, 0.5507927, 0.5667545,
  0.5822789, 0.5974, 0.6121573, 0.6265671, 0.64065295, 0.65443563,
  0.667934, 0.6811649, 0.69414365, 0.7068842, 0.7193991, 0.7317,
  0.7377695, 0.74378943, 0.74976104, 0.7556855, 0.76156384, 0.76739717,
  0.7731865, 0.77893275, 0.784637, 0.7903, 0.7953, 0.8003,
  0.8053, 0.8103, 0.8153, 0.8203, 0.8253, 0.8303,
  0.8353, 0.8403, 0.8453, 0.8503, 0.8553, 0.8603,
  0.8653, 0.8653, 0.8653, 0.8653, 0.8653, 0.8653,
  0.8653, 0.8653, 0.8653, 0.8653, 0.8653, 0.8653,
  0.8653, 0.8653, 0.8653, 0.8653, 0.8653, 0.8653,
  0.8653, 0.8653, 0.8653, 0.8653, 0.8653, 0.8653,
  0.8653, 0.8653,
];

let cpm = BUILTIN_CPM;

const cpmFor = (level) => cpm[level - 1];

// The reference matchup we score every moveset against. Attacker and defender are
// both level 40 with IV 15, so the CPM cancels out of the attack/defense ratio and
// the ranking doesn't depend on the level we picked; the constants are here so the
// assumption is visible and easy to change.
const ATTACKER_LEVEL = 40;
const DEFENDER_LEVEL = 40;
const DEFENDER_BASE_DEF = 100;
const IV = 15;

// The trainer-battle damage bonus, part of the damage formula.
const PVP_BONUS = 1.3;

// A Protect Shield reduces a charged move to 1 damage, it doesn't nullify it.
const SHIELDED_DAMAGE = 1;

const STAB_MULTIPLIER = 1.2;

// We score three charged-move cycles, which is about as far as a Rocket battle
// gets. The "blocks" figure assumes the leader shields the first two of them.
const CYCLE_COUNT = 3;
const SHIELDS = 2;

const TYPE_ABBR = {
  normal: "nrm",
  fighting: "fig",
  flying: "fly",
  poison: "poi",
  ground: "grd",
  rock: "rck",
  bug: "bug",
  ghost: "gho",
  steel: "stl",
  fire: "fir",
  water: "wtr",
  grass: "grs",
  electric: "elc",
  psychic: "psy",
  ice: "ice",
  dragon: "drg",
  dark: "drk",
  fairy: "fai",
};

const TYPE_COLORS = {
  normal: "#A8A77A",
  fighting: "#C22E28",
  flying: "#A98FF3",
  poison: "#A33EA1",
  ground: "#E2BF65",
  rock: "#B6A136",
  bug: "#A6B91A",
  ghost: "#735797",
  steel: "#B7B7CE",
  fire: "#EE8130",
  water: "#6390F0",
  grass: "#7AC74C",
  electric: "#F7D02C",
  psychic: "#F95587",
  ice: "#96D9D6",
  dragon: "#6F35FC",
  dark: "#705746",
  fairy: "#D685AD",
};

// ---------------------------------------------------------------- computation

// Matches Python's "%05.2f" / str(round(x, 2)): always at least one decimal,
// so 8 renders as "8.0" and 7.5 as "7.5".
function formatTurns(turns) {
  return turns.toFixed(2).replace(/0$/, "");
}

function indexGamemaster(gm) {
  const moves = new Map();
  for (const move of gm.moves) {
    if (move.unlisted !== true) moves.set(move.moveId, move);
  }

  // Here we filter out any Pokemon that we want to exclude.
  const pokemon = [];
  for (const mon of gm.pokemon) {
    if (!mon.released) continue;
    const tags = mon.tags;
    if (tags && (tags.includes("shadow") || tags.includes("mega"))) continue;
    pokemon.push(mon);
  }

  // EXCLUDED lists species ids, but we exclude by dex number so that every form
  // of an excluded Pokemon drops out along with it.
  const byId = new Map(pokemon.map((mon) => [mon.speciesId, mon]));
  const excludedDex = new Set();
  for (const speciesId of EXCLUDED) {
    const mon = byId.get(speciesId);
    if (mon) excludedDex.add(mon.dex);
    else console.warn(`EXCLUDED entry "${speciesId}" matched no Pokemon`);
  }

  return {
    moves,
    pokemon: pokemon.filter((mon) => !excludedDex.has(mon.dex)),
  };
}

// cpm.txt holds the CP multiplier for each level, one "<level> <cpm>" pair per line.
function parseCpm(text) {
  const table = [];
  for (const line of text.trim().split("\n")) {
    const [level, mult] = line.trim().split(/\s+/);
    table[Number(level) - 1] = Number(mult);
  }
  return table;
}

// A table is only usable if it covers the two levels the reference matchup needs.
function cpmIsUsable(table) {
  return [ATTACKER_LEVEL, DEFENDER_LEVEL].every((level) =>
    Number.isFinite(table[level - 1])
  );
}

function stab(mon, move) {
  return mon.types.includes(move.type) ? STAB_MULTIPLIER : 1.0;
}

const attackStat = (mon) => (mon.baseStats.atk + IV) * cpmFor(ATTACKER_LEVEL);
const defenseStat = () => (DEFENDER_BASE_DEF + IV) * cpmFor(DEFENDER_LEVEL);

function moveDamage(move, moveStab, attack, defense) {
  // The game's damage formula. Type effectiveness is deliberately left out: it's
  // situational, and we show the move types so players can account for it. Note
  // that the flooring and the +1 happen per hit, so this is not a simple scaling
  // of the move's power -- low-power fast moves gain proportionally more.
  return Math.floor((0.5 * PVP_BONUS * move.power * moveStab * attack) / defense) + 1;
}

function doMoveCycle(fm, fmStab, cm, cmStab, attack, defense, residualEnergy, block) {
  let turns = 0;
  let energy = residualEnergy;
  let damage = 0;
  // Apply fast moves until enough energy is generated to fire a charged move
  while (energy < cm.energy) {
    turns += fm.turns;
    energy += fm.energyGain;
    damage += moveDamage(fm, fmStab, attack, defense);
  }
  // Apply the charged move. A blocked move still costs its energy and its turn.
  damage += block ? SHIELDED_DAMAGE : moveDamage(cm, cmStab, attack, defense);
  turns += 1;
  energy -= cm.energy;
  return { turns, damage, energy };
}

function doMoveCycles(mon, fm, cm, cycleCount, block) {
  const fmStab = stab(mon, fm);
  const cmStab = stab(mon, cm);
  const attack = attackStat(mon);
  const defense = defenseStat();
  let turns = 0;
  let damage = 0;
  let residualEnergy = 0;
  let blocksLeft = block ? SHIELDS : 0;
  for (let i = 0; i < cycleCount; i++) {
    let blockNext = false;
    if (blocksLeft > 0) {
      blockNext = true;
      blocksLeft -= 1;
    }
    const cycle = doMoveCycle(
      fm, fmStab, cm, cmStab, attack, defense, residualEnergy, blockNext
    );
    turns += cycle.turns;
    damage += cycle.damage;
    residualEnergy = cycle.energy;
  }
  return { turns, damage };
}

function calcDamage(mon, fm, cm, block) {
  // We calculate damage across three charged moves. This allows us to account
  // for different move counts due to residual energy left over from the first
  // move.
  const { turns, damage } = doMoveCycles(mon, fm, cm, CYCLE_COUNT, block);
  // The result is damage per turn, in HP, against our reference defender.
  return damage / turns;
}

function findMovesets({ moves, pokemon }, turnsThreshold) {
  const results = [];

  for (const mon of pokemon) {
    const fms = mon.fastMoves
      .map((m) => moves.get(m))
      .filter((m) => m && m.energyGain > 0);
    const cms = mon.chargedMoves.map((m) => moves.get(m)).filter((m) => m);
    const eliteMoves = mon.eliteMoves || [];
    const attack = attackStat(mon);
    const defense = defenseStat();

    const movesets = [];
    for (const fm of fms) {
      for (const cm of cms) {
        const turns = (cm.energy / fm.energyGain) * fm.turns;
        if (turns > turnsThreshold) continue;

        movesets.push({
          mon,
          fm,
          cm,
          turns,
          fmElite: eliteMoves.includes(fm.moveId),
          cmElite: eliteMoves.includes(cm.moveId),
          // Damage a single hit of each move does, for the per-move tooltips.
          fmHit: moveDamage(fm, stab(mon, fm), attack, defense),
          cmHit: moveDamage(cm, stab(mon, cm), attack, defense),
          damage: calcDamage(mon, fm, cm, false),
          damageWithBlocks: calcDamage(mon, fm, cm, true),
        });
      }
    }
    if (movesets.length === 0) continue;

    // Flag the moveset(s) that give this Pokemon its shortest cycle.
    const bestTurns = Math.min(...movesets.map((ms) => ms.turns));
    for (const ms of movesets) ms.best = ms.turns === bestTurns;

    results.push(...movesets);
  }

  // Fastest first, then hardest-hitting, then by species for a stable order.
  results.sort(
    (a, b) =>
      a.turns - b.turns ||
      b.damage - a.damage ||
      (a.mon.speciesId < b.mon.speciesId ? -1 : a.mon.speciesId > b.mon.speciesId ? 1 : 0)
  );

  return results;
}

// ------------------------------------------------------------------ rendering

function typeBadge(type) {
  const span = document.createElement("span");
  span.className = "type";
  span.textContent = TYPE_ABBR[type] || type;
  const color = TYPE_COLORS[type] || "#888";
  span.style.background = color;
  span.style.color = isLight(color) ? "#1a1a1a" : "#fff";
  return span;
}

function isLight(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  // Rec. 709 relative luminance.
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150;
}

// Everything about a move goes in one tooltip on the cell. The inner spans
// deliberately carry no title of their own, so hovering anywhere in the cell --
// name, type badge or elite marker -- shows the same thing.
function moveTooltip(move, mon, elite, hit) {
  const type = move.type.charAt(0).toUpperCase() + move.type.slice(1);
  const lines = [
    move.name,
    mon.types.includes(move.type) ? `${type} · STAB` : type,
    `Turns: ${move.turns}`,
    `Damage: ${hit} HP (power ${move.power})`,
    move.energyGain > 0
      ? `Energy gain: ${move.energyGain}`
      : `Energy cost: ${move.energy}`,
  ];
  if (elite) lines.push("Needs an Elite TM");
  return lines.join("\n");
}

function moveCell(move, mon, elite, hit) {
  const td = document.createElement("td");
  td.className = "move";
  td.title = moveTooltip(move, mon, elite, hit);
  if (elite) {
    const star = document.createElement("span");
    star.className = "star";
    star.textContent = "*";
    td.append(star);
  }
  const name = document.createElement("span");
  name.textContent = move.name;
  if (mon.types.includes(move.type)) name.className = "stab";
  td.append(name, " ", typeBadge(move.type));
  return td;
}

function numCell(value) {
  const td = document.createElement("td");
  td.className = "num";
  td.textContent = value;
  return td;
}

function render(movesets, opts) {
  const tbody = document.getElementById("results");
  tbody.replaceChildren();

  const search = opts.search.trim().toLowerCase();
  const shown = movesets.filter((ms) => {
    if (opts.bestOnly && !ms.best) return false;
    if (!search) return true;
    return (
      ms.mon.speciesName.toLowerCase().includes(search) ||
      ms.fm.name.toLowerCase().includes(search) ||
      ms.cm.name.toLowerCase().includes(search) ||
      ms.fm.type.includes(search) ||
      ms.cm.type.includes(search)
    );
  });

  let prevTurns = null;
  const frag = document.createDocumentFragment();

  for (const ms of shown) {
    const label = formatTurns(ms.turns);
    if (label !== prevTurns) {
      const tr = document.createElement("tr");
      tr.className = "group";
      const td = document.createElement("td");
      td.colSpan = 6;
      td.textContent = "TURNS: " + label;
      tr.append(td);
      frag.append(tr);
      prevTurns = label;
    }

    const tr = document.createElement("tr");
    if (!ms.best) tr.className = "notbest";

    const name = document.createElement("td");
    name.className = "mon";
    name.textContent = ms.mon.speciesName;
    if (!ms.best) {
      const star = document.createElement("span");
      star.className = "star";
      star.textContent = "*";
      star.title = "Not this Pokemon's fastest moveset";
      name.append(star);
    }

    tr.append(
      name,
      moveCell(ms.fm, ms.mon, ms.fmElite, ms.fmHit),
      moveCell(ms.cm, ms.mon, ms.cmElite, ms.cmHit),
      numCell(label),
      numCell(ms.damage.toFixed(2)),
      numCell(ms.damageWithBlocks.toFixed(2))
    );
    frag.append(tr);
  }

  tbody.append(frag);
  document.getElementById("count").textContent =
    shown.length.toLocaleString() + " moveset" + (shown.length === 1 ? "" : "s");
}

// --------------------------------------------------------------------- wiring

function setStatus(text, isError) {
  const el = document.getElementById("status");
  el.textContent = text;
  el.classList.toggle("error", !!isError);
}

async function main() {
  const thresholdEl = document.getElementById("threshold");
  const bestOnlyEl = document.getElementById("bestOnly");
  const searchEl = document.getElementById("search");

  setStatus("Loading gamemaster.json from pvpoke…");

  // A missing or unreadable cpm.txt isn't fatal: we just keep the built-in table.
  let cpmNote = "";
  try {
    const resp = await fetch(CPM_URL, { cache: "no-cache" });
    if (!resp.ok) throw new Error("HTTP " + resp.status + " " + resp.statusText);
    const table = parseCpm(await resp.text());
    if (!cpmIsUsable(table)) {
      throw new Error("no CP multiplier for level " + ATTACKER_LEVEL + " or " + DEFENDER_LEVEL);
    }
    cpm = table;
  } catch (err) {
    cpmNote = ` · using the built-in CPM table (${CPM_URL}: ${err.message})`;
  }

  let gm;
  try {
    const resp = await fetch(GM_URL, { cache: "no-cache" });
    if (!resp.ok) throw new Error("HTTP " + resp.status + " " + resp.statusText);
    gm = await resp.json();
  } catch (err) {
    setStatus(
      "Could not load the gamemaster: " +
        err.message +
        ". If you opened this file directly, try serving it instead " +
        "(python3 -m http.server) so the browser allows the request.",
      true
    );
    return;
  }

  const indexed = indexGamemaster(gm);
  const updated = gm.timestamp ? new Date(gm.timestamp).toLocaleString() : "unknown";
  setStatus(
    `${indexed.pokemon.length.toLocaleString()} Pokemon and ` +
      `${indexed.moves.size.toLocaleString()} moves · gamemaster updated ${updated}` +
      cpmNote
  );

  let movesets = [];
  const recompute = () => {
    const threshold = Number(thresholdEl.value) || DEFAULT_TURNS_THRESHOLD;
    movesets = findMovesets(indexed, threshold);
    redraw();
  };
  const redraw = () =>
    render(movesets, { bestOnly: bestOnlyEl.checked, search: searchEl.value });

  thresholdEl.addEventListener("change", recompute);
  bestOnlyEl.addEventListener("change", redraw);
  searchEl.addEventListener("input", redraw);

  recompute();
}

document.addEventListener("DOMContentLoaded", main);
