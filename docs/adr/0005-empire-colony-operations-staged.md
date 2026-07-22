# Empire/Colony/Operation, staged top-down around spawning

Supersedes [ADR 0003](0003-empire-colony-operation-hierarchy.md) and
[ADR 0004](0004-mining-as-the-first-operation.md).

0003 diagnosed the `systems/*.ts` layout correctly — mining's quota lives in
`logistics.ts`, its placement in `mining.ts`, its role in the shared `roles.ts` table,
and `for (const colony of snap.colonies)` is repeated in five files. That stands.

Both prior ADRs failed on the same point, from opposite directions. 0003 designed the
whole hierarchy at once and left holes where the pieces meet (whose `RoomSnapshot`,
who constructs operations, which operation owns a spawned creep). 0004 narrowed to one
operation and assumed those holes could be deferred — but "operations both want
`hauler`, the counts just sum" is not a conservative deferral, it is incoherent the
moment two operations exist: `colony.census` is keyed by role, so neither operation
can tell whose creeps those are, and the wrong one sees a deficit when the other's
creep dies.

The load-bearing question both missed is the same one: **an operation needs identity
over its creeps, and a creep needs identity over its target.** Everything else —
census keying, whether demand is a count or a body, how priority works, whether
`Mining` owns haulers — follows from answering it. This ADR answers it in stage 2 and
sequences the structural work around it.

## Decision

Three stages, each independently shippable, each gated on the benchmark. The target
shape is 0003's (`Empire → Colony[] → Operation[]`, pure, `Intent[]` out); the change
is the order of arrival and that spawning — not mining — is the proof case, because
spawning is where the identity question actually bites.

### Stage 1 — Hoist the colony loop into the tick

The structure arrives top-down and empty. `Empire` and `Colony` exist as types with
real callers; the loop that was copy-pasted into four planners becomes a parameter of
the abstraction. No state, no operations, no behaviour change.

```ts
// factories, not classes — src/ has no classes outside vendored lib/traveler.ts
export function colony(snap: ColonySnapshot): Colony;   // { snapshot }
export function empire(snap: EmpireSnapshot): Empire;   // { colonies }
```

Both are pure `Snapshot → wrapper` transforms; `buildEmpireSnapshot()` stays the sole
`Game.*` boundary and `tick` composes them (`empire(buildEmpireSnapshot())`). Building
the snapshot *inside* `empire()` was rejected: it would push impurity to the top of the
new hierarchy and force a `Game` mock into every test that wants an `Empire`.

`Colony` holds its snapshot as a named property (`colony.snapshot.sources`), not by
delegation. The indirection is the point — it is the single place the later
`RoomSnapshot` split lands, instead of every planner signature. `Colony` is
`{ snapshot }` and nothing else: no `plan()`, no methods. Dispatch stays in `tick`
until stage 3 has operations to orchestrate, because a `plan()` method would bake in
the per-system-per-colony dispatch this ADR is dismantling.

The four colony-scoped planners drop their own loops and take a `Colony`:

```ts
export function planDefense(colony: Colony): Intent[];   // was (snap: EmpireSnapshot)
```

— likewise `planSpawning`, `planMining`, `planBuilding`. Bodies are otherwise
untouched. `runCreepBehaviors` stays empire-scoped (it iterates `Game.creeps` and
ignores the snapshot entirely), so `SYSTEMS` carries a scope discriminant. That is
deliberately the cheapest thing that type-checks: `SYSTEMS` is scaffolding being
dismantled over stages 2 and 3, not a shape worth designing. Creep behaviours being
empire-scoped is debt — they are per-colony work that never got snapshot-ified.

`tick` keeps its tiers, intervals, CPU guards, `execute()`-per-system and
`stats.record` keys exactly as they are, so the benchmark history stays comparable.
Guards stay **outside** the colony loop: under CPU pressure every colony drops tier-3
work together, rather than colony 1 doing everything and colony 5 starving. The
try/catch moves **inside** it, so one colony's bad snapshot no longer blinds its
siblings' defense — unobservable at one colony, correct at N.

