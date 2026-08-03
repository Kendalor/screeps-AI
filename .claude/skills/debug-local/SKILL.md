---
name: debug-local
description: Debug the locally-running Screeps private server (pserver) — read Memory/stats/console output, send commands, check errors, control the profiler. Use whenever the user asks to check on, debug, or inspect the live/local Screeps server, or references "the local server", "pserver", or "the bot that's running" (not the real screeps.com World).
---

# Debugging the local pserver

This project runs a real local Screeps private server (`@screeps/launcher`, not the
headless `screeps-server-mockup` used by tests/benchmarks) so the bot can be watched
live in the Steam client. This skill is free to run autonomously — read-only checks
(status, memory, console output) never need confirmation. Only ask first before
anything destructive (see bottom).

If the user means the real screeps.com World server instead, use `debug-main`, not
this skill — the two are unrelated servers with separate credentials and APIs.

## Is it running?

```bash
curl -s http://localhost:21025/api/game/time
```

If that fails to connect, the server isn't up. Start it with `npm run watch:server`
(runs in foreground/background — needs `server/.screepsrc`, see `scripts/watch-server.mjs`
for one-time init instructions if missing). Don't start it yourself without asking —
it's a long-running process the user may already have open in another terminal.

## Credentials & config

`screeps.json`'s `"pserver"` key (email/password/host/port) is the single source of
truth — `push-pserver`, `pserver-check.mjs`, and `pserver-console.mjs` all read it.
Currently: `http://localhost:21025`, user `Kendalor`. Don't print the password back
to the user unnecessarily.

## Scripts (all pre-built, just run them)

- **`node scripts/pserver-check.mjs status`** — signs in, prints current game tick,
  `Memory.stats.cpu` (per-system CPU breakdown, see `src/kernel/stats.ts`), and
  profiler summary (running?, total ticks, how many keys have data). Cheapest,
  fastest first check — start here.
- **`node scripts/pserver-check.mjs start`** — sends `Profiler.start()` via the HTTP
  console endpoint (fire-and-forget, doesn't show output).
- **`node scripts/pserver-check.mjs output`** — sends `Profiler.output()` (also
  fire-and-forget over HTTP — use `pserver-console.mjs` instead if you need to
  actually read the printed table).
- **`node scripts/pserver-console.mjs "<expression>" [listenSeconds=15]`** — the
  *only* way to read back console output. Connects over the Screeps **socket** API
  (not HTTP), subscribes to the console channel, optionally sends `<expression>`,
  and prints every `[LOG]`/`[RESULT]` line for `listenSeconds`. The HTTP
  `/api/user/console` endpoint (`pserver-check.mjs`) only confirms a command was
  *queued* — it never returns what the command printed. Use this for
  `Profiler.output()`, ad-hoc `console.log` probes, error triage, anything where you
  need to see what happened.

  Example: `node scripts/pserver-console.mjs "Profiler.output()" 5`

  Omit the expression to just tail whatever the bot is already logging:
  `node scripts/pserver-console.mjs "" 20`

## In-game console commands (bot-defined, in `src/commands/console.ts`)

- `setLogLevel("error"|"warn"|"info")` — sets `Memory.logLevel`, gates `src/lib/log.ts`'s
  `log.error/warn/info`. Defaults to `"error"` (quiet). Bump to `"info"` via
  `pserver-console.mjs 'setLogLevel("info")'` when chasing a specific bug, then set
  it back to `"error"` afterward — `"info"` is noisy in a long-running colony.
- `debugCreep("<name>")` / `undebugCreep("<name>")` — opt one creep into
  `log.debugCreep` tracing (adds/removes it in `Memory.debugCreeps`). Prints every
  tick that creep's role/step/target/idle decisions from `empire/creeps.ts`'s
  `runOne`, plus task/branch tracing from `behaviors/transport.ts` and
  `behaviors/steward.ts` for transport/supply/steward creeps. Independent of
  `setLogLevel` — fires regardless of the current log level, and only for the named
  creep, so it's safe to leave the global level at `"error"` while tracing one creep.
  Example: `pserver-console.mjs 'debugCreep("Miner1")' 15` then watch for
  `[DEBUG] Miner1: ...` lines.
- `debugColony("<room>")` / `undebugColony("<room>")` — same idea, per colony: traces
  that colony's per-tick spawn-request list (`colony/index.ts`'s `requests()`) via
  `log.debugRoom`, added to `Memory.debugColonies`.
