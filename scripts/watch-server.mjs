// Launch a real local Screeps private server you can watch in the Steam client,
// with this bot loaded and (optionally) the colony seeded to a given RCL.
//
// Unlike the integration harness (screeps-server-mockup — headless, for CI),
// this boots the full @screeps/launcher server with its web backend on
// localhost:21025, so the Steam client's "Private Server -> localhost:21025"
// can connect and render the room live while the bot runs.
//
// Usage:
//   node scripts/watch-server.mjs [--rcl <n>]
//
// Then, in a second terminal once the server is up:
//   npm run push-pserver        # upload dist/main.js to the local server
// and connect the Steam client to localhost:21025 (username/password printed
// on first run). Ctrl-C here stops the server.
//
// Prereq: `screeps.json` must contain a "pserver" entry pointing at
// http://localhost:21025 (copy it from screeps-example.json's "pserver" block).

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const SERVER_DIR = path.join(process.cwd(), "server");
const LAUNCHER = path.join(process.cwd(), "node_modules", "@screeps", "launcher", "bin", "screeps.js");

if (!existsSync(LAUNCHER)) {
  console.error("Cannot find @screeps/launcher. Run `npm install` first.");
  process.exit(1);
}

// The launcher needs a .screepsrc (created by `screeps init`) before `start`
// works — it defines assetdir (the web frontend) and the storage/db paths.
if (!existsSync(path.join(SERVER_DIR, ".screepsrc"))) {
  console.error("Server not initialised — no server/.screepsrc found.\n");
  console.error("Run this once (interactive; accepts defaults, Steam key optional for local play):");
  console.error(`  cd server && node "${LAUNCHER}" init\n`);
  console.error("Then re-run `npm run watch:server`.");
  process.exit(1);
}

const rclArg = process.argv.indexOf("--rcl");
const rcl = rclArg >= 0 ? Number(process.argv[rclArg + 1]) : undefined;

console.log(`Starting local Screeps server in ${SERVER_DIR} (backend on :21025)…`);
if (rcl) {
  console.log(`After the bot spawns, seed RCL with the CLI: connect and run`);
  console.log(`  storage.db['rooms.objects'].update({type:'controller'},{$set:{level:${rcl}}})`);
}
console.log("In another terminal, run `npm run push-pserver` to upload the bot.");
console.log("Connect the Steam client to Private Server -> localhost:21025. Ctrl-C to stop.\n");

const child = spawn(process.execPath, [LAUNCHER, "start"], {
  cwd: SERVER_DIR,
  stdio: "inherit"
});

const shutdown = () => {
  child.kill("SIGINT");
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
child.on("exit", code => process.exit(code ?? 0));
