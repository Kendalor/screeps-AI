import 'dotenv/config';
import { ScreepsAPI } from 'screeps-api';
import screepsConfig from '../../../../screeps.json' with { type: 'json' };
const cfg = screepsConfig.main;
function resolveEnv(value) {
  const match = /^\$\{(\w+)\}$/.exec(value);
  if (!match) return value;
  return process.env[match[1]];
}
const api = new ScreepsAPI({ token: resolveEnv(cfg.token), protocol: cfg.protocol, hostname: cfg.hostname, port: cfg.port, path: cfg.path });
const shard = process.argv[2] || 'shard1';
const room = process.argv[3];
const res = await api.raw.game.roomObjects(room, shard).catch(e => ({error: e.message}));
console.log(JSON.stringify(res, null, 2));
