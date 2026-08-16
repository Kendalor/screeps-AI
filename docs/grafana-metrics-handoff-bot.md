# Grafana metrics — Part 1: bot-side changes (THIS repo)

## Status: not started (2026-08-16)

Companion doc: `docs/grafana-metrics-handoff-stack.md` (Part 2, the new docker-compose repo). Read
that doc's intro for the full picture — this file only covers work in **this** repository.

**Goal:** shape this bot's `Memory.stats` so an external Grafana stack (Part 2) can graph it. That
stack (`screepers/screeps-grafana`) forwards whatever is in `Memory.stats` to the TSDB **verbatim** —
no schema on its side. All the real work is here: writing the right keys, in the right units, already
computed as sane per-tick values.

**Decision already made:** keep this bot's existing vendored profiler
([`src/lib/profiler.ts`](../src/lib/profiler.ts)) — do not port to a different profiler. This work is
additive: feed its data (and `src/kernel/stats.ts`'s) into `Memory.stats`, not replace it.

## Ground truth verified in this codebase

- `Memory.stats.cpu: Record<string, number>` — last tick's CPU per kernel system name, flushed every
  tick unconditionally by `stats.flush()` (`src/kernel/stats.ts:19-21`). Schema:
  `src/memory/schema.ts:514-517`. **This key already matches the convention** the Grafana side expects
  (a `cpu` sub-object under `Memory.stats`) — likely needs zero reshaping, just confirm the per-system
  key names are ones you actually want to see on a dashboard (they get graphed verbatim, so rename now
  if a key is internal-jargon-y — this is the last easy point to do that).
- `Memory.profiler.data: Record<string, {calls, time}>` — cumulative per-function CPU, only populated
  while the profiler is running (`Profiler.start()`; `src/lib/profiler.ts:135-146`), gated behind the
  compile-time `__PROFILER_ENABLED__` flag (`src/lib/profiler.ts:25`). **This does NOT fit a
  verbatim-forward model as-is** — it's cumulative-since-start, not a per-tick rate. Forwarding it
  straight to `Memory.stats` produces a monotonically-increasing graph, not a useful one.
- `Memory.metrics` (harvest-rate ring buffer, `src/memory/schema.ts:521-523`) and `Memory.market`
  (`src/memory/schema.ts:525-530`) are optional extras — skip for a first cut.
- No existing `Memory.stats`-shaping code beyond `kernel/stats.ts`'s `cpu` key exists yet — confirmed via
  grep. Room/GCL/energy-economy stats (the other things a typical screeps-grafana dashboard expects,
  e.g. `room.<name>.energyAvailable`) are **not currently written anywhere** in this bot and must be
  added if those panels are wanted.

## Build order

### Step 1 — Confirm/rename `Memory.stats.cpu` keys
- Read what `stats.record(system, cpu)` is currently called with across the kernel (grep call sites of
  `stats.record`) and decide if the system names are dashboard-ready as-is. This is config-review, not
  code — only touch it if a name needs cleaning up.
- Done-check: no code change needed unless a rename is wanted.

### Step 2 — Add a per-tick profiler delta (optional, only if per-function CPU panels are wanted)
- Add a small **always-on** accumulator (not gated behind `Profiler.start()` — that command is for the
  human-readable `Profiler.output()` CLI, a separate concern) that computes `current - previous` per
  profiler key each tick and writes the delta into `Memory.stats`, e.g. `Memory.stats.fn[key]`.
- Implement in `src/lib/profiler.ts` (or a small new module next to it) by keeping the previous tick's
  cumulative `{calls, time}` per key in a module-level variable, diffing on each `stats.flush()`-style
  call. Do not push this diffing responsibility onto the external stack (Part 2) — it can't do it
  without reimplementing knowledge of this bot's internals.
- Still respect `__PROFILER_ENABLED__` for whether `Memory.profiler.data` itself exists at all — the
  delta computation only has something to diff when the compile-time flag is on.
- Done-check: `Memory.stats.fn` (or chosen key) shows a small non-negative number per profiled function
  each tick, not a value that only grows.

### Step 3 — Optional: room/economy stats
- Add keys like `Memory.stats.rooms[name].energyAvailable`, controller progress, etc., if those panels
  are wanted on the dashboard.
- Pull from `buildColonySnapshot`'s existing per-tick data (`src/snapshot/colony.ts`) rather than
  re-reading `Game.*` directly — keeps the purity boundary this codebase already enforces (operations
  and pure modules never touch `Game.*`; all live reads happen in `snapshot/colony.ts`). Write the
  `Memory.stats` values from the same tick-end point that already has snapshot data in hand (near
  `stats.flush()`'s call site), not from a new ad hoc `Game.rooms` read.
- Done-check: `Memory.stats.rooms` populated for every owned colony after one tick.

### Step 4 — Verify end to end
- Via the `debug-main`/`debug-local` skill (or console directly), inspect `Memory.stats` on a live tick
  and confirm the full intended shape is present: `cpu`, optionally `fn`, optionally `rooms`.
- This is the handoff point to Part 2 — the stack there just needs `Memory.stats` to look like this.

## Traps to avoid

1. **Don't forward `Memory.profiler.data` verbatim.** It's cumulative-since-start, not a rate — diff it
   here (Step 2), don't leave that problem for the external stack.
2. **Keep the purity boundary.** If Step 3 pulls room/economy data into `Memory.stats`, read from
   `ColonySnapshot`/`buildColonySnapshot` output, not raw `Game.*`.
3. **Confirm `__PROFILER_ENABLED__`** is on in whatever build gets deployed before assuming Step 2's
   delta is broken — it's a compile-time rollup flag, easy to forget was left off, and the symptom
   (empty `Memory.stats.fn`) looks identical to a real bug.
4. **Don't gate the Step 2 delta behind `Profiler.start()`.** That flag controls the human CLI profiler
   session; a Grafana feed should be always-on so the dashboard doesn't go blank whenever nobody
   happens to have typed `Profiler.start()` in console.
