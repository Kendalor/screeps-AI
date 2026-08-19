// Extracts static resource placement (sources, minerals, keeper lairs,
// controller position) for a block of rooms around a center room from the
// real Screeps World server, for scripts/bake-objects-seed.mjs to bake into
// the pserver's reset seed.
//
// Filters out everything else the World API returns for a room (roads,
// containers, ramparts, spawns/extensions/towers/storage/links/labs,
// creeps, tombstones, power-related structures) at extraction time -- only
// the four natural/static types are kept, and only their position/identity
// fields (no live energy/progress/ownership state -- bake-objects-seed.mjs
// resets those to a neutral baseline anyway, so no reason to carry them).
//
// Read-only, safe to run any time.
//
// Usage:
//   node scripts/extract-world-objects.mjs <centerRoom> [radius=2] [shard=shard1] [outFile]
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { ScreepsAPI } from "screeps-api";
import screepsConfig from "../screeps.json" with { type: "json" };
import { roomsInRadius } from "./lib/roomGrid.mjs";

const cfg = screepsConfig.main;

function resolveEnv(value) {
  const match = /^\$\{(\w+)\}$/.exec(value);
  if (!match) return value;
  const resolved = process.env[match[1]];
  if (!resolved) throw new Error(`Missing env var ${match[1]}`);
  return resolved;
}

const [, , centerRoom, radiusArg, shardArg, outFileArg] = process.argv;

if (!centerRoom) {
  console.error("Usage: node scripts/extract-world-objects.mjs <centerRoom> [radius=2] [shard=shard1] [outFile]");
  process.exit(1);
}

const radius = radiusArg ? Number(radiusArg) : 2;
const shard = shardArg || "shard1";
const outFile = outFileArg || path.join("server", "world-terrain", `${centerRoom}-r${radius}-objects.json`);

const STATIC_TYPES = new Set(["source", "mineral", "keeperLair", "controller"]);
const KEEP_FIELDS = ["room", "type", "x", "y", "mineralType", "density", "mineralAmount"];

const roomNames = roomsInRadius(centerRoom, radius);

const api = new ScreepsAPI({
  token: resolveEnv(cfg.token),
  protocol: cfg.protocol,
  hostname: cfg.hostname,
  port: cfg.port,
  path: cfg.path,
});

const result = {};
let ok = 0;
let empty = 0;

console.log(`Extracting static resources for ${roomNames.length} room(s) around ${centerRoom} (radius ${radius}, ${shard})...`);

for (let i = 0; i < roomNames.length; i++) {
  const room = roomNames[i];
  const res = await api.raw.game.roomObjects(room, shard).catch(e => ({ error: e.message }));
  const objects = res?.objects;
  if (Array.isArray(objects)) {
    const filtered = objects
      .filter(o => STATIC_TYPES.has(o.type))
      .map(o => Object.fromEntries(KEEP_FIELDS.filter(k => o[k] !== undefined).map(k => [k, o[k]])));
    if (filtered.length > 0) {
      result[room] = filtered;
      ok++;
    } else {
      empty++;
    }
  } else {
    empty++;
    console.log(`[${i + 1}/${roomNames.length}] ${room}: no objects (${res?.error || "room may not exist"})`);
  }
  if ((i + 1) % 10 === 0 || i === roomNames.length - 1) {
    console.log(`[${i + 1}/${roomNames.length}] ok=${ok} empty=${empty}`);
  }
}

mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify({ centerRoom, radius, shard, rooms: result }, null, 2));
console.log(`Wrote ${ok} room(s) to ${outFile}`);
console.log(`\nNext: node scripts/bake-objects-seed.mjs ${outFile}`);
