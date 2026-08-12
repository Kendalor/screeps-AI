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
const path = process.argv[2];
const shard = process.argv[3] || 'shard1';
const data = await api.raw.user.memory.get(path, shard).catch(e => ({error: e.message}));
console.log(JSON.stringify(data, null, 2));
