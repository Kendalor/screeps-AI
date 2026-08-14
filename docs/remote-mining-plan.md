# Remote mining plan

## Status: design only (2026-07-28)
Zero code written. This file is the agreed design after a back-and-forth on the core architectural
fork (a `RemoteMining` *operation* vs. extending `Mining` with remote *sources*). The decision and its
reasoning are recorded below so a fresh session doesn't re-litigate it. Read order for picking this up
cold is in "Handoff orientation".

## Handoff orientation (read this first if picking this up cold)
- Repo: `c:\Users\Kenda\Documents\GitHub\screeps-AI`, branch `rewrite` (dev is the PR base). Working
  tree had uncommitted WIP (repair/logistics/operations) at planning time — check `git status` before
  starting; this plan doesn't depend on that WIP but don't clobber it.
- Read order for a fresh agent: this file top to bottom, then `src/operations/mining.ts` (the operation
  being extended — its per-source loop is the seam), `src/snapshot/types.ts` (the only input every pure
  function gets — grows a remote-source section), `src/operations/scouting.ts` +
  `src/memory/schema.ts` `ScoutInfo`/`ScoutedSource` (the upstream data source this consumes),
  `src/operations/logistics.ts` + `src/logistics/` (the transport system that hauls remote energy home),
  `src/intents/types.ts` + `src/intents/execute.ts` (the output boundary).
- Relevant memory entries (persistent, cross-session): [[Scouting port]] and
  [[Scouting passive recording]] (remote mining's data prerequisite — every visible room is recorded),
  [[Logistics plan implemented]] (transport won; `Mining` no longer spawns haulers — remote return-haul
  rides Logistics, not a remote-hauler role), [[Logistics role directions]], [[Miner WORK cap mismatch]]
  and [[Miner container upkeep]] (the per-source miner/container logic being reused for remote sources),
  [[Milestone benchmarks]] / [[Cold-boot history benchmark]] (how a remote-mining win must be measured).

## The decision (and why)

**Extend `Mining` with a flat list of remote *sources* — not a `RemoteMining` operation, and not a
remote-*room* list.** One small exception carved out: a dedicated `Reservation` operation owns claimers.

### The fork we resolved
The rewrite left breadcrumbs pointing at a per-room `RemoteMining` operation:
- `operation.ts:41-47` — `memory.op` "keeps two operations of the same kind (home Mining + a
  RemoteMining) from double-counting each other's creeps."
- `mining.ts:94` — `targetRoom: colony.name // remote mining will differ — the seam is here`.
- `ColonyMemory.remotes: string[] // owned by mining (future)` (`memory/schema.ts:57`).

We deliberately did **not** follow the room-operation breadcrumb, for these reasons:

1. **The unit of granularity is the source, not the room.** The economics are per-source (harvest −
   miner upkeep − haul upkeep(distance) − road/container decay). A room with one near source and one far
   source should be able to mine only the near one. A room-scoped operation can't express "mine one
   source, skip the other" without per-source filtering *inside* it anyway — so the room is the wrong
   key. A flat `remoteSources[]` list expresses near/far skip for free.
2. **Lower overhead / incremental expansion.** Adding a source to a list is one loop extension of
   `Mining`'s existing per-source iteration (`mining.ts:67-97`). A new `Operation` subclass is a class +
   `operationsFor()` wiring + its own `structures`/`intents`/`desiredCreeps` + N instances per tick (one
   per room), each rebuilding cost matrices. The list lets you add one source, benchmark, add another —
   granular steps a per-room operation can't give.
3. **`op`-ownership still works with one operation.** All remote miners are owned by home `Mining`'s
   single `op` name, so the double-count guard the breadcrumb worried about isn't needed — there's no
   second mining operation to disambiguate from.

