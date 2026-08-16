# Grafana metrics — Part 1: bot-side changes (THIS repo)

## Status: bot-side done (2026-08-16); dashboard JSON drafted, unverified against a live stack

Companion doc: `docs/grafana-metrics-handoff-stack.md` (Part 2, the new docker-compose repo). Read
that doc's intro for the full picture — this file only covers work in **this** repository.

**Goal:** shape this bot's `Memory.stats` so an external Grafana stack (Part 2) can graph it. That
stack is `screepers/screeps-grafana` — a **Graphite** stack (StatsD + Graphite + Grafana), not
InfluxDB. Its poller (`src/ScreepsStatsd.js`) walks `Memory.stats` recursively: any nested object is
descended into with a dotted prefix, any leaf (non-object) value becomes `client.gauge(path, value)`.
So a nested shape like `Memory.stats.rooms.W5N5.census.miner.current` is fully supported and lands in
Graphite as `stats.gauges.rooms.W5N5.census.miner.current` (the `stats.gauges.` prefix comes from
node-statsd's default, confirmed against the project's own `sampleDashboard.json` targets).

**Decision already made:** keep this bot's existing vendored profiler
([`src/lib/profiler.ts`](../src/lib/profiler.ts)) — do not port to a different profiler. This work is
additive: feed `kernel/stats.ts`'s data into `Memory.stats`, not replace it.

**Decision (2026-08-16): gauges only, no bot-side rate/delta computation anywhere in `Memory.stats`.**
Graphite/Grafana can compute `derivative()`/`nonNegativeDerivative()` over a raw gauge itself — see the
sample dashboard's own `derivative(stats.gauges.time)` usage. This simplified two things:
- Step 2 (profiler per-function delta) is **skipped entirely** — forwarding
  `Memory.profiler.data` cumulative would still need `__PROFILER_ENABLED__` + `Profiler.start()`
  wiring for no real benefit under the gauges-only model, and nothing currently reads it. Revisit only
  if a per-function CPU panel is actually wanted later.
- Step 3's room stats are plain point-in-time levels, not diffed.

## What's actually in `Memory.stats` now

Written by [`kernel/stats.ts`](../src/kernel/stats.ts)'s `flush()`, called once at the end of
[`kernel/tick.ts`](../src/kernel/tick.ts)'s `tick()`:

- `Memory.stats.cpu: Record<string, number>` — last tick's CPU per kernel system name (unchanged from
  before this work; names were already dashboard-ready, no rename needed).
- `Memory.stats.bucket: number` — `Game.cpu.bucket` at tick end.
- `Memory.stats.commit: string` — short git hash of the deployed build. See "Commit tracking" below.
- `Memory.stats.rooms: Record<string, RoomStats>` — one entry per owned colony, written by
  [`colony/index.ts`](../src/colony/index.ts)'s `metrics()` (a tier-3 `SYSTEMS` entry, so `Memory.stats`
  is always initialized by `migrateMemory()` before this runs). Schema:
  [`src/memory/schema.ts`](../src/memory/schema.ts)'s `RoomStats`:
  - `energyAvailable`, `energyCapacity`, `storageEnergy` — energy levels.
  - `spawnLoad` — required parts / spawn capacity fraction; >= 1 means spawns can't keep up.
  - `controllerLevel`, `controllerProgress`, `controllerProgressTotal` — RCL and upgrade progress.
  - `census: Record<role, {current, desired}>` — alive count vs. operation-reported target per role.
  - `buildings: Record<structureType, {built, targeted}>` — build-out status per structure type at the
    current plan.
  - `numRemotes` — distinct rooms among this colony's currently-selected remote sources.
  - Deliberately **excluded** per user decision: construction *progress points* remaining
    (`ColonyMetrics.construction`) and repair decay (`ColonyMetrics.repair`) — buildings-built-count
    already answers "what's outstanding" without a second progress-points view.

