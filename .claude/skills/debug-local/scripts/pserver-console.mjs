import 'dotenv/config';
import { ScreepsAPI } from 'screeps-api';
import screepsConfig from '../../../../screeps.json' with { type: 'json' };

const cfg = screepsConfig.pserver;

const [, , expression, listenSecondsArg] = process.argv;
const listenSeconds = Number(listenSecondsArg) || 15;

const api = new ScreepsAPI({
  email: cfg.email,
  password: cfg.password,
  protocol: cfg.protocol,
  hostname: cfg.hostname,
  port: cfg.port,
  path: cfg.path,
});

await api.auth(cfg.email, cfg.password);

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
    await api.raw.user.console(expression);
    console.log(`[SENT] ${expression}`);
  } catch (e) {
    console.error('[SEND ERROR]', e.message);
  }
}

setTimeout(() => {
  process.exit(0);
}, listenSeconds * 1000);