### What genuinely differs, and where it goes
Two concerns are **per-room**, not per-source, so a pure source list isn't the whole story:
- **Reservation** — one claimer reserves the controller for *all* sources in a room at once (turns each
  mined source from 5→10 energy/tick). This is the one carve-out: a tiny separate **`Reservation`
  operation** owns claimers (user's explicit choice — keep `Mining` about miners+containers only). It
  reads the same remote-source list, groups by room, and reserves a room when the *summed* marginal
  5/tick across that room's mined sources beats one claimer's upkeep — so reserving gets *more*
  attractive exactly when both sources in a room are mined.
- **Danger / abandon** — a remote room goes hostile as a unit. This is a per-source/per-room *field* in
  the snapshot (`danger` / `reserved`), read by `Mining` (stop staffing) and `Reservation` (stop
  reserving) — a field, not a reason for a whole operation.

## The keystone: snapshot shape

**The home `ColonySnapshot` grows a remote-source section; `Mining`, `Reservation`, and `Logistics` all
read it.** Chosen over "one full `ColonySnapshot` per remote room" because creep ownership and spawn
demand belong to *home* (creeps have `memory.home === home room`), and Logistics needs a single merged
view to haul from — a per-room snapshot would fracture both. Extend the snapshot once; three consumers
feed off it; the "planners see a snapshot, never `Game.*`" boundary stays intact.

```ts
// snapshot/types.ts — new
export interface SnapRemoteSource extends XY {   // x/y are in `room`'s coordinate space
  id: Id<Source>;
  room: string;              // the remote room this source lives in (never the home room)
  distance: number;          // rooms from home storage/anchor — drives haul-upkeep economics & nearest-first
  openTiles: number;         // walkable tiles adjacent — miner/collector share cap (same meaning as SnapSource)
  containerId?: Id<StructureContainer>;  // its drop container once built (in the remote room)
  reserved: boolean;         // is the room currently reserved by us (10/tick) or not (5/tick)
  danger: number;            // hostile presence in the room; > 0 means stop staffing/reserving
}

// ColonySnapshot gains:
//   remoteSources: SnapRemoteSource[];  // empty until pickRemotes selects some; local sources stay in `sources`
```
Local sources are conceptually remote-sources at distance 0 — but keep them in the existing `sources`
field (SnapSource) to avoid churning every current reader; `Mining` iterates `sources` then
`remoteSources`. The snapshot builder populates `remoteSources` from `ColonyMemory.remotes` (the selected
list) joined against scout data (`ScoutInfo.sources`) and any live vision of the remote room.

## Two pure modules do the deciding (kept OUT of the operations)

### `src/mining/remoteEconomics.ts` (pure)
```ts
// Per-source net energy. Positive => worth mining at all.
export function netEnergy(source: SnapRemoteSource, ctx: EconomyContext): number;
//   grossHarvest(reserved ? 10 : 5 per tick, sat-capped)
//   − minerUpkeep      (miner body cost / CREEP_LIFE_TIME)
//   − haulUpkeep(distance)   (round-trip CARRY parts needed / life — scales with distance)
//   − roadContainerUpkeep    (decay of the remote road+container per tick)

// Per-ROOM: is reserving worth it? Sum the marginal 5/tick over that room's mined sources vs claimer upkeep.
export function worthReserving(roomSources: SnapRemoteSource[], ctx: EconomyContext): boolean;
```
Testable in isolation with plain numbers — no `Game.*`, no snapshot mocking (same shape as scout's
target picker). This is where "calculate whether unreserved is worth it" lives, at both scales.

### `src/mining/pickRemotes.ts` (pure)
```ts
export function pickRemotes(scoutData, homeState): RemoteSelection; // -> writes ColonyMemory.remotes
```
Ranks scouted neighbors' sources, **nearest-first**, keeps those with `netEnergy > 0`, subject to the
user's three gates for whether to even *attempt* more remote work:
1. **Economics** — `netEnergy(source) > 0`.
2. **Affordability** — home `energyCapacity` can spawn a useful miner/claimer body (no pointless tiny claimers).
3. **Spawn capacity headroom** — can the spawn(s) even handle more creeps? (Don't select a source whose
   miners would starve local roles of spawn time — measure current spawn utilization / queue pressure.)

Selection is **cached in `ColonyMemory.remotes`** (already stubbed), recomputed throttled (not every
tick), so the active source set is stable and doesn't thrash. `remotes` becomes the selector's *output*,
not a hand-maintained input — though it can be seeded manually for an early first test.

## Operation changes

### `Mining` (extended, per the decision)
- `minerRequests` (`mining.ts:56-99`): iterate `colony.sources` **then** `colony.remoteSources`. For a
  remote source, `targetRoom: source.room` (the seam at line 94), `memory.sourceId: source.id`, body
  sized the same way, staffed to the same per-source WORK target, tile-clamped by its `openTiles`. Skip a
  remote source with `danger > 0`.
- `structures` (`mining.ts:102-124`): place the remote source's container + road **in the remote room**,
  pathed against *that* room's terrain/cost-matrix (needs remote terrain — either in `SnapRemoteSource`
  or a `remoteTerrain: Record<room, Uint8Array>` on the snapshot). Local-source structure logic unchanged.
