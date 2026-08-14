---
name: debug-main
description: Debug the bot running on the real Screeps World server (screeps.com) — read Memory/stats/console output, send console commands, check owned rooms, list shard status. Use whenever the user asks to check on, debug, or inspect "the main server", "the World server", "screeps.com", "the real server", or "prod" (as opposed to the local pserver — that's debug-local).
---

# Debugging the World server (screeps.com)

This is the real, official Screeps MMO server — a completely separate deployment
target from the local pserver (`debug-local`). Same bot code, different destination:
`npm run push-main` (vs `push-pserver`), different auth (token, not email/password),
and it's **sharded** — the World is partitioned into shard0/shard1/shard2/shard3/shardX,
each an independent persistent world with its own tick counter and rooms. This skill
is free to run autonomously for read-only checks (status, memory, console output,
rooms, shard list). Only ask first before anything destructive (see bottom) — and
remember this is the user's real production colony, not a disposable test instance.

If the user means the local Steam-client server instead, use `debug-local`, not this
skill.

## Credentials & config

`screeps.json`'s `"main"` key holds `hostname`/`port`/`protocol` (screeps.com, 443,
https) — the same file `npm run push-main` reads. Auth is a **token**, not
email/password: `SCREEPS_TOKEN` in `.env` (loaded via `dotenv/config`), the same
token `push-main` already uses to deploy. Don't print the token back to the user
unnecessarily.

## Which shard?

Check `Memory.stats.cpu` / `cpuShard` on the account before assuming — a World
account can have CPU allocated on multiple shards. As of 2026-08-10 this account
runs on **shard1**, owning rooms **W47N14** (home) and **W43N15** (colonize
target); shard0's old colony (**E28S4**) was fully relocated away and shard0 now
shows an empty room list. Prefer passing `shard1` explicitly on every script call
below rather than trusting a hardcoded default — the account has already moved
shards once (shard0 → shard1, 2026-08-09) and the scripts' own defaults can go
stale exactly the way this note almost did. Re-confirm with `main-check.mjs rooms`
first if it's been a while — expansions/relocations change this.

## Scripts (all pre-built, just run them)

- **`node scripts/main-check.mjs status [shard=shard1]`** — signs in via token,
  prints the shard's current game tick (World ticks are a single global counter in
  the tens of millions — nothing like the pserver's small per-instance tick count,
  don't be surprised by the magnitude), `Memory.stats.cpu`, and profiler summary.
  Cheapest, fastest first check — start here.
- **`node scripts/main-check.mjs rooms`** — lists owned rooms and reservations per
  shard (`{ shards: { shard0: [], shard1: ["W47N14", "W43N15"], ... } }`). Use this
  to confirm which shard(s) actually have colonies before debugging a specific room
  — the source of truth if this doc's shard note above ever goes stale again.
- **`node scripts/main-check.mjs shards`** — raw `/api/game/shards/info`: each
  shard's recent tick durations, `cpuLimit` (0 means this account has no CPU bucket
  there), room/user counts. Useful for "is shard1 actually the active one" sanity
  checks.
- **`node scripts/main-check.mjs start` / `output`** — sends `Profiler.start()` /
  `Profiler.output()` via HTTP (fire-and-forget, doesn't show output — use
  `main-console.mjs` to actually read the result).
- **`node scripts/main-console.mjs "<expression>" [listenSeconds=15] [shard=shard1]`**
  — the *only* way to read back console output. Connects over the Screeps **socket**
  API, subscribes to the console channel, optionally sends `<expression>` scoped to
  `shard`, and prints every `[LOG]`/`[RESULT]` line for `listenSeconds`.

  Example: `node scripts/main-console.mjs "Profiler.output()" 5`

  Omit the expression to just tail whatever the bot is already logging:
  `node scripts/main-console.mjs "" 20`

  **Known issue (unconfirmed root cause, 2026-08-10)**: this socket path was
  observed returning nothing at all — no `[LOG]`/`[RESULT]` lines, not even for a
  trivial `"1+1"` expression sent with a 15s listen window — while the account's
  active shard was still misidentified as shard0 (the real colony was on shard1).
  Not yet re-tested against shard1 directly; if it's still silent there, the socket
  wiring itself needs debugging (subscribe ack, auth timing) rather than assuming
  it works. `main-check.mjs`'s HTTP-based memory reads are unaffected and remain
  reliable regardless.

  **Shard caveat**: the console *channel* itself (`user:<id>/console`) is
  per-account, not per-shard — there is no way to filter received output by shard.
  Sending a command (`api.raw.user.console(expression, shard)`) IS shard-scoped, so
  if the account ever runs code on more than one shard, output from other shards'
  ongoing `console.log` calls will interleave with whatever you just sent. Currently
  moot (only shard1 is active) but don't assume it stays that way.
- **`node scripts/get-memory-path.mjs "<dot.path>" [shard=shard1]`** — thin wrapper
  around `api.raw.user.memory.get(path, shard)`, same underlying call
  `main-check.mjs status` uses for `stats.cpu`/`profiler` but for an arbitrary path.
  Use this for anything not already covered by `main-check.mjs`'s fixed fields, e.g.
  `get-memory-path.mjs "colonies.W47N14.colonizing"` or a specific creep's memory
  (`get-memory-path.mjs "creeps.<name>"`). Root path (`""`) does not work — the API
  errors with "Incorrect memory path" for the whole-Memory case; always pass a real
  dot-path. This was the reliable fallback for reading live state while
  `main-console.mjs` was silently returning nothing (see known issue above).
