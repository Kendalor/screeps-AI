// Captures the current server/db.json as the seed that `npm run reset:server`
// restores to, instead of @screeps/launcher's stock 11x11-room world.
//
// Use this after growing the map with scripts/expand-map.mjs (or any other
// one-time world setup you want resets to preserve) — otherwise every reset
// shrinks the map back down to the launcher's default seed.
//
// STOP the server first (Ctrl-C on `npm run watch:server`) so db.json is
// flushed and not being written concurrently.
//
// This captures whatever is in db.json right now, including any player
// accounts/rooms/creeps that exist — if you want a clean "empty but big"
// seed, wipe player state first (or just accept a fresh account next reset,
// same as the stock seed requires).
//
// Usage:
//   npm run reseed:server

import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const SERVER_DIR = path.join(process.cwd(), "server");
const DB_FILE = path.join(SERVER_DIR, "db.json");
const CUSTOM_SEED_FILE = path.join(SERVER_DIR, "seed-expanded.json");

if (!existsSync(DB_FILE)) {
  console.error(`No db.json found at ${DB_FILE} — nothing to capture.`);
  process.exit(1);
}

copyFileSync(DB_FILE, CUSTOM_SEED_FILE);
console.log(`Captured server/db.json -> ${CUSTOM_SEED_FILE}`);
console.log("`npm run reset:server` will now restore this seed instead of the stock 11x11 world.");
