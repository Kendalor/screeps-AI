import 'dotenv/config';
import zlib from 'zlib';
import { ScreepsAPI } from 'screeps-api';
import screepsConfig from '../../../../screeps.json' with { type: 'json' };

const cfg = screepsConfig.pserver;

async function getApi() {
  const api = await ScreepsAPI.fromConfig('pserver', undefined, { configPath: '../../../../screeps.json' }).catch(() => null);
  if (api) return api;
  const direct = new ScreepsAPI({
    email: cfg.email,
    password: cfg.password,
    protocol: cfg.protocol,
    hostname: cfg.hostname,
    port: cfg.port,
    path: cfg.path,
  });
  await direct.auth(cfg.email, cfg.password);
  return direct;
}

async function getMemory(api) {
  const res = await api.raw.user.memory.get();
  const data = res?.data;
  if (!data) return null;
  if (typeof data !== 'string') return data;
  if (data.startsWith('gz:')) {
    const buf = Buffer.from(data.slice(3), 'base64');
    return JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
  }
  return JSON.parse(data);
}

async function cmdStatus() {
  const api = await getApi();
  const time = await api.raw.game.time();
  const memory = await getMemory(api);
  console.log('Time:', JSON.stringify(time, null, 2));
  console.log('Memory.stats.cpu:', JSON.stringify(memory?.stats?.cpu, null, 2));
  console.log('Memory.profiler:', JSON.stringify(memory?.profiler ? {
    running: !!memory.profiler.start,
    total: memory.profiler.total,
    keys: memory.profiler.data ? Object.keys(memory.profiler.data).length : 0,
  } : undefined, null, 2));
}

async function cmdMemory(path) {
  const api = await getApi();
  const memory = await getMemory(api);
  if (!path) {
    console.log(JSON.stringify(memory, null, 2));
    return;
  }
  const value = path.split('.').reduce((o, k) => (o == null ? o : o[k]), memory);
  console.log(JSON.stringify(value, null, 2));
}

async function cmdProfilerControl(action) {
  const api = await getApi();
  const expr = action === 'start' ? 'Profiler.start()' : 'Profiler.output()';
  await api.raw.user.console(expr);
  console.log(`Sent: ${expr}`);
}

async function cmdConsole(expr) {
  const api = await getApi();
  await api.raw.user.console(expr);
  console.log(`Sent: ${expr}`);
}

const [, , cmd, arg1] = process.argv;

try {
  switch (cmd) {
    case 'status':
      await cmdStatus();
      break;
    case 'memory':
      await cmdMemory(arg1);
      break;
    case 'start':
    case 'output':
      await cmdProfilerControl(cmd);
      break;
    case 'send':
      await cmdConsole(arg1);
      break;
    default:
      console.error('Usage: pserver-check.mjs <status|memory [path]|start|output|send "<expr>">');
      process.exit(1);
  }
} catch (e) {
  console.error('Error:', e.message);
  process.exit(1);
}
