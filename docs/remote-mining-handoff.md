# Remote mining — implementation handoff

## Status: not started (2026-07-28)
Companion to `docs/remote-mining-plan.md` (the *why* and the resolved architectural fork). This file is
the *how*: concrete, file-anchored, ordered steps with exact signatures, the traps I found reading the
current code, and a done-check per step. Read the plan first for the decision; read this to build it.

**The decision, in one line:** extend `Mining` with a flat list of remote *sources* (not a
`RemoteMining` operation, not a room list); a tiny separate `Reservation` operation owns claimers;
return-haul rides the existing `Logistics` (extended cross-room). See the plan for the reasoning.

## Ground truth I verified in the code (differs from the plan's approximations)
These are load-bearing; the plan glossed some:
- `ColonyMemory` **already has** `remotes: string[]` and `danger: number` (`memory/schema.ts:52-58`),
  and both `snapshot/colony.ts:114` and `intents/execute.ts:143` already construct memory as
  `{ sources: {}, remotes: [], danger: 0 }`. The `remotes: string[]` type is **too thin** for the
  selected-source list this design needs — widening it is step 1 and touches those two construction sites.
- `claimer` is in the `RoleName` union (`memory/schema.ts:49`) but has **no role file** in
  `src/behaviors/roles/` and no entry wiring. It is entirely net-new (body + steps + registration).
- The snapshot is built per-owned-room in `buildColonySnapshot` (`snapshot/colony.ts:47`). A remote
  room's live data (`FIND_SOURCES`, terrain, containers, hostiles) is only readable when we **have
  vision** there — which we only have when a creep is physically in it. This is a real bootstrapping
  order: selection must run off **scout memory** (`ScoutInfo.sources`, `Memory.rooms[x].scouted`), not
  live vision, and live per-tick fields (container energy, hostiles) are only present once a miner/hauler
  is standing in the room. Plan step 0's "populate from ColonyMemory.remotes × scout data" is right; this
  is why.
- Miners are staffed per-source in `Mining.minerRequests` (`operations/mining.ts:56-99`); the loop over
  `colony.sources` and the `targetRoom: colony.name` on line 94 is the exact seam. `sourceId` keys are
  globally unique across rooms, so `sourceMemory`/`recordSourceSpot` (`execute.ts:142`) already work
  cross-room with no change.
- Cross-room movement precedent exists: scouts walk a stored `route: RouteMemory` via `moveToRoom`
  (see `setScoutTarget` in `execute.ts:127` writing `routeTo(...)`). Remote miners/claimers reuse this
  pattern — they are not teleported; they path room-to-room then work in-room.
- Logistics providers come from `logistics/graph.ts:providers()` reading `colony.containers` only
  (all in the home room). Cross-room haul means either remote containers enter `colony.containers`
  tagged with room, or `providers()` gains a remote-container source. `NodeRef` (`logistics/types.ts`)
  and `runTransport` (`behaviors/transport.ts`) must tolerate a target in another room.

## Invariants that must not break (regression traps)
1. **Purity boundary.** Operations and the new pure modules take `ColonySnapshot`/plain data only, never
   `Game.*`. All live reads happen in `snapshot/colony.ts` (input) and `intents/execute.ts` (output).
   `SnapCreep.memory` is `DeepReadonly` — writing through it is a compile error by design.
2. **`op` ownership.** Every remote miner is owned by home `Mining`'s single `op` (`mining:<home>`); the
   claimer by `reservation:<home>`. Do not introduce a second mining `op`. `Operation.owned`
   (`operation.ts:45`) is the only ownership check.
3. **Spawn-deadlock lessons** (memory: [[Spawning interleave deadlock]], [[Spawn arbiter stop-not-skip]]).
   Remote miner requests join the same arbiter as local ones. Remote work must be **lower effective
   priority** than local economy so a remote can never starve the home room of its own miners/transport.
   Gate remote requests behind local sources being fully staffed.
