// pserver diagnostic: connect via the Screeps socket API, subscribe to console output, optionally
// send a command, and print everything received for N seconds — the only way to read back a console
// command's console.log output (the HTTP /api/user/console endpoint only confirms the command queued).
// Credentials come from screeps.json's "pserver" entry, same as scripts/pserver-check.mjs.
//
// Usage: node scripts/pserver-console.mjs ["<console expression>"] [listenSeconds=15]
import { readFileSync } from "node:fs";
import { ScreepsAPI } from "screeps-api";

const { pserver } = JSON.parse(readFileSync(new URL("../screeps.json", import.meta.url), "utf8"));

const cmd = process.argv[2]; // optional console expression to send after connecting
const listenSeconds = Number(process.argv[3] ?? 15);

const api = new ScreepsAPI({
  protocol: pserver.protocol,
  hostname: pserver.hostname,
  port: pserver.port,
  path: "/"
});

await api.auth(pserver.email, pserver.password);
console.log("Authenticated.");

await api.socket.connect();
console.log("Socket connected.");

api.socket.on("console", event => {
  const { messages, results } = event.data ?? {};
  for (const line of messages?.log ?? []) console.log("[LOG]", line);
  for (const line of messages?.results ?? []) console.log("[RESULT]", line);
  if (results) for (const r of results) console.log("[RESULT]", r);
});

api.socket.subscribe("console");

if (cmd) {
  console.log(`Sending: ${cmd}`);
  await api.console(cmd);
}

await new Promise(r => setTimeout(r, listenSeconds * 1000));
process.exit(0);