- **`node scripts/get-room-objects.mjs [shard=shard1] <roomName>`** — raw
  `api.raw.game.roomObjects(room, shard)`: every creep/structure/source/etc
  currently in a room, full object dump (creep body parts, store contents,
  `_id`s, `memory_*` fields on NPC creeps). Useful for checking a specific
  creep's live position/hits/fatigue without needing vision-dependent bot Memory,
  or for confirming what's actually in a room (keeper lairs, hostiles) independent
  of what the bot last scouted.

## In-game console commands (bot-defined, in `src/commands/console.ts`)

Same command set as the local pserver — full reference, with what each command's
output actually means, is in **`docs/console-commands.md`**; `help()` run live
always lists whatever's currently registered if the doc ever drifts. Covers debug
tracing (`setLogLevel`, `debugCreep`/`debugColony`/`clearDebug`/`resetDebug`),
construction/spawn inspection (`buildPlan`, `remoteStatus`, `miningClaims`,
`spawnLoad`), and operation targeting (`operationKinds`, `colonizeTargets`,
`clearDrainTarget`, `removeOperation`) — plus `Profiler.*` (only if the
currently-deployed build was pushed with `PROFILE=1`, see below). They're
identical code to the pserver's, just running against a different deployment.
Send them scoped to a shard via `main-console.mjs`, e.g.
`main-console.mjs 'debugCreep("Miner1")' 15 shard1` or
`main-console.mjs "buildPlan('W43N15')" 15 shard1`. (See the console script's own
"known issue" note above if nothing comes back.)

Same "real production colony" caution applies here as everywhere else in this
file: `debugCreep`/`debugColony`/`clearDebug`/`resetDebug` are read-only-ish (they
only toggle what gets logged, spend no resources) so they're safe to run freely,
but tracing prints every tick and adds a small amount of CPU/console-channel
noise — remember to `resetDebug()` when done (one call undoes everything, instead
of separately undoing `setLogLevel`/`debugCreep`/`setDebugMetrics` calls left over
from an earlier session) rather than leaving it live indefinitely.

## Reading Memory directly

`main-check.mjs status` already decodes this via the `screeps-api` npm package's
`api.raw.user.memory.get(path, shard)` — unlike the pserver's raw-HTTP script, no
manual gunzip is needed, the library handles decompression internally and returns
parsed JSON directly in `.data`. If you need a different path than the whole blob,
`api.raw.user.memory.get(path, shard)` accepts a dot-path directly (World-only
optimization — avoids pulling the whole Memory object over the wire for one field).

Useful fields (same shape the bot itself defines, see `src/memory/schema.ts`):
- `Memory.stats.cpu` — per-system CPU from last tick (`src/kernel/stats.ts`)
- `Memory.profiler.{data,start,total}` — raw profiler accumulator
- `Memory.logLevel` — current log gate
- `Memory.debugCreeps` / `Memory.debugColonies` — creeps/colonies currently opted
  into `debugCreep`/`debugColony` tracing (see above)
- `Memory.colonies.<roomName>` — the actual per-colony memory root (remotes,
  colonizing/attacking/draining targets, source/link state, etc — see
  `src/memory/schema.ts`'s `ColonyMemory`). Confirmed populated on shard1 for both
  `W47N14` and `W43N15`.
- `Memory.empire.operations` — a DIFFERENT, older empire/operations-style memory
  shape (flaglistener/scoutingManager/tradingOperation, no `Colony`/`colonizing`
  concept). This was what a stale pre-`rewrite`-branch World deploy was still
  running as of 2026-08-10 — if this key has content but `Memory.colonies` is
  empty, that's a sign the deployed build predates the `rewrite` branch's
  Colony/ColonyMemory architecture and needs a fresh `push-main`, not a shard
  mixup. Don't assume this key is still meaningful without checking which build is
  actually live first.

## Profiling a CPU problem end-to-end

Same flow as `debug-local`, but against World:

1. `npm run push-main:profile` if that script exists — **check `package.json`
   first**, only `push-pserver:profile` is confirmed to exist as of this writing.
   If there's no profiled `push-main` variant, build one manually:
   `rollup -c --environment DEST:main,PROFILE:1`.
2. Start capture: `node scripts/main-check.mjs start`.
3. Let it run — profiler data accumulates in `Memory.profiler.data` across ticks
   and deploys.
4. Read results: `node scripts/main-console.mjs "Profiler.output()" 5`.
5. **Redeploy the normal build immediately after** (`npm run push-main`, no
   `PROFILE=1`) — this is the user's real, running colony; don't leave wrapper
   overhead live any longer than needed for the capture.

## Things that need explicit confirmation first

- **`npm run push-main` / any profiled variant** — overwrites the bot code
  actually running the user's real World colony, live, mid-tick. Far higher stakes
  than `push-pserver`: a bad deploy here can lose CPU bucket, stall the economy, or
  brick a room with no local safety net to reset. Always confirm before deploying
  to `main`, even for something that seems like a trivial fix — this isn't implied
  by "iteration normally works" the way pserver deploys are.
- **Any console command that mutates state** (`Game.market.*`, spawn/build intents
  run ad-hoc, memory writes via `api.raw.user.memory.set`) — read-only status/memory
  checks and log-level toggles are fine to run freely; anything that spends
  resources, credits, or CPU bucket on the real account needs a confirm first.
- There is no `reset:server` equivalent and there never should be — this is the
  real World, not a disposable local seed. Don't build or suggest one.