4. **Never regress the Logistics stability** ([[Logistics plan implemented]], [[RCL3 container collapse]]).
   The cross-room haul extension (step 6) is the riskiest change to a just-stabilized system — it is last,
   behind its own benchmark, and additive (remote containers are *extra* providers, existing ones untouched).
5. **Danger response is age-out, not retreat** (cheapest first cut): `danger > 0` on a remote stops new
   miner/claimer requests; in-flight creeps are not recalled. Mirrors the Logistics rollout style.

## Build order — each step is one commit, independently benchmarkable

### Step 1 — Widen `ColonyMemory.remotes` + add the snapshot type (pure, no behavior)
**Files:** `memory/schema.ts`, `snapshot/types.ts`, and the two memory-construction sites
(`snapshot/colony.ts:114`, `intents/execute.ts:143`).

- Replace `remotes: string[]` with a structured list. Proposed:
  ```ts
  // memory/schema.ts
  export interface RemoteMemory {
    room: string;
    sources: RemoteSourceMemory[]; // the sources selected for mining in this room
    reserved: boolean;             // are we currently reserving it (recomputed, cached to avoid thrash)
  }
  export interface RemoteSourceMemory {
    id: Id<Source>;
    x: number; y: number;
    distance: number;              // route length home->source (see step 2's metric)
    containerId?: Id<StructureContainer>;
    spot?: { x: number; y: number };
  }
  // ColonyMemory.remotes: RemoteMemory[];   // was string[]
  ```
- Add `SnapRemoteSource` + `ColonySnapshot.remoteSources` per the plan's keystone section. Local sources
  stay in `sources` (SnapSource) to avoid churning current readers. `remoteSources` starts `[]`.
- Update the two `{ sources: {}, remotes: [], danger: 0 }` literals — `remotes: []` still type-checks
  once the element type changes, so this is mechanical; grep for `remotes: [` to be sure both are hit.
- **Done-check:** `npm run build` (tsc) green, all existing tests green, `remoteSources` is `[]`
  everywhere at runtime → total no-op. Safe to land first.

### Step 2 — Distance metric (pure, tested in isolation)
**New file:** `src/mining/distance.ts` (or fold into `remoteEconomics`).
- The plan's #1 open question: `roomLinearDistance` is too coarse (ignores in-room path to the source and
  to home storage). Needed by **both** economics and Logistics — they must share it or disagree on
  whether a remote pays off. Decide one:
  - (a) Estimate: `roomLinearDistance * 50 + inRoomApproxToSource + inRoomApproxToStorage`.
  - (b) Precompute the real road path length once at selection time (uses remote terrain — needs vision
        or a cached path) and store it in `RemoteSourceMemory.distance`.
- **Recommendation:** ship (a) first (no vision dependency), leave a `// TODO(remote): real path length`
  and revisit if benchmarks show the estimate mispricing far remotes. Store the result in
  `RemoteSourceMemory.distance` so it's computed once, not per tick.
- **Done-check:** unit tests over plain numbers; no `Game.*`.

