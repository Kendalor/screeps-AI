// World-server diagnostic: authenticate via token, optionally send a console command, decode Memory,
// and report stats/profiler/error signals — the World-server equivalent of pserver-check.mjs.
// Credentials come from screeps.json's "main" entry (hostname/port only) plus SCREEPS_TOKEN from
// the environment (see .env) — the same token `npm run push-main` already uses.
//
// Usage: node scripts/main-check.mjs [status|start|output] [shard=shard0]
import "dotenv/config";
import { readFileSync } from "node:fs";
import { ScreepsAPI } from "screeps-api";

const { main } = JSON.parse(readFileSync(new URL("../screeps.json", import.meta.url), "utf8"));
const token = process.env.SCREEPS_TOKEN;
if (!token) throw new Error("SCREEPS_TOKEN not set (check .env)");

const mode = process.argv[2] ?? "status";
const shard = process.argv[3] ?? "shard0";

const api = new ScreepsAPI({
  token,
  protocol: main.protocol,
  hostname: main.hostname,
  port: main.port,
  path: "/"
});

async function consoleCmd(expression) {
  return api.raw.user.console(expression, shard);
}

if (mode === "start") {
  console.log(await consoleCmd("Profiler.start()"));
} else if (mode === "output") {
  console.log(await consoleCmd("Profiler.output()"));
} else if (mode === "rooms") {
  const id = await api.userID();
  console.log(JSON.stringify(await api.raw.user.rooms(id), null, 2));
} else if (mode === "shards") {
  console.log(JSON.stringify(await api.raw.game.shards.info(), null, 2));
} else if (mode === "status") {
  const time = await api.raw.game.time(shard);
  const mem = await api.raw.user.memory.get("", shard);
  console.log("shard:", shard);
  console.log("tick:", time.time);
  console.log("stats.cpu:", JSON.stringify(mem.data?.stats?.cpu, null, 2));
  console.log(
    "profiler:",
    JSON.stringify({
      start: mem.data?.profiler?.start,
      total: mem.data?.profiler?.total,
      dataKeys: Object.keys(mem.data?.profiler?.data ?? {}).length
    })
  );
}
