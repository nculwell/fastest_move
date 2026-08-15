"use strict";

// Port of gm.py: finds the Pokemon with the fastest charged-move cycles for
// Pokemon Go PVP, loading the gamemaster data live from pvpoke.

const GM_URL =
  "https://raw.githubusercontent.com/pvpoke/pvpoke/refs/heads/master/src/data/gamemaster.json";

const DEFAULT_TURNS_THRESHOLD = 10;

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

  const pokemon = [];
  for (const mon of gm.pokemon) {
    const tags = mon.tags;
    if (tags && (tags.includes("shadow") || tags.includes("mega"))) continue;
    if (mon.speciesId === "smeargle") continue; // learns everything; not useful
    pokemon.push(mon);
  }

  return { moves, pokemon };
}

function findMovesets({ moves, pokemon }, turnsThreshold) {
  const results = [];

  for (const mon of pokemon) {
    const fms = mon.fastMoves
      .map((m) => moves.get(m))
      .filter((m) => m && m.energyGain > 0);
    const cms = mon.chargedMoves.map((m) => moves.get(m)).filter((m) => m);

    const movesets = [];
    for (const fm of fms) {
      for (const cm of cms) {
        const turns = (cm.energy / fm.energyGain) * fm.turns;
        if (turns > turnsThreshold) continue;

        let fmPower = (fm.power * turns) / (turns + 1);
        let cmPower = cm.power / (turns + 1);
        if (mon.types.includes(fm.type)) fmPower *= 1.25; // STAB
        if (mon.types.includes(cm.type)) cmPower *= 1.25; // STAB

        movesets.push({
          mon,
          fm,
          cm,
          turns,
          damage: (fmPower + cmPower) * mon.baseStats.atk,
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
  for (const ms of results) {
    ms.sortKey =
      ms.turns.toFixed(2).padStart(5, "0") +
      "--" +
      Math.trunc(1000000 - ms.damage) +
      "--" +
      ms.mon.speciesId;
  }
  results.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));

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

function moveCell(move, mon) {
  const td = document.createElement("td");
  td.className = "move";
  const name = document.createElement("span");
  name.textContent = move.name;
  if (mon.types.includes(move.type)) {
    name.className = "stab";
    name.title = "STAB";
  }
  td.append(name, " ", typeBadge(move.type));
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
      td.colSpan = 5;
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

    const turns = document.createElement("td");
    turns.className = "num";
    turns.textContent = label;

    const damage = document.createElement("td");
    damage.className = "num";
    damage.textContent = Math.trunc(ms.damage).toLocaleString();

    tr.append(name, moveCell(ms.fm, ms.mon), moveCell(ms.cm, ms.mon), turns, damage);
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
