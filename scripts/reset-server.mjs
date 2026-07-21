// Resets local private server world state (server/db.json, server/logs) back
// to a fresh, empty world.
//
// @screeps/storage does NOT bootstrap a valid db.json from nothing — its
// upgradeDb() unconditionally reads the `env` collection and crashes
// (TypeError: Cannot read properties of null) if that collection doesn't
// exist yet. A real seed only exists in @screeps/launcher's init_dist/db.json
// (created once by `screeps.js init`), so resetting means restoring THAT
// file, not deleting db.json outright.
//
// Leaves server/.screepsrc, assets, mods.json, and node_modules untouched —
// no re-init needed. You will need to re-register your account in the Steam
// client afterward, since the old account went with the reset db.
//
// Usage:
//   npm run reset:server

import { copyFileSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const SERVER_DIR = path.join(process.cwd(), "server");
const DB_FILE = path.join(SERVER_DIR, "db.json");
const LOGS_DIR = path.join(SERVER_DIR, "logs");
const SEED_DB_FILE = path.join(
  process.cwd(),
  "node_modules",
  "@screeps",
  "launcher",
  "init_dist",
  "db.json"
);

if (!existsSync(SERVER_DIR)) {
  console.error("No server/ directory found — nothing to reset. Run `screeps.js init` first.");
  process.exit(1);
}

if (!existsSync(SEED_DB_FILE)) {
  console.error(`Cannot find seed db at ${SEED_DB_FILE} — is @screeps/launcher installed?`);
  process.exit(1);
}

copyFileSync(SEED_DB_FILE, DB_FILE);
console.log("Reset server/db.json to the launcher's fresh-world seed");

if (existsSync(LOGS_DIR)) {
  rmSync(LOGS_DIR, { recursive: true, force: true });
  console.log("Removed server/logs");
}

console.log("\nNext: `npm run watch:server` boots the fresh world.");
console.log("You'll need to re-register your account in the Steam client (old one went with the reset db).");
