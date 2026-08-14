// pserver diagnostic: authenticate, optionally send a console command, decode Memory, and report
// stats/profiler/error signals. Credentials come from screeps.json's "pserver" entry — the same file
// `npm run push-pserver` already reads — so there's one source of truth for the local server's login.
//
// Usage: node scripts/pserver-check.mjs [status|start|output]
import { readFileSync } from "node:fs";
import zlib from "node:zlib";

const { pserver } = JSON.parse(readFileSync(new URL("../screeps.json", import.meta.url), "utf8"));
const BASE = `${pserver.protocol}://${pserver.hostname}:${pserver.port}`;
const { email, password } = pserver;

async function signIn() {
  const res = await fetch(`${BASE}/api/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`signin failed: ${JSON.stringify(json)}`);
  return json.token;
}

async function getMemory(token) {
  const res = await fetch(`${BASE}/api/user/memory`, { headers: { "X-Token": token, "X-Username": token } });
  const json = await res.json();
  if (!json.data) return {};
  const gz = Buffer.from(json.data.slice(3), "base64");
  return JSON.parse(zlib.gunzipSync(gz).toString("utf8"));
}

async function consoleCmd(token, expression) {
  const res = await fetch(`${BASE}/api/user/console`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Token": token, "X-Username": token },
    body: JSON.stringify({ expression })
  });
  return res.json();
}

async function gameTime() {
  const res = await fetch(`${BASE}/api/game/time`);
  return (await res.json()).time;
}

const mode = process.argv[2] ?? "status";
const token = await signIn();

if (mode === "start") {
  console.log(await consoleCmd(token, "Profiler.start()"));
} else if (mode === "output") {
  console.log(await consoleCmd(token, "Profiler.output()"));
} else if (mode === "status") {
  const time = await gameTime();
  const mem = await getMemory(token);
  console.log("tick:", time);
  console.log("stats.cpu:", JSON.stringify(mem.stats?.cpu, null, 2));
  console.log("profiler:", JSON.stringify({ start: mem.profiler?.start, total: mem.profiler?.total, dataKeys: Object.keys(mem.profiler?.data ?? {}).length }));
}