All of `RoomStats` is mirrored from `ColonyMetrics` (`colony/metrics.ts`'s `collectMetrics`, already
computed every tick for the in-game panel) plus `this.snapshot.remoteSources` for `numRemotes` — no new
`Game.*` reads, purity boundary intact (operations/pure modules never touch `Game.*`; only
`snapshot/colony.ts` does).

## Commit tracking

**Feature:** `Memory.stats.commit` identifies which deployed build produced a given tick's stats, so a
Grafana panel can show *when* a metric shifted and cross-reference that against which commit was live —
this project doesn't tag releases/versions otherwise.

- [`rollup.config.mjs`](../rollup.config.mjs) resolves `git rev-parse --short HEAD` at build time (falls
  back to `"unknown"` if git isn't available) and substitutes it into a new compile-time constant
  `__GIT_COMMIT__`, the same `@rollup/plugin-replace` mechanism `__PROFILER_ENABLED__` already uses.
  Baked into **every** build (not gated behind `PROFILE=1`) — this is meant to be always-on.
- [`kernel/stats.ts`](../src/kernel/stats.ts) declares `__GIT_COMMIT__` and writes it into
  `Memory.stats.commit` on every `flush()`.
- All four `vitest.*.config.ts` files define `__GIT_COMMIT__: '"test"'` alongside their existing
  `__PROFILER_ENABLED__: "false"`, so importing `src/` under test doesn't throw on the undeclared global.
- Verified: a plain `npx rollup -c` build embeds the literal short hash directly in `dist/main.js`.

## Dashboard JSON

[`grafana/dashboard.json`](../grafana/dashboard.json) — modern Grafana schema (`schemaVersion: 39`,
`gridPos`-based panels, not the old `rows`/`hideControls` layout `screeps-grafana`'s own
`sampleDashboard.json` ships, which is a pre-Grafana-5 export). Targets a Graphite datasource named via
the `${DS_GRAPHITE}` variable (set this to the actual datasource UID on import, or use Grafana's
datasource-variable convention when provisioning).

Panels:
- CPU per system (`stats.gauges.cpu.*`, stacked).
- Bucket over time + latest-value stat.
- Deployed commit (latest-value stat, `stats.gauges.commit`).
- A `Deploys` annotation layer sourced from `stats.gauges.commit` — marks a vertical line whenever the
  running commit changes, so a sudden shift in any other panel can be visually correlated to a deploy.
- Per-room panels (repeated over a `$room` template variable, `stats.gauges.rooms.*`): energy levels,
  controller, spawn load gauge, census (alive-only and alive-vs-desired), buildings (built-vs-targeted),
  remotes count.

**Not yet verified against a live stack** — this repo has no running Graphite/Grafana instance to import
against. Before trusting it:
1. Confirm the annotation panel's `target`/`textField` shape actually renders deploy markers the way
   modern Grafana's Graphite datasource expects — annotation-from-metric-query support was inferred from
   general Grafana/Graphite conventions, not tested here.
2. Confirm `stats.gauges.rooms.*` (the `room` template variable's query) returns room names and not some
   other path segment — depends on Graphite's actual indexed tree once real data lands.
3. Import into Part 2's stack once it exists (see the companion doc) and check every panel populates.

## Traps to avoid

1. **Don't forward `Memory.profiler.data` verbatim without understanding it's cumulative-since-start.**
   Moot for now since Step 2 is skipped, but if a per-function panel is added later, either diff it
   bot-side or use a Graphite `derivative()` in the panel query — don't assume the raw value is a rate.
2. **Keep the purity boundary.** Room/economy data in `Memory.stats.rooms` must keep flowing from
   `ColonyMetrics`/`ColonySnapshot`, not a new ad hoc `Game.*` read.
3. **`__GIT_COMMIT__` is always-on, unlike `__PROFILER_ENABLED__`.** Don't gate it behind `PROFILE=1` —
   every build (push-main, push-dev, pserver) should stamp its own commit.
4. **The Graphite poller flattens nested objects automatically** (`ScreepsStatsd.js`'s `report()`) — no
   need to pre-flatten `RoomStats` into dotted string keys on the bot side; a plain nested object is fine.
