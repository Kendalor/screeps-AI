// World-server console tail: connect via the Screeps socket API, subscribe to console output for a
// specific shard, optionally send a command, and print everything received for N seconds — the
// World-server equivalent of pserver-console.mjs (the HTTP /api/user/console endpoint only confirms
// a command queued, it never returns what it printed).
// Credentials: screeps.json's "main" entry (hostname/port) + SCREEPS_TOKEN from the environment.
//
// Usage: node scripts/main-console.mjs ["<console expression>"] [listenSeconds=15] [shard=shard0]
import "dotenv/config";
import { readFileSync } from "node:fs";
import { ScreepsAPI } from "screeps-api";

const { main } = JSON.parse(readFileSync(new URL("../screeps.json", import.meta.url), "utf8"));
const token = process.env.SCREEPS_TOKEN;
if (!token) throw new Error("SCREEPS_TOKEN not set (check .env)");

const cmd = process.argv[2]; // optional console expression to send after connecting
const listenSeconds = Number(process.argv[3] ?? 15);
const shard = process.argv[4] ?? "shard0";

const api = new ScreepsAPI({
  token,
  protocol: main.protocol,
  hostname: main.hostname,
  port: main.port,
  path: "/"
});

await api.socket.connect();
console.log("Socket connected.");

api.socket.on("console", event => {
  // The console channel is per-user, not per-shard — shard filtering isn't available here,
  // so this prints console output from whichever shard is actually running code (with cpuLimit > 0).
  const { messages, results } = event.data ?? {};
  for (const line of messages?.log ?? []) console.log("[LOG]", line);
  for (const line of messages?.results ?? []) console.log("[RESULT]", line);
  if (results) for (const r of results) console.log("[RESULT]", r);
});

api.socket.subscribe("console");

if (cmd) {
  console.log(`Sending (${shard}): ${cmd}`);
  await api.raw.user.console(cmd, shard);
}

await new Promise(r => setTimeout(r, listenSeconds * 1000));
process.exit(0);