- `clearDebug()` — clears both `Memory.debugCreeps` and `Memory.debugColonies` in one
  call; run this when done tracing so the console doesn't stay noisy.
- `Profiler.start()` / `Profiler.stop()` / `Profiler.status()` / `Profiler.clear()` /
  `Profiler.output()` — only exists if the currently-deployed build was pushed with
  `PROFILE=1` (see below). Calling `Profiler.*` when the normal (non-profiled) build
  is live does nothing useful — `__PROFILER_ENABLED__` compiled the wrapping out
  entirely, so `global.Profiler` was never assigned and the call errors as undefined.

## Reading Memory directly

`pserver-check.mjs`'s `getMemory()` shows the pattern: `GET /api/user/memory` with
`X-Token`/`X-Username` headers, response `.data` is `"gz:" + base64`, strip the
3-char prefix and `zlib.gunzipSync` to get the JSON. Useful fields:
- `Memory.stats.cpu` — per-system CPU from last tick (`src/kernel/stats.ts`)
- `Memory.profiler.{data,start,total}` — raw profiler accumulator
- `Memory.logLevel` — current log gate
- `Memory.debugCreeps` / `Memory.debugColonies` — creeps/colonies currently opted
  into `debugCreep`/`debugColony` tracing above; check these if debug tracing seems
  to have gone quiet (e.g. after a respawn cleared a stale entry) or noisier than
  expected (an old target left enabled from a past session).
- Colony/room memory — whatever the bot's own `src/memory/schema.ts` defines; read
  that file if you need the shape of a specific colony's saved state.

For memory of a *specific room* (not the whole user blob), there's also
`GET /api/game/room-terrain`, `/api/user/memory-segment`, etc. per the standard
Screeps HTTP API — not wrapped by any script here, use `fetch` directly following
`pserver-check.mjs`'s auth pattern if needed.

## Profiling a CPU problem end-to-end

1. Build and push a profiling-enabled bundle: `npm run push-pserver:profile`
   (sets `PROFILE=1`, which flips `__PROFILER_ENABLED__` to `true` in
   `rollup.config.mjs` — every `wrapFn`/`profileClass` call site in the codebase
   actually wraps instead of compiling away; see the big comment atop
   `src/lib/profiler.ts` for why module-level wrapping doesn't work under rollup
   and per-function `wrapFn` was used instead).
2. Start capture: `node scripts/pserver-check.mjs start` (or the console command
   directly).
3. Let it run — profiler data accumulates in `Memory.profiler.data` across ticks
   *and* deploys, so this can run unattended for a long capture window.
4. Read results: `node scripts/pserver-console.mjs "Profiler.output()" 5` — prints a
   table sorted by CPU/tick descending (function, total calls, CPU/call,
   calls/tick, CPU/tick, % of total).
5. When done, redeploy the normal build (`npm run push-pserver`, no `PROFILE=1`) —
   the profiled build has wrapper overhead on every wrapped call, don't leave it
   live long-term.

There's also a throwaway local smoke test for the profiler itself,
`scripts/profiler-smoke.mjs` — boots a headless mockup server (not the live
pserver), runs the profiling bundle, checks for error lines. Useful if
`Profiler.*` seems broken and you want to isolate whether it's a live-server issue
or a profiler-code bug, without touching the real running server.

## Server-side logs (last resort, rarely needed)

`server/logs/` has `storage.log*` and `engine_runner1.log*` (rotated) — the
`@screeps/launcher`'s own process logs, not the bot's `console.log` output (that
only comes through the socket console channel above). Only worth checking for
server-process-level failures (crash, port bind failure), not bot logic bugs.

## Things that need explicit confirmation first

- **`npm run reset:server`** — wipes `server/db.json` back to a fresh empty world
  (restores the launcher's seed db) and deletes `server/logs`. Destroys the
  currently-running colony's entire state. Never run this without the user asking
  for it by name.
- **`npm run watch:server`** — starts the launcher as a long-running foreground
  process; don't start a second instance if one's already up (check with the
  `curl` game-time probe above first), and don't kill an existing one without
  asking.
- Deploying (`push-pserver` / `push-pserver:profile`) overwrites the live bot code
  mid-run. Safe in the sense that it's how iteration normally works, but if the
  user is mid-observation of a specific bug, confirm before redeploying out from
  under them.
