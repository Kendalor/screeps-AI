import 'dotenv/config';
import { ScreepsAPI } from 'screeps-api';
import screepsConfig from '../../../../screeps.json' with { type: 'json' };

const cfg = screepsConfig.main;

function resolveEnv(value) {
  const match = /^\$\{(\w+)\}$/.exec(value);
  if (!match) return value;
  const resolved = process.env[match[1]];
  if (!resolved) throw new Error(`Missing env var ${match[1]}`);
  return resolved;
}

async function getApi() {
  const api = new ScreepsAPI({
    token: resolveEnv(cfg.token),
    protocol: cfg.protocol,
    hostname: cfg.hostname,
    port: cfg.port,
    path: cfg.path,
  });
  return api;
}

const SHARDS = ['shard0', 'shard1', 'shard2', 'shard3', 'shardX'];

async function cmdStatus(shard = 'shard0') {
  const api = await getApi();
  const memory = await api.raw.user.memory.get('stats.cpu', shard).catch((e) => ({ error: e.message }));
  const profiler = await api.raw.user.memory.get('profiler', shard).catch((e) => ({ error: e.message }));
  const shardsInfo = await api.raw.game.shards.info();
  const thisShard = shardsInfo.shards?.find((s) => s.name === shard);
  console.log('Shard info:', JSON.stringify(thisShard, null, 2));
  console.log('Memory.stats.cpu:', JSON.stringify(memory, null, 2));
  console.log('Memory.profiler:', JSON.stringify(profiler, null, 2));
}

async function cmdRooms() {
  const api = await getApi();
  const me = await api.raw.auth.me();
  const res = await api.raw.user.rooms(me._id);
  console.log(JSON.stringify(res, null, 2));
}

async function cmdShards() {
  const api = await getApi();
  const info = await api.raw.game.shards.info();
  console.log(JSON.stringify(info, null, 2));
}

async function cmdProfilerControl(action) {
  const api = await getApi();
  const expr = action === 'start' ? 'Profiler.start()' : 'Profiler.output()';
  const shard = process.argv[3] || 'shard0';
  await api.raw.user.console(expr, shard);
  console.log(`Sent: ${expr} (shard ${shard})`);
}

const [, , cmd, arg1] = process.argv;

try {
  switch (cmd) {
    case 'status':
      await cmdStatus(arg1 || 'shard0');
      break;
    case 'rooms':
      await cmdRooms();
      break;
    case 'shards':
      await cmdShards();
      break;
    case 'start':
    case 'output':
      await cmdProfilerControl(cmd);
      break;
    default:
      console.error('Usage: main-check.mjs <status|rooms|shards|start|output> [shard]');
      process.exit(1);
  }
} catch (e) {
  console.error('Error:', e.message);
  process.exit(1);
}
