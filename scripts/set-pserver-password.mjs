// Sets/resets the local password for a pserver account via screepsmod-auth's
// CLI command (`auth.setPassword`), bumps the account's GCL, and updates
// screeps.json's pserver block to match — so `npm run push-pserver` can
// authenticate.
//
// Why this exists: signing up through the Steam client only asks for a
// username (Steam handles auth for that flow); it does NOT set a password
// for the screepsmod-auth account used by the HTTP API. The push-pserver
// script authenticates over HTTP, so the account needs an explicit password.
// GCL is bumped alongside it purely for test-server convenience (claiming
// more rooms while testing) — the engine stores GCL as raw progress energy,
// not a level, so we convert via the same GCL_MULTIPLY/GCL_POW formula the
// server itself uses (see @screeps/backend/lib/cli/bots.js).
//
// Requires the server to be running (`npm run watch:server` in another
// terminal) — this talks to the CLI TCP port (21026 by default).
//
// Usage:
//   npm run set-pserver-password -- <username> <password> <gcl>
//   npm run set-pserver-password              # defaults: Kendalor / changeme / GCL 4

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";

const [, , argUsername, argPassword, argGcl] = process.argv;
const username = argUsername || "Kendalor";
const password = argPassword || "changeme";
const gclLevel = parseInt(argGcl, 10) || 4;

const CLI_HOST = "localhost";
const CLI_PORT = 21026;
const SCREEPS_JSON = path.join(process.cwd(), "screeps.json");

// The CLI streams a connect banner first (ending in its own "< " prompt),
// then echoes each command's result prefixed with "< " once it finishes
// evaluating. We wait for the banner's prompt, discard it, THEN send the
// command and wait for a fresh "< "-terminated chunk — otherwise the banner
// and the real reply can race/concatenate and get misread as each other.
function runCliCommand(command) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(CLI_PORT, CLI_HOST);
    let stage = "banner"; // "banner" -> "reply"
    let output = "";
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("Timed out waiting for CLI response"));
    }, 5000);

    socket.on("data", data => {
      output += data.toString("utf8");
      if (!/\n< $/.test(output) && !/^< $/.test(output) && !/\n< /.test(output) && !/^< /.test(output)) {
        return;
      }
      if (stage === "banner") {
        stage = "reply";
        output = "";
        socket.write(command + "\r\n");
        return;
      }
      clearTimeout(timeout);
      socket.end();
      resolve(output);
    });
    socket.on("error", err => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

let result;
try {
  result = await runCliCommand(`auth.setPassword('${username}', '${password}')`);
  console.log(result.trim());
} catch (err) {
  console.error(`Could not reach the server CLI on ${CLI_HOST}:${CLI_PORT} — is \`npm run watch:server\` running?`);
  console.error(err.message);
  process.exit(1);
}

// The CLI resolves every command — including failed ones — into a "< "-prefixed
// reply, so a bad command looks like a successful round-trip at the socket
// level. Detect the two ways setPassword can fail so we don't cheerfully write
// mismatched credentials into screeps.json:
//   - `auth` undefined  => screepsmod-auth isn't loaded (check server/mods.json)
//   - any other Error    => e.g. the account doesn't exist yet
if (/\bauth is not defined\b/.test(result)) {
  console.error(
    "\nThe server CLI reports `auth` is not defined — screepsmod-auth is not loaded.\n" +
      "Check that server/mods.json points at an installed mod path (e.g.\n" +
      '  "node_modules/screepsmod-auth") and that it exists under server/node_modules,\n' +
      "then restart `npm run watch:server` and retry."
  );
  process.exit(1);
}
if (/\b(Error|ReferenceError|TypeError)\b/.test(result)) {
  console.error("\nThe server CLI returned an error (see above); screeps.json was left unchanged.");
  process.exit(1);
}

// GCL_MULTIPLY / GCL_POW from @screeps/common's constants.js — the sandbox's
// CLI context doesn't expose game constants directly, so the raw progress
// value is computed here rather than relying on a `C` global existing there.
const GCL_MULTIPLY = 1000000;
const GCL_POW = 2.4;
const gclProgress = GCL_MULTIPLY * Math.pow(gclLevel - 1, GCL_POW);

let gclResult;
try {
  gclResult = await runCliCommand(
    `storage.db['users'].findOne({username: '${username}'})` +
      `.then(u => storage.db['users'].update({_id: u._id}, {$set: {gcl: ${gclProgress}}}))`
  );
  console.log(gclResult.trim());
} catch (err) {
  console.error(`Could not set GCL via server CLI on ${CLI_HOST}:${CLI_PORT}.`);
  console.error(err.message);
  process.exit(1);
}
if (/\b(Error|ReferenceError|TypeError)\b/.test(gclResult)) {
  console.error(`\nThe server CLI returned an error setting GCL ${gclLevel} (see above).`);
  process.exit(1);
}
console.log(`Set GCL to ${gclLevel} for ${username}`);

if (existsSync(SCREEPS_JSON)) {
  const config = JSON.parse(readFileSync(SCREEPS_JSON, "utf8"));
  config.pserver = config.pserver || {};
  config.pserver.email = username;
  config.pserver.password = password;
  writeFileSync(SCREEPS_JSON, JSON.stringify(config, null, 2) + "\n");
  console.log(`Updated screeps.json pserver credentials (email: ${username})`);
} else {
  console.warn("No screeps.json found — skipped updating credentials there.");
}

console.log("\nNext: `npm run push-pserver`");