Tests: `test/fixtures.ts`'s `colony()`/`empire()` are renamed `colonySnap()`/
`empireSnap()` — they return snapshots and now say so — freeing those names for the
production factories. A `testColony(over): Colony` convenience wraps `colonySnap`, so
the ~50 planner call sites take a rename and no nesting.

Gate: benchmark **identical**, not merely within noise. The same work runs in the same
order; only the loop's owner changed.

### Stage 2 — Spawning: demand as a request, not a count

The substance. Ported from legacy's `SpawnManager`, which worked well, with its
persistence removed.

#### Demand is a body, not a number

```ts
export interface CreepRequest {
  role: RoleName;
  body: BodyPartConstant[];        // the requester computed it
  priority: number;                // absolute across the empire
  memory: Partial<CreepMemory>;    // op, sourceId, targetRoom, homeRoom …
  count?: number;                  // default 1
}
```

A `Census` count cannot express what the requester knows. Today
`desiredMinerCount` builds a miner body purely to count its WORK parts, throws it
away, and returns a number ([logistics.ts:10](../../src/systems/logistics.ts#L10));
`planSpawning` then rebuilds a body from a *different* `BodyContext`
([spawning.ts:34](../../src/systems/spawning.ts#L34)). The quota is sized against a
drop-miner while a container-miner may be spawned. Carrying the body removes the
double derivation and the latent mismatch with it.

This is legacy's `SpawnEntry.body`, which `MinerOperation` used to compute a
two-source miner body from the path length between sources — knowledge no generic
`getBody(spawn)` could have.

#### Priority is per request, absolute

Legacy: miner 95, hauler 85, invader 72, builder 50, deposit 30/29. Not derivable from
the role — the same role is worth more or less depending on which operation asks and
why, and adjacent numbers order requests *within* one operation (attacker before
healer). Absolute integers gave enough leverage in practice; no
`PRIORITY[role] + offset` scheme.

`spawning.ts`'s flat `PRIORITY` list becomes the default a request may override.

#### No queue

Legacy persisted `toSpawnList` in Memory. The motivation was CPU — compute bodies
less often — and it does not survive the snapshot architecture: no quota function
touches `PathFinder` or `room.find`; they are arithmetic over pre-computed snapshot
fields. Recomputing every tick is microseconds, against a queue that costs Memory
serialization plus JSON parsing every tick, and that goes stale (a body computed at
RCL2, spawned at RCL4) — which is what legacy's `pause`/`rebuild` fields were
compensating for. `rebuild: true` appears nowhere in legacy; the machinery was never
used.

Requests are regenerated from the current snapshot each tick, so staleness cannot
occur. **Do not reintroduce a persisted spawn queue.**

Double-ordering across ticks is already handled: `censusByColony` counts spawning
creeps ([census.ts:7](../../src/snapshot/census.ts#L7)), so a request satisfied by an
in-progress spawn is visible the next tick. That is what legacy's
`data.creeps.push(name)` ledger existed for, without the persistence.

#### Census keyed by operation

`CreepMemory` gains `op?: string`. `censusByColony` keys by operation alongside role,
so an operation asks "how many do *I* have" rather than reading a colony-wide role
count. This is legacy's `data.creeps` + `memory.op`, derived fresh from the snapshot
each tick instead of stored and reconciled — so there is nothing to validate and
nothing that can drift. `validateCreeps()` has no counterpart here by design.

Where the assignment matters (a miner belongs to a *source*, not just to Mining),
`memory.sourceId` carries it and the deficit is per-assignment: "does this source have
6 WORK covering it" rather than "are there 2 miners." Both keys exist for the same
reason legacy had both: `op` for ownership, `sourceId` for the specific job.

Existing creeps deploy without `op`. Absent `op` means unowned; attrition clears them
within a creep lifetime (~1500 ticks). No migration step in `memory/migrate.ts`.

#### What stays in spawning

`planSpawning` remains the arbiter and keeps `recoveryRole`
([spawning.ts:52](../../src/systems/spawning.ts#L52)), which deliberately sizes
against `energyAvailable` rather than capacity because a dead colony has no creep to
fill extensions. That is a spawning-level concern and **overrides a request's body**.

`execute.ts` already covers two of legacy's capabilities — dry-run before commit, and
spawn direction toward an adjacent road — and needs no change beyond accepting
richer `memory`.

Gate: benchmark within noise (see §Acceptance).

### Stage 3 — Building as demand plus an arbiter

With the pattern established, construction is the same shape as spawning.

`building.ts` currently does two jobs: it *states* the bunker's structural demand
(`stampLayout` + `buildableAtRcl`, gated by RCL), and it *arbitrates* (orders by
`typePriority`, spends `FOCUS_SITE_CAP`, tears down unclaimed structures). The first
is an operation's job.

- `Bunker` — a peer operation to `Mining`, owning the stamp and its RCL gating.
- `Mining` — owns its per-source containers/links and `CONTAINERS_FROM_RCL`, plus the
  `miner`/`hauler` quotas moved from `logistics.ts`.
- `building.ts` — polls `structures()` across operations, merges, orders, spends the
  site budget.

```ts
structures(snap: EmpireSnapshot): PlacedStructure[];   // state-gated, like desiredCreeps
```

`structures()` is gated by current state exactly as `desiredCreeps()` is — an
operation that cannot afford a container does not ask for one. An earlier draft had
this ungated ("the full RCL8 intent") to protect the demolition pass; that was wrong
and inconsistent with how demand works everywhere else in this design.

Demolition follows with no special case: **tear down what no operation claims this
tick.** A mining container at RCL2 that Mining no longer asks for is genuinely not
wanted, and removing it is the correct answer rather than an accident.

Gate: benchmark within noise.

## Consequences

- Two operations exist at the end of stage 3, which is the minimum that tests whether
  the abstraction holds. 0004's single operation could not: role collision, census
  keying and cross-operation arbitration are all invisible with one operation.
- `systems/logistics.ts` is deleted; `systems/mining.ts` and the demand half of
  `systems/building.ts` become operations. The four roles no operation owns yet
  (`bootstrap`, `upgrader`, `builder`, plus recovery's `supply`) remain in
  `spawning.ts` as visible debt, each a candidate operation.
- `Intent` keeps growing as operations gain memory write-cases — same tradeoff already
  accepted for `recordSourceSpot`.
- `RoomSnapshot`, flag commands, `canAfford`, and per-role files are still not built.
  They are 0003 ideas without a caller; each waits for one. Squad coordination remains
  deferred.
- Stage 2 changes `CreepMemory`, the census shape, and `planSpawning`'s deficit test
  together. They cannot be split — the deficit test is meaningless without the keying.

## Acceptance

Per stage: `npm test` green, `npm run lint` clean, test count not decreased, and
`npm run bench` compared against the committed history in
`test/benchmark/benchmarks.json` (`rcl2` ~775, `rcl2-extensions-built` ~3050, `rcl3`
~7300, `rcl3-buildings-built` ~11400).

Run-to-run spread in the existing history is roughly ±3%. Stage 1 must be identical.
Stages 2 and 3 treat **>5% on any milestone as a failure** — these are refactors of
behaviour that already works, so a real move means something was not preserved.
Report it rather than re-baselining the benchmark.

The `legacy-rcl2` series (~402 ticks vs the rewrite's ~775) is a separate finding:
legacy reaches RCL2 faster and then builds nothing (`sinkConstruction: 0`,
`rcl2-extensions-built` never reached). Its early-game prioritisation is worth
studying, but it is not a goal of this ADR.
