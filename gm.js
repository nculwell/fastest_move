"use strict";

// Port of gm.py: finds the Pokemon with the fastest charged-move cycles for
// Pokemon Go PVP, loading the gamemaster data live from pvpoke.

const GM_URL =
  "https://raw.githubusercontent.com/pvpoke/pvpoke/refs/heads/master/src/data/gamemaster.json";
const CPM_URL = "cpm.txt";

const DEFAULT_TURNS_THRESHOLD = 10;

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

// The defender's defense stat, filled in once cpm.txt has loaded.
let defense = 0;

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

// cpm.txt holds the CP multiplier for each level, one "<level> <cpm>" pair per line.
function parseCpm(text) {
  const cpm = new Map();
  for (const line of text.trim().split("\n")) {
    const [level, mult] = line.trim().split(/\s+/);
    cpm.set(Number(level), Number(mult));
  }
  return cpm;
}

function indexGamemaster(gm) {
  const moves = new Map();
  for (const move of gm.moves) {
    if (move.unlisted !== true) moves.set(move.moveId, move);
  }

  const pokemon = [];
  for (const mon of gm.pokemon) {
    if (!mon.released) continue;
    const tags = mon.tags;
    if (tags && (tags.includes("shadow") || tags.includes("mega"))) continue;
    if (mon.speciesId === "smeargle") continue; // skip Smeargle, it's goofy
    pokemon.push(mon);
  }

  return { moves, pokemon };
}

function stab(mon, move) {
  return mon.types.includes(move.type) ? STAB_MULTIPLIER : 1.0;
}

function moveDamage(move, moveStab, attack) {
  // The game's damage formula. Type effectiveness is deliberately left out: it's
  // situational, and we show the move types so players can account for it. Note
  // that the flooring and the +1 happen per hit, so this is not a simple scaling
  // of the move's power -- low-power fast moves gain proportionally more.
  return Math.floor((0.5 * PVP_BONUS * move.power * moveStab * attack) / defense) + 1;
}

function doMoveCycle(fm, fmStab, cm, cmStab, attack, residualEnergy, block) {
  let turns = 0;
  let energy = residualEnergy;
  let damage = 0;
  // Apply fast moves until enough energy is generated to fire a charged move
  while (energy < cm.energy) {
    turns += fm.turns;
    energy += fm.energyGain;
    damage += moveDamage(fm, fmStab, attack);
  }
  // Apply the charged move. A blocked move still costs its energy and its turn.
  damage += block ? SHIELDED_DAMAGE : moveDamage(cm, cmStab, attack);
  turns += 1;
  energy -= cm.energy;
  return { turns, damage, energy };
}

function doMoveCycles(mon, fm, cm, cycleCount, block, cpm) {
  const fmStab = stab(mon, fm);
  const cmStab = stab(mon, cm);
  const attack = (mon.baseStats.atk + IV) * cpm.get(ATTACKER_LEVEL);
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
    const cycle = doMoveCycle(fm, fmStab, cm, cmStab, attack, residualEnergy, blockNext);
    turns += cycle.turns;
    damage += cycle.damage;
    residualEnergy = cycle.energy;
  }
  return { turns, damage };
}

function calcDamage(mon, fm, cm, block, cpm) {
  // We calculate damage across three charged moves. This allows us to account
  // for different move counts due to residual energy left over from the first
  // move.
  const { turns, damage } = doMoveCycles(mon, fm, cm, CYCLE_COUNT, block, cpm);
  // The result is damage per turn, in HP, against our reference defender.
  return damage / turns;
}

function findMovesets({ moves, pokemon, cpm }, turnsThreshold) {
  const results = [];

  for (const mon of pokemon) {
    const fms = mon.fastMoves
      .map((m) => moves.get(m))
      .filter((m) => m && m.energyGain > 0);
    const cms = mon.chargedMoves.map((m) => moves.get(m)).filter((m) => m);
    const eliteMoves = mon.eliteMoves || [];

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
          damage: calcDamage(mon, fm, cm, false, cpm),
          damageWithBlocks: calcDamage(mon, fm, cm, true, cpm),
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
  span.title = type;
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

function moveCell(move, mon, elite) {
  const td = document.createElement("td");
  td.className = "move";
  if (elite) {
    const star = document.createElement("span");
    star.className = "star";
    star.textContent = "*";
    star.title = "Needs an Elite TM";
    td.append(star);
  }
  const name = document.createElement("span");
  name.textContent = move.name;
  if (mon.types.includes(move.type)) {
    name.className = "stab";
    name.title = "STAB";
  }
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
      moveCell(ms.fm, ms.mon, ms.fmElite),
      moveCell(ms.cm, ms.mon, ms.cmElite),
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

async function fetchText(url) {
  const resp = await fetch(url, { cache: "no-cache" });
  if (!resp.ok) throw new Error("HTTP " + resp.status + " " + resp.statusText);
  return resp.text();
}

async function main() {
  const thresholdEl = document.getElementById("threshold");
  const bestOnlyEl = document.getElementById("bestOnly");
  const searchEl = document.getElementById("search");

  setStatus("Loading gamemaster.json from pvpoke…");

  let gm, cpm;
  try {
    const [gmText, cpmText] = await Promise.all([fetchText(GM_URL), fetchText(CPM_URL)]);
    gm = JSON.parse(gmText);
    cpm = parseCpm(cpmText);
  } catch (err) {
    setStatus(
      "Could not load the gamemaster or cpm.txt: " +
        err.message +
        ". If you opened this file directly, try serving it instead " +
        "(python3 -m http.server) so the browser allows the requests.",
      true
    );
    return;
  }

  defense = (DEFENDER_BASE_DEF + IV) * cpm.get(DEFENDER_LEVEL);

  const indexed = { ...indexGamemaster(gm), cpm };
  const updated = gm.timestamp ? new Date(gm.timestamp).toLocaleString() : "unknown";
  setStatus(
    `${indexed.pokemon.length.toLocaleString()} Pokemon and ` +
      `${indexed.moves.size.toLocaleString()} moves · gamemaster updated ${updated}`
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
