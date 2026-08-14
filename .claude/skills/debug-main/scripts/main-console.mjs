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

const [, , expression, listenSecondsArg, shardArg] = process.argv;
const listenSeconds = Number(listenSecondsArg) || 15;
const shard = shardArg || 'shard1';

const api = new ScreepsAPI({
  token: resolveEnv(cfg.token),
  protocol: cfg.protocol,
  hostname: cfg.hostname,
  port: cfg.port,
  path: cfg.path,
});

// Ensure token/userID cached before opening the socket.
await api.raw.auth.me();

api.socket.on('message', (event) => {
  if (event.channel !== 'console') return;
  const payload = event.data;
  const logs = payload?.messages?.log || [];
  for (const line of logs) console.log('[LOG]', line);
  const results = payload?.messages?.results || [];
  for (const line of results) console.log('[RESULT]', line);
  if (payload?.error) console.log('[ERROR]', payload.error);
});

api.socket.on('error', (err) => {
  console.error('[SOCKET ERROR]', err.message || err);
});

await api.socket.connect();
await api.socket.subscribe('console');

if (expression) {
  try {
    await api.raw.user.console(expression, shard);
    console.log(`[SENT] ${expression} (shard ${shard})`);
  } catch (e) {
    console.error('[SEND ERROR]', e.message);
  }
}

setTimeout(() => {
  process.exit(0);
}, listenSeconds * 1000);
