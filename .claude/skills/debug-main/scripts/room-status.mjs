import 'dotenv/config';
import { ScreepsAPI } from 'screeps-api';
import screepsConfig from '../../../../screeps.json' with { type: 'json' };

const cfg = screepsConfig.main;
function resolveEnv(value) {
  const match = /^\$\{(\w+)\}$/.exec(value);
  if (!match) return value;
  return process.env[match[1]];
}
const api = new ScreepsAPI({
  token: resolveEnv(cfg.token),
  protocol: cfg.protocol,
  hostname: cfg.hostname,
  port: cfg.port,
  path: cfg.path,
});

const shard = process.argv[2] || 'shard1';
const rooms = process.argv.slice(3);
for (const r of rooms) {
  const res = await api.raw.game.roomStatus(r, shard).catch(e => ({ error: e.message }));
  console.log(r, JSON.stringify(res));
}
