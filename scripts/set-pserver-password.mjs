// Sets/resets the local password for a pserver account via screepsmod-auth's
// CLI command (`auth.setPassword`), and updates screeps.json's pserver block
// to match — so `npm run push-pserver` can authenticate.
//
// Why this exists: signing up through the Steam client only asks for a
// username (Steam handles auth for that flow); it does NOT set a password
// for the screepsmod-auth account used by the HTTP API. The push-pserver
// script authenticates over HTTP, so the account needs an explicit password.
//
// Requires the server to be running (`npm run watch:server` in another
// terminal) — this talks to the CLI TCP port (21026 by default).
//
// Usage:
//   npm run set-pserver-password -- <username> <password>
//   npm run set-pserver-password              # defaults: Kendalor / changeme

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";

const [, , argUsername, argPassword] = process.argv;
const username = argUsername || "Kendalor";
const password = argPassword || "changeme";

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

try {
  const result = await runCliCommand(`auth.setPassword('${username}', '${password}')`);
  console.log(result.trim());
} catch (err) {
  console.error(`Could not reach the server CLI on ${CLI_HOST}:${CLI_PORT} — is \`npm run watch:server\` running?`);
  console.error(err.message);
  process.exit(1);
}

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
