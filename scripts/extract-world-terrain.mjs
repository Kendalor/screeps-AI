// Extracts terrain for a block of rooms around a center room from the real
// Screeps World server (screeps.com), and writes it to a JSON file for
// scripts/bake-terrain-seed.mjs to bake into the pserver's reset seed.
//
// This only reads from the World server — it never touches the pserver.
// Read-only, safe to run any time (rate-limited by the loop's delay below).
//
// Usage:
//   node scripts/extract-world-terrain.mjs <centerRoom> [radius=2] [shard=shard1] [outFile]
//
// Example:
//   node scripts/extract-world-terrain.mjs W47N14 2 shard1 server/world-terrain/W47N14.json
//   (radius 2 -> 5x5 block "up to 20 rooms" per-quadrant style; pass radius 4 for a
//   3x3-sector-ish ~9x9 block if you want the wider "up to 20 rooms" span discussed)
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
  console.error("Usage: node scripts/extract-world-terrain.mjs <centerRoom> [radius=2] [shard=shard1] [outFile]");
  process.exit(1);
}

const radius = radiusArg ? Number(radiusArg) : 2;
const shard = shardArg || "shard1";
const outFile = outFileArg || path.join("server", "world-terrain", `${centerRoom}-r${radius}.json`);

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
let missing = 0;

console.log(`Extracting terrain for ${roomNames.length} room(s) around ${centerRoom} (radius ${radius}, ${shard})...`);

for (let i = 0; i < roomNames.length; i++) {
  const room = roomNames[i];
  const res = await api.raw.game.roomTerrain(room, true, shard).catch(e => ({ error: e.message }));
  const terrain = res?.terrain?.[0]?.terrain;
  if (terrain) {
    result[room] = terrain;
    ok++;
  } else {
    missing++;
    console.log(`[${i + 1}/${roomNames.length}] ${room}: no terrain (${res?.error || "room may not exist"})`);
  }
  if ((i + 1) % 10 === 0 || i === roomNames.length - 1) {
    console.log(`[${i + 1}/${roomNames.length}] ok=${ok} missing=${missing}`);
  }
}

mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify({ centerRoom, radius, shard, rooms: result }, null, 2));
console.log(`Wrote ${ok} room(s) to ${outFile}`);
console.log(`\nNext: node scripts/bake-terrain-seed.mjs ${outFile}`);