### Step 3 — `remoteEconomics` (pure)
**New file:** `src/mining/remoteEconomics.ts`.
```ts
export interface EconomyContext { minerBodyCost: number; claimerBodyCost: number; /* decay consts, etc */ }
export function netEnergy(source: SnapRemoteSource, ctx: EconomyContext): number;      // >0 => mine it
export function worthReserving(roomSources: SnapRemoteSource[], ctx: EconomyContext): boolean;
```
- `netEnergy` = grossHarvest(reserved?10:5, sat-capped) − minerUpkeep − haulUpkeep(distance) −
  road/container decay. `worthReserving` = Σ(marginal 5/tick over the room's mined sources) > claimerUpkeep.
- Pull decay/cost constants from `BODYPART_COST`, `CONTAINER_DECAY`, `ROAD_DECAY_*` — do not hardcode.
- **Done-check:** unit tests assert the near/far skip case (one source in a room profitable, the other
  not) and the reservation break-even (one mined source not worth reserving, two are). No wiring yet.

### Step 4 — `pickRemotes` selector (pure) + wire it to write memory
**New file:** `src/mining/pickRemotes.ts`. **Wiring:** a throttled call producing a `setRemotes` intent.
```ts
export function pickRemotes(input: {
  candidates: ScoutCandidate[]; // colony.scoutTargets already carries scouted ScoutInfo
  home: ColonySnapshot;         // for energyCapacity (affordability) + spawn pressure (capacity gate)
}): RemoteMemory[];
```
- Rank scouted neighbors' sources **nearest-first**, keep `netEnergy > 0`, subject to the three gates:
  1. economics (`netEnergy > 0`), 2. affordability (`home.energyCapacity` builds a useful miner/claimer),
  3. spawn-capacity headroom (open question below — pick a concrete signal).
- **New intent** `{ kind: "setRemotes"; room: string; remotes: RemoteMemory[] }`; `execute.ts` writes
  `Memory.colonies[room].remotes`. Emit it from `Mining.intents` (or a small selector call) **throttled**
  (e.g. `colony.tick % 100 === 0`), so selection is cached and stable, not re-ranked every tick.
- The snapshot builder (`buildColonySnapshot`) now reads `Memory.colonies[name].remotes`, joins each
  selected source against `Memory.rooms[room].scouted` + any live remote-room vision, and fills
  `remoteSources`. This is where `reserved`/`danger`/`containerId`/live `openTiles` get populated (live
  fields only when we have vision that tick; otherwise fall back to memory / defaults).
- **Seed for first real test:** allow a hand-set `remotes` entry (pick the nearest scouted room) so
  steps 5–6 can be exercised before the autonomous selector is trusted. Turning off the hand-seed is step 7.
- **Done-check:** selector unit-tested with fixture scout data; end-to-end, a seeded remote shows up in
  `colony.remoteSources` in a snapshot test.

### Step 5 — `Mining` staffs remote sources (miners + remote container/road)
**File:** `operations/mining.ts`.
- `minerRequests` (lines 56-99): after the `colony.sources` loop, loop `colony.remoteSources`. For each
  (skip if `danger > 0`), request miners to the same per-source WORK target, `targetRoom: source.room`
  (the line-94 seam), `memory.sourceId: source.id`, `memory.op: this.name`. **Gate: only after all local
  sources are fully staffed** (invariant #3) — compute local deficit first, emit remote requests only if
  local is satisfied, or give them a lower priority so the arbiter always fills local first.
- `structures` (lines 102-124): place the remote container + road **in the remote room**. This needs the
  remote room's terrain/cost-matrix — `sourceRoadPath`/`buildCostMatrix` currently run on home terrain.
  Either add remote terrain to the snapshot or precompute the remote road path at selection time (step 2b)
  and read it here. `placeSite` intent already takes a `room` param (`intents/types.ts:20`) so the write
  side is fine.
- `intents` (lines 127-151): `recordSourceSpot` already keys by globally-unique `sourceId` and takes a
  `room` — remote spots/containers record with no new intent. Verify `execute.ts:142` writes under the
  right colony (it writes `Memory.colonies[intent.room]` — for a remote source `intent.room` is the
  *remote* room; confirm that's where you want the source memory, or key remote source memory under home).
  **Trap:** decide this deliberately — source memory keyed under the remote room vs. under home changes
  where the snapshot builder looks it up.
- Remote miners must **travel to the remote room** before harvesting. They need a `route` like scouts.
  Simplest: on spawn, `memory.targetRoom` is the remote room; the miner's behavior/`moveToRoom` walks it
  there, then the existing harvest steps (`miner.ts:77-83`) run against the in-room source. Confirm the
  miner role's movement handles being out of its home room (scouts do; check `moveToRoom`).
- **Done-check (first real signal):** benchmark a single nearest, *unreserved* remote — does utilized
  energy rise without local roles starving? Compare against committed RCL2/RCL2+ext baselines
  (`test/benchmark/`, memory [[Milestone benchmarks]]).

### Step 6 — `Logistics` cross-room pickup leg (return-haul)
**Files:** `logistics/graph.ts` (`providers`), `logistics/types.ts` (`NodeRef`),
`behaviors/transport.ts` (`runTransport`), possibly `snapshot/colony.ts` (remote containers into the snapshot).
- Remote source containers become **extra providers** (existing ones untouched — additive). Add them to
  `providers()` from the remote-container data in the snapshot, tagged with room.
- `NodeRef` and `runTransport` must tolerate a target in another room — the transporter travels there,
  withdraws, travels home, delivers to the existing home consumers (spawn/storage), which are unchanged.
- Reuse the scout `route` movement pattern for the cross-room legs. Watch `travelTo`'s single
  `Memory._trav` state (see `empire/creeps.ts:90-97` co-fire note) — don't issue two moves/tick.
- **Riskiest step; land last, behind its own benchmark.** Confirm no regression to the local transport
  economy ([[RCL3 container collapse]], [[Logistics plan implemented]]).
- **Done-check:** benchmark the full round-trip — remote energy actually arriving in home storage/spawn —
  and confirm local RCL2/RCL3 economy is unregressed.

### Step 7 — `Reservation` operation (claimers) + the `claimer` role
**New files:** `src/operations/reservation.ts`, `src/behaviors/roles/claimer.ts`. **Wiring:**
`operations/index.ts` (`operationsFor`), `behaviors/roles/index.ts` (role registry).
- **`claimer` role** is net-new (only the union name exists). Body: `[CLAIM, MOVE]` sets sized to
  home `energyCapacity` (CLAIM is 600 energy — affordability gate matters). Steps: move to remote
  controller, `reserveController`. Priority: below local economy roles.
- **`Reservation` operation** (`extends Operation`, `kind = "reservation"`): `desiredCreeps` groups
  `colony.remoteSources` by room; for each room with ≥1 mined source, `danger === 0`, and
  `worthReserving(...)`, request one claimer (`op: this.name`, `targetRoom: room`). One claimer per room,
  never per source. Add `new Reservation(room)` to `operationsFor` (`operations/index.ts:27`).
- Reserving raises that room's sources to 10/tick; that flows back via the snapshot's `reserved` field
  (builder reads live `controller.reservation` when we have vision, else memory).
- **Done-check:** benchmark the 5→10/tick uplift vs claimer upkeep, and confirm it matches
  `remoteEconomics.worthReserving`'s prediction (the economics module's first live validation).

### Step 8 — Turn on autonomous selection
- Drop the hand-seed from step 4; let `pickRemotes` drive `Memory.colonies[room].remotes`. Benchmark
  multi-remote scaling and prove the spawn-capacity gate prevents over-committing.

## Open questions to settle during build (carried from the plan)
- **Distance metric** (step 2): estimate vs. real path length; must be shared by economics + Logistics.
- **Remote terrain in the snapshot** (step 5): a `remoteTerrain` map on the snapshot vs. precomputed
  cached road path at selection time. Blocks `structures()` pathing a remote road.
- **Spawn-capacity gate signal** (step 4): what concretely measures "spawn can handle more creeps" —
  spawn busy fraction over a window? queue depth? Must be snapshot-derivable.
- **Source-memory keying** (step 5): remote source memory under the remote room's `Memory.colonies` entry
  vs. under home. Affects where the snapshot builder looks it up. Decide once, explicitly.
- **Danger response** (invariant #5): confirmed as no-replacement age-out for the first cut; revisit if a
  remote under sporadic attack thrashes.

## How to measure a win (don't skip)
Every step above lists a done-check, but the economic ones (5, 6, 7) must be measured against the
committed benchmark history, not asserted. See memory [[Milestone benchmarks]] and
[[Cold-boot history benchmark]] for `npm run bench` and the committed baselines in `test/benchmark/`.
The whole point of the source-list granularity is *add one remote, measure, add the next* — honor that;
don't land steps 5–8 as one blob.
```