- `intents` (`mining.ts:127-151`): record remote source spots/containers the same way, keyed by source id
  (source ids are globally unique, so `sourceMemory` keying already works cross-room).

### `Reservation` (new, tiny — the one carve-out)
- New `Operation` subclass in `src/operations/reservation.ts`, wired into `operationsFor()`.
- `desiredCreeps`: group `colony.remoteSources` by room; for each room with `≥1` mined source and
  `worthReserving(...) === true` and `danger === 0`, request one `claimer` (reserve intent, not claim).
- `intents`/executor: the claimer walks to the remote controller and reserves it; sets `reserved` up
  which flows back through the snapshot to raise that room's sources to 10/tick.
- Owns only claimers — keeps `Mining` purely miners+containers, per the user's explicit choice.

### `Logistics` (return-haul — extended cross-room)
- Return transport is **not** owned by remote mining (user's choice). Logistics reads the remote
  containers from the extended snapshot and hauls them to home storage/anchor. This makes Logistics
  multi-room *for the pickup leg*: its provider set grows the remote containers; the consumer set
  (home storage/spawn/etc.) is unchanged. Haul distance/round-trip is what `haulUpkeep(distance)` in the
  economics is pricing — so the two systems must agree on the distance metric.
- This is the largest ripple. Logistics was just stabilized ([[Logistics plan implemented]]); treat the
  cross-room extension as its own step with its own benchmark, after local remote-mining plumbing works.

## Suggested build order (each a separately-benchmarkable commit)
0. Snapshot: add `SnapRemoteSource` + `ColonySnapshot.remoteSources` (+ remote terrain access), builder
   populates from `ColonyMemory.remotes` × scout data. Empty list => total no-op; safe to land first.
1. `remoteEconomics.ts` + `pickRemotes.ts` pure modules, fully unit-tested with fixtures. No wiring yet.
2. Wire `pickRemotes` to write `ColonyMemory.remotes` (throttled). Seed one hand-picked nearest remote
   for the first real test.
3. `Mining` iterates remote sources: miners + remote container/road. Benchmark: does a nearest,
   unreserved remote raise utilized energy without starving local roles? (This is the first real signal.)
4. `Logistics` cross-room pickup leg. Benchmark the full round-trip: remote energy actually reaching home.
5. `Reservation` operation (claimers). Benchmark 5→10/tick uplift vs claimer upkeep — confirm the
   economics module's prediction matches measured reality.
6. Turn on autonomous `pickRemotes` selection (drop the hand-seed); benchmark multi-remote scaling and
   the spawn-capacity gate.

## Open questions to resolve during build (not blocking the plan)
- **Distance metric**: `roomLinearDistance` is too coarse for haul upkeep (it ignores in-room path
  length to the source and to home storage). Likely need a route-length estimate. Must be the *same*
  metric the economics and Logistics both use, or they'll disagree on whether a remote pays off.
- **Remote terrain in the snapshot**: `SnapRemoteSource` alone isn't enough for `structures()` to path a
  road in the remote room — decide between a `remoteTerrain` map on the snapshot vs. precomputing the
  road path at selection time and caching it in memory.
- **Spawn-capacity gate metric**: what exactly measures "can the spawn handle more creeps" — spawn busy
  fraction over a window? queue depth? Needs a concrete, snapshot-derivable signal.
- **Danger response**: `danger > 0` stops staffing, but do in-flight miners/haulers retreat, or just not
  get replaced? Cheapest first cut: no replacement, natural age-out — mirror the Logistics rollout style.
```
