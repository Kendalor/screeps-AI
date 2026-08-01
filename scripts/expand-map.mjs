// Grows the local pserver's map by generating new rooms via the admin CLI
// (map.generateRoom — a top-level CLI sandbox global, see
// node_modules/@screeps/backend/lib/cli/sandbox.js). World size isn't a
// config value on @screeps/launcher servers — Game.map.getWorldSize() is
// just the bounding box of whatever rooms exist in db.rooms, recomputed on
// driver init. This talks to the CLI's raw TCP line protocol
// (server/.screepsrc's cli_port, default 21026), the same socket
// `screeps-launcher cli` connects to interactively — see
// node_modules/@screeps/launcher/lib/cli.js.
//
// generateRoom requires each new room's exits to match any already-generated
// neighbor, so grow the map from an edge outward (e.g. add a new column of
// W11 rooms next to the existing W10 column) rather than scattering rooms.
//
// Usage:
//   node scripts/expand-map.mjs W11N0 W11N1 W11N2 ... W11N10
//   node scripts/expand-map.mjs --file <path-to-json-array-of-room-names>
//
// After expanding, bake the change into the reset seed so `npm run
// reset:server` doesn't wipe it back to the stock 11x11 grid:
//   npm run reseed:server
import net from "node:net";
import process from "node:process";
import { readFileSync } from "node:fs";

const HOST = "localhost";
const PORT = 21026;

const fileFlagIndex = process.argv.indexOf("--file");
const roomNames =
  fileFlagIndex >= 0
    ? JSON.parse(readFileSync(process.argv[fileFlagIndex + 1], "utf8"))
    : process.argv.slice(2);

if (roomNames.length === 0) {
  console.error("Usage: node scripts/expand-map.mjs <roomName> [roomName...]");
  console.error("       node scripts/expand-map.mjs --file <path-to-json-array>");
  console.error('Example: node scripts/expand-map.mjs W11N0 W11N1 W11N2');
  process.exit(1);
}

const roomNamePattern = /^[WE]\d+[NS]\d+$/;
for (const name of roomNames) {
  if (!roomNamePattern.test(name)) {
    console.error(`Invalid room name: ${name}`);
    process.exit(1);
  }
}

// Each server reply (connect banner, and every command result) arrives as
// one write ending in "\r\n" — see node_modules/@screeps/backend/lib/cli/server.js:
// a result is written as `(isResult ? "< " : "") + data + "\r\n"`, so "< " is
// a PREFIX on the same line as the result, not a trailing prompt on its own
// line. We just wait for a chunk ending in "\r\n" after writing the command.
function readReply(socket) {
  return new Promise((resolve, reject) => {
    let output = "";
    const onError = err => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("data", onData);
      socket.off("error", onError);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for CLI response"));
    }, 15000);
    const onData = data => {
      output += data.toString("utf8");
      if (!output.endsWith("\r\n")) {
        return;
      }
      cleanup();
      resolve(output);
    };
    socket.on("data", onData);
    socket.on("error", onError);
  });
}

async function runCliCommand(socket, command) {
  const replyPromise = readReply(socket);
  socket.write(command + "\r\n");
  return replyPromise;
}

const socket = net.connect(PORT, HOST);

socket.on("connect", async () => {
  let ok = 0;
  let skipped = 0;
  let failed = 0;
  try {
    // Discard the connect banner before issuing real commands.
    await readReply(socket);
    console.log(`Connected to admin CLI on ${HOST}:${PORT}. Generating ${roomNames.length} room(s)...`);

    for (let i = 0; i < roomNames.length; i++) {
      const roomName = roomNames[i];
      const output = await runCliCommand(socket, `map.generateRoom("${roomName}")`);
      const cleaned = output.replace(/\r/g, "").replace(/^< /, "").trim();

      if (cleaned === "'OK'") {
        ok++;
      } else if (/already exists/.test(cleaned)) {
        skipped++;
      } else {
        failed++;
        console.log(`[${i + 1}/${roomNames.length}] ${roomName}: ${cleaned}`);
      }

      if ((i + 1) % 50 === 0 || i === roomNames.length - 1) {
        console.log(`[${i + 1}/${roomNames.length}] created=${ok} skipped=${skipped} failed=${failed}`);
      }
    }
  } catch (err) {
    console.error("CLI command failed:", err);
    process.exitCode = 1;
  } finally {
    console.log(`Done. created=${ok} skipped=${skipped} failed=${failed}`);
    socket.end();
  }
});

socket.on("error", err => {
  console.error(`Could not connect to admin CLI on ${HOST}:${PORT}: ${err.message}`);
  console.error("Is the server running (`npm run watch:server`)?");
  process.exit(1);
});
