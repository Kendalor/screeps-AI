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
account can have CPU allocated on multiple shards, but this account currently only
runs on **shard0** (owns room **E28S4**, confirmed via `main-check.mjs rooms`); the
other shards show empty room lists. All scripts below default their `shard` argument
to `"shard0"` for that reason, but accept an override if the colony ever expands.
Don't assume shard0 is still correct without checking `rooms` first if it's been a
while — expansions change this.

## Scripts (all pre-built, just run them)

- **`node scripts/main-check.mjs status [shard=shard0]`** — signs in via token,
  prints the shard's current game tick (World ticks are a single global counter in
  the tens of millions — nothing like the pserver's small per-instance tick count,
  don't be surprised by the magnitude), `Memory.stats.cpu`, and profiler summary.
  Cheapest, fastest first check — start here.
- **`node scripts/main-check.mjs rooms`** — lists owned rooms and reservations per
  shard (`{ shards: { shard0: ["E28S4"], shard1: [], ... } }`). Use this to confirm
  which shard(s) actually have colonies before debugging a specific room.
- **`node scripts/main-check.mjs shards`** — raw `/api/game/shards/info`: each
  shard's recent tick durations, `cpuLimit` (0 means this account has no CPU bucket
  there), room/user counts. Useful for "is shard0 actually the active one" sanity
  checks.
- **`node scripts/main-check.mjs start` / `output`** — sends `Profiler.start()` /
  `Profiler.output()` via HTTP (fire-and-forget, doesn't show output — use
  `main-console.mjs` to actually read the result).
- **`node scripts/main-console.mjs "<expression>" [listenSeconds=15] [shard=shard0]`**
  — the *only* way to read back console output. Connects over the Screeps **socket**
  API, subscribes to the console channel, optionally sends `<expression>` scoped to
  `shard`, and prints every `[LOG]`/`[RESULT]` line for `listenSeconds`.

  Example: `node scripts/main-console.mjs "Profiler.output()" 5`

  Omit the expression to just tail whatever the bot is already logging:
  `node scripts/main-console.mjs "" 20`

  **Shard caveat**: the console *channel* itself (`user:<id>/console`) is
  per-account, not per-shard — there is no way to filter received output by shard.
  Sending a command (`api.raw.user.console(expression, shard)`) IS shard-scoped, so
  if the account ever runs code on more than one shard, output from other shards'
  ongoing `console.log` calls will interleave with whatever you just sent. Currently
  moot (only shard0 is active) but don't assume it stays that way.

## In-game console commands (bot-defined, in `src/commands/console.ts`)

Same command set as the local pserver — `setLogLevel(...)`, `debugCreep`/
`undebugCreep`/`debugColony`/`undebugColony`/`clearDebug`/`resetDebug`,
`Profiler.*` (only if the currently-deployed build was pushed with `PROFILE=1`,
see below). See `debug-local`'s SKILL.md for the full behavioral notes on these
(including which files each trace point covers — combat/defense/attack/reservation/
mining decisions, not just spawn requests); they're identical code, just running
against a different deployment. Send them scoped to a shard via `main-console.mjs`,
e.g. `main-console.mjs 'debugCreep("Miner1")' 15 shard0`.

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
- `Memory.empire.operations` — live operation state (confirmed present and
  populated on this account's shard0 memory)

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
