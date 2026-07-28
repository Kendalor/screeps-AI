# Colony-level logistics migration plan

## Handoff orientation (read this first if picking this up cold)
- Repo: `c:\Users\Kenda\Documents\GitHub\screeps-AI`, branch `rewrite` (dev is the PR base). Working tree had uncommitted WIP in `builder.ts`/`upgrader.ts`/`mining.ts`/`upgrading.ts`/benchmarks at planning time — check `git status` before starting; this plan does not depend on that WIP but don't clobber it.
- Nothing has been implemented yet — this file is 100% design, zero code written. Step 0 (interpreter verb extraction) is the correct first commit.
- Read order for a fresh agent/session: this file top to bottom, then `src/operations/operation.ts` (the class being extended), `src/behaviors/interpreter.ts` (what's being partially reused), `src/snapshot/types.ts` (the only input every pure function gets), `src/intents/types.ts` + `src/intents/execute.ts` (the output boundary).
- Relevant memory entries (persistent, cross-session): [[Logistics role directions]] (hauler/supply are directional opposites — informs why they're kept separate roles, not unified), [[TargetSpec any-group]] (the `energySourceGroup`/`energySinkGroup` dead code this plan's graph functions are the spiritual successor to), [[Spawning interleave deadlock]] (why `Mining`'s miner/hauler interleave must not be touched), [[Miner container upkeep]], [[RCL3 container collapse]] (recent, still-open instability around the 800-energy container gate — worth checking this hasn't regressed before benchmarking `Logistics` changes at RCL3).

## Scope (revised)
- **Additive, not a replacement.** `Logistics` is a new `Operation` subclass, added to `operationsFor()` alongside the existing seven — not a deletion of `Mining`'s hauler code or `Supply`.
- **`Mining` is untouched except one config value.** `hauler` is not a standalone operation — it's owned by `Mining` (`operations/mining.ts:74-150`), which requests miners *and* haulers together, deliberately interleaved (`interleaveByPriority`, lines 49-64) to avoid a cold-start deadlock ([[Spawning interleave deadlock]]). There is nothing called "the Hauler operation" to delete. The cutover lever is `config.maxHaulers` (`mining.ts:31`): set to `0` and `wantedHaulers()`'s `Math.min(config.maxHaulers, ...)` (line 163) collapses hauler demand to zero — `interleaveByPriority` still runs, just over an empty haulers array, no special-casing, fully reversible, no risk to the deadlock fix. Existing haulers age out naturally with no replacements.
- **`Supply` is untouched, not even as a later phase.** `Supply.desiredCreeps()` (`supply.ts:15-17`) hard-gates on `colony.storageEnergy > 0`, which this bot's layout reaches around RCL4. Below that, `Supply` is already a structural no-op — there's no real overlap with a `Logistics` system operating in the RCL1–4 window, so nothing to arbitrate and nothing to A/B there. Whether `Logistics` eventually makes `Supply` redundant above RCL4 is a separate, later, evidence-driven question — not scoped here.
- **New role, not a reused name.** Whatever creeps `Logistics` spawns get a role distinct from `"hauler"`/`"supply"` (e.g. `"transport"`) so there's zero collision with either operation's existing, tuned spawn logic during the A/B window.
- Links out of scope — the provider/consumer graph is shaped to be link-ready later (a link is just a zero-travel provider+consumer), but no link-firing code this pass.
- Assignment style: reactive queue, 1-2 tasks lookahead (`current` + optional `next`), recomputed fresh each tick rather than committed far ahead — consistent with ADR 0005's "no persisted queue" bias for spawn demand, applied here to *task assignment* instead (a different concern: per-creep execution state, not colony headcount).

## The A/B this scope enables
Because `Mining` keeps its own miner logic and `maxHaulers` is just a number, the rollout is:
1. Ship `Logistics` covering some or all of the transport gap, `maxHaulers` still at its current value (6) — `Logistics` and `Mining`'s haulers coexist, ideally on different jobs (e.g. `Logistics` takes tower/controller-container top-off, hauler keeps the source→spawn leg) so they're not fighting over the same targets while unproven.
2. Once `Logistics` demonstrably covers the source→spawn/extension leg too (benchmarked, not assumed), drop `maxHaulers` to `0` in a colony/branch running the new system and compare against the committed RCL2/RCL2+extensions baselines in `test/benchmark/`.
3. Only after that comparison holds up across the full RCL1→4 window does deleting `hauler.ts`/`Mining`'s hauler-request code become a real, separately-scoped decision — not part of this plan.

## Why not extend the step system in place
`TaskState{step,target}` (`behaviors/types.ts:73-76`) is a cursor into a *static, role-wide* `Step[]` array (`behaviors/roles/hauler.ts:37-56`). Every hauler runs the identical priority-ordered scan; there's no per-creep plan and no colony visibility into who's going where. Bolting a queue onto this means either every creep gets a bespoke `Step[]` (defeats the "static role table" design) or a new verb that escapes the table. `Logistics` gets its own assignment path instead, reusing `resolveTarget`'s live-object matching helpers and the verb-execution leaves, not the step *table* or its cursor mechanism.

## Architecture answers

**Colony-level, not empire-level.** `ColonySnapshot` already carries everything the graph needs (`containers`, `drops`, `storageEnergy`, `structures`, `creeps` — `snapshot/types.ts:98-127`) and is single-room by construction. `Operation` methods deliberately take `ColonySnapshot`, never `Colony`, specifically "so operations can never reach and call siblings" (`operation.ts:17`) — operations are colony-siloed by design. The one genuinely empire-level concern today is spawn *routing* (`empire/spawning.ts` — a body must be built at some spawn, possibly cross-room); there's no cross-colony resource-transfer concept yet, so nothing calls for empire-level logistics now. If remote mining/multi-room sharing arrives later, that's a `providers()`/`consumers()` call per colony merged by an empire-level allocator — a real future extension, not something to build speculatively now.

**No direct Game object access.** Same rule every operation already follows, enforced structurally: `SnapCreep.memory` is `DeepReadonly<CreepMemory>` specifically so writing through it is a compile error, keeping `execute.ts` the sole write boundary (`snapshot/types.ts:38-39`). `providers()`, `consumers()`, `allocate()` are pure functions over `ColonySnapshot` → data, exactly like `Mining.harvestIncome()`/`wantedHaulers()` today — testable with plain fixtures, no `Game.*` mocking. In-flight assignments (needed for "no double-delegation") are read the same way: fold `colony.creeps[i].memory.logistics` from the snapshot, not a live `Game.creeps` read — equivalent to `targets.ts`'s `claimCounts()` pattern but snapshot-pure. The only Game-object access is in the per-creep tick executor (`empire/creeps.ts`), same place every other role's execution already lives, for the same reason (`travelTo` needs live path state that doesn't fit a stateless-intent model).

**Spawning / census / body sizing — nothing new needed.** This falls out of extending `Operation`:
- *Spawning*: `Logistics.desiredCreeps(colony)` returns `CreepRequest[]`, flat-mapped by `Colony.requests()`, sorted/routed by the empire arbiter — identical pipeline to `Mining`/`Supply`/`Upgrading`.
- *Census*: `Operation.owned(colony, role)` (`operation.ts:30-36`) filters `colony.creeps` by role + `memory.op === this.name` — `Logistics` gets this for free via `this.owned(colony, "transport")`, same as `Mining.owned(colony, "miner")`.
- *Body sizing*: either the shared `fillRole`/`fillTo` flat-quota helper (`operation.ts:48-55`, used by Building/Upgrading/Scouting) if a flat headcount suffices, or a `Mining.wantedHaulers()`-shaped formula (income/throughput → CARRY parts → `fillTo(wanted, owned.length, body, priority, memory)`) if sizing needs to track the provider/consumer graph's actual throughput — more likely, since the point of this system is throughput-awareness. Either way, no new empire/spawn machinery.

## Intent system fit
Split across the two channels every `Operation` already exposes (`operation.ts`):
- **`desiredCreeps` (spawn demand)** — fits exactly as-is, no new intent needed; goes through the existing `spawn` intent (`intents/types.ts:11-16`).
- **Task assignment** — fits `intents()` following the `setCreepRole` precedent (`intents/types.ts:21`: "Planner decides, execute.ts owns the memory write"). New variant: `{ kind: "assignLogisticsTask"; creep: Id<Creep>; task: LogisticsTask }`. `Logistics.intents(colony)` runs `planLogistics()` once per tick and emits one such intent per (re)assigned creep; `execute.ts` writes it into `Game.creeps[id].memory.logistics`. Keeps the planner 100% pure and testable (`ColonySnapshot` in, `Intent[]` out — same shape as every other operation's tests) and keeps `execute.ts` as the sole `Memory`-write boundary, a rule this codebase enforces structurally, not just by convention.
- **What stays outside intents** — a `transport` creep's tick-to-tick execution of its *current* task (walking to the target, calling `withdraw`/`transfer`). Same reason `runCreepBehaviors()` executes steps directly today rather than emitting per-tick intents: `travelTo` keeps its own internal path state, which doesn't fit the stateless-intent model. This lives in `empire/creeps.ts`, alongside (not replacing) the step-system's `runOne()`.

## New module: `src/logistics/`

### 1. The interface (small surface, per operation)

```ts
// src/logistics/index.ts
export function planLogistics(colony: ColonySnapshot): LogisticsPlan;

export interface LogisticsPlan {
  assignments: Record<Id<Creep>, LogisticsTask>; // this tick's intended task per idle/reassignable creep
}
```
Pure, same shape as `Operation.desiredCreeps`/`intents`. `Logistics.intents()` calls this and maps the result to `assignLogisticsTask` intents — no creep mutation inside the planner itself.

### 2. Data model

```ts
// src/logistics/types.ts

export interface LogisticsTask {
  kind: "pickup" | "deliver";
  from?: NodeRef;   // pickup: where to withdraw/pickup from
  to?: NodeRef;      // deliver: where to transfer to
  resource: ResourceConstant;
  amount: number;    // capped to creep capacity when assigned; informational for matching
}

export type NodeRef =
  | { kind: "structure"; id: Id<AnyStoreStructure> }
  | { kind: "dropped"; id: Id<Resource> }
  | { kind: "tombstone"; id: Id<Tombstone> }
  | { kind: "creep"; id: Id<Creep> };
```

`CreepMemory` gains one field, sibling to `task` (not a replacement — miner/builder/upgrader/hauler/supply keep using `task` and the step system exactly as-is):
```ts
logistics?: { current?: LogisticsTask; next?: LogisticsTask };
```
`RoleName` gains `"transport"` (additive — `"hauler"`/`"supply"` stay in the union, nothing removed).

**Gap found during survey — `roleDef`/`ROLES` registry.** `src/behaviors/roles/index.ts:15-24` is a `satisfies Partial<Record<RoleName, RoleDef>>` map from role name to a `RoleDef`-shaped class (body calculator + `steps` + `priority` + `sweep`). `roleDef(role)` returns `undefined` for anything not in that map. Two consumers outside the step-runner care about this:
- `Operation.fillRole()` (`operation.ts:48-55`) calls `roleDef(role)?.body(...)` to size a body — so if `Logistics` wants to reuse `fillRole` for a flat quota, `"transport"` needs a `ROLES` entry.
- `Mining.minerBodyWork()` and similar helpers pull bodies the same way.
`"transport"` should get a `ROLES` entry with a real `body()` calculator (likely `haulerBody()` reused as-is from `behaviors/roles/hauler.ts:9-16` — same CARRY:MOVE 1:1 shape probably still applies) and `priority`, but **`steps: []`** (or simply omit `steps` and let it default via `Role.steps = []` from the base class, `role.ts:8`). `runCreepBehaviors()` (`empire/creeps.ts:36-38`) already no-ops on `def.steps.length === 0` — so the new `"transport"` branch in `empire/creeps.ts` must run **before** that early-return / step-table dispatch, or divert entirely for `role === "transport"`, otherwise a transport creep with an empty `steps` array just does nothing every tick.

### 3. The provider/consumer graph (the actual "deep" part)

Doesn't exist anywhere today (confirmed zero hits for provider/consumer in `src/`). It's the reusable abstraction the legacy `RoomLogisticsOperation.ts`'s `LogisticTask{from,to,amount,type}` interface gestured at but never wired up (declared, never populated — see legacy survey).

```ts
// src/logistics/graph.ts

export interface Provider {
  ref: NodeRef;
  resource: ResourceConstant;
  available: number;   // energy sitting there right now
  urgency: number;      // decay risk / overflow risk — dropped piles and near-full containers rank high
}

export interface Consumer {
  ref: NodeRef;
  resource: ResourceConstant;
  wanted: number;    // free capacity, capped by fillTo-equivalent floors
  priority: number;  // spawn/extension > controller-container-floor > storage > tower > creep sink
}

export function providers(colony: ColonySnapshot): Provider[];
export function consumers(colony: ColonySnapshot): Consumer[];
```

Priority tiers on `Consumer` are informed by `hauler.ts`'s hard-won step order (lines 28-36: spawn/ext first, then controller-container to a 0.7 floor, then storage, tower, creep sink) but this graph is a **new, additive** consumer of that knowledge — it does not touch `hauler.ts` itself, since hauler stays live during the A/B.

**Link-ready, not link-implementing**: a link is just a `Provider`+`Consumer` with `ref.kind` extended to `"link"` and zero creep-travel cost. The allocator doesn't need to know what moves the resource — only that links move themselves, so they'd never appear as an `allocate()` output, just as graph nodes something else (a future minimal link-firing pass) reads directly. Not built now; the graph shape just doesn't need to change when it is.

### 4. The allocator (matching, idle-only, no double-assignment)

```ts
// src/logistics/allocate.ts

export function allocate(
  providers: Provider[],
  consumers: Consumer[],
  idleCreeps: readonly SnapCreep[],   // creeps with no current task, or about to finish one
  reserved: ReservedAmounts           // in-flight claims from every creep's current+next task this tick
): Record<Id<Creep>, LogisticsTask>;
```

Greedy, priority-first (matches the codebase's existing style — `resolveTarget`'s `pickByPrefer` is also greedy, not a solver):
1. Sort consumers by `priority` desc, then `wanted` desc.
2. For each idle creep, walk consumers in priority order; for the first with unmet `wanted` after subtracting `reserved`, find the best provider (nearest-by-path among those with `available > 0` after subtracting `reserved`), emit a pair: `pickup` from provider, `next: deliver` to consumer.
3. Decrement `reserved` for both provider and consumer by the assigned amount so the next creep in this same pass doesn't double-book it — the "does not delegate an already-given-away task" requirement.
4. A creep already carrying load (just spawned, or resuming) skips straight to step 2's consumer-matching using its current load — no wasted trip.

`reserved` must include creeps already mid-task, not just this tick's new assignments — fold every creep's `memory.logistics.current`/`next` (read via the snapshot, per the "no direct Game access" answer above) into `reserved` before step 1. Generalizes `targets.ts`'s `claimCounts()`/`withinShareCap` pattern from "count of creeps pointed at X" to "amount of resource already spoken for at X."

### 5. Where this hooks into the tick

- **New `src/operations/logistics.ts`** (`class Logistics extends Operation`), added to `operationsFor()` (`operations/index.ts`) alongside the existing seven — order matters only for `structures()`, and `Logistics` likely returns nothing there initially (no new structures to place), so insertion point is low-risk.
- **`empire/creeps.ts`**: `runCreepBehaviors()` gains a branch for `role === "transport"` — reads `memory.logistics.current`/`next` (written by `execute.ts` from the `assignLogisticsTask` intent) and executes the current task via a small `NodeRef`-resolving verb shim, not the step table.
- `planLogistics` runs once per tick inside `Logistics.intents()`, not per-creep — this is what makes "state aware, no double-assignment" cheap: one pass builds `reserved`, then allocates, rather than each creep independently searching and colliding.

### 6. Interpreter salvage — concrete reuse boundary

Reuse: `resolveTarget`'s live-object matching helpers (`matchesWhere`, `belowFillTo`, `openHarvestTiles`, `toCandidate`, all in `targets.ts`) inside `providers()`/`consumers()` — no need to reinvent "is this container full."
Do NOT touch: `TargetSpec`, `Step`, `TaskState`, `firstRunnableStep`, `nextStep`, `coFireBonusStep`, or `hauler.ts`/`supply.ts` themselves — all untouched, still live, still the thing being compared against.
New, small: a verb-execution shim (pickup/withdraw/transfer given a concrete resolved object, not a spec). Worth factoring out of `interpreter.ts`'s `runStep` internals into a shared leaf module both the old step system and the new executor call, rather than duplicating the `creep.transfer(...)`-style calls — a no-behavior-change prep commit (step 0 below), with existing tests as the safety net.

## Migration sequence (test-first, each step independently committable)

Each numbered step below lists: the files it touches, what its own tests look like, and the exact existing file(s) to copy conventions from — so a fresh session can execute a step without re-deriving the codebase's patterns.

0. **Prep refactor: extract verb-execution leaves out of `interpreter.ts`.**
   - Touches: `src/behaviors/interpreter.ts` (remove), new `src/behaviors/actions.ts` or similar (add — final name/location is an implementation choice, not fixed by this plan).
   - What moves: the inner action closures currently inline in `runStep`'s `switch` (`interpreter.ts:95-160`) — the `creep.withdraw(...)`, `creep.pickup(...)`, `creep.transfer(...)`, `creep.harvest(...)`, `creep.upgradeController(...)`, `creep.build(...)`, `creep.repair(...)` calls — plus the range-check-then-act-or-travel pattern in `actOn()` (`interpreter.ts:191-210`) and `harvestStep()`/`upgradeStep()`'s equivalents, generalized to accept an already-resolved `RoomObject`/position rather than a `TargetSpec` to resolve. The extracted function's job: given a creep, a concrete target object, a verb, and a range, either act (if in range) or `travelTo` (if not and `allowTravel`), returning the same `StepResult{acted, didAct, target}` shape (`interpreter.ts:85-89`) — that shape is reused as-is, not redesigned.
   - What stays in `interpreter.ts`: `resolveTarget` calls, `TargetSpec`-to-target resolution, `STEP_KIND`/`isComplete`/`nextStep`/`firstRunnableStep`/`canCoFire` — all the step-table cursor logic, untouched.
   - Verification: no behavior change, so the existing test suite (`test/unit/building.test.ts` and whichever step-system tests currently exist — confirm via `Glob test/unit/**/*.test.ts` at execution time) must stay green with zero test-file edits. This is the safety net; if a test needs to change, the extraction wasn't behavior-preserving and needs rework.
   - Run `npm test` (confirm exact script name in `package.json` at execution time) before and after to prove parity.

1. **`src/logistics/graph.ts`: pure `providers()`/`consumers()`.**
   - Reuses `matchesWhere`, `belowFillTo`, `toCandidate` from `src/behaviors/targets.ts:73-100,149-158` — either import them directly (they're already exported or easily exportable) or duplicate the two-line logic if importing creates an awkward `logistics/` → `behaviors/` dependency the codebase's layering wants to avoid (check whether `operations/` already imports from `behaviors/` — `mining.ts:5-6` does, importing `roleDef` and `SOURCE_SATURATING_WORK`, so the precedent for `logistics/` importing from `behaviors/` is already established).
   - Test file: `test/unit/logistics/graph.test.ts` (new directory, mirrors `test/unit/operations/` convention — see `test/unit/operations/mining.test.ts` for the fixture-building style: a hand-built `ColonySnapshot` object, no `Game.*` mocking).
   - Concrete test cases: (a) a source container at `hasEnergy` with 300/2000 stored → one `Provider` with `available: 300`; (b) an extension at 30/50 → one `Consumer` with `wanted: 20`, `priority` at the spawn/extension tier; (c) a controller container above its 0.7 fill floor → excluded from `consumers()` (mirrors `belowFillTo`'s existing "controller container already at its floor must genuinely drop out" test coverage — check `test/unit/*.test.ts` for the existing `belowFillTo` test and mirror its fixture shape); (d) a dropped pile below the `WORTHWHILE_FLOOR`/`WORTHWHILE_FRACTION` bar (`targets.ts:291-297`) — decide whether `providers()` reuses `isWorthwhile` too (likely yes, same reasoning: a tiny drop pile isn't worth a purpose-built trip) or whether "worthwhile" is a per-creep concept (dependent on the creep's free capacity) that doesn't translate cleanly to a colony-level `Provider.available` figure — **this is a design decision to make during step 1, not resolved by this plan**.

2. **`src/logistics/allocate.ts`: pure `allocate()`.**
   - No dependencies on `graph.ts`'s internals beyond its exported `Provider`/`Consumer` types — fully unit-testable with hand-built `Provider[]`/`Consumer[]` arrays, no snapshot needed at all.
   - Test file: `test/unit/logistics/allocate.test.ts`.
   - Concrete test cases (the ones the user named as hard requirements — make sure these exact scenarios are covered): (a) two idle creeps, one under-filled extension with `wanted` less than both creeps' combined capacity → only one creep gets a `deliver` task to that extension, the second either gets a different consumer or no task; (b) a creep with a partially-loaded store → its first task is `deliver` (using current load), never a redundant `pickup`; (c) `reserved` pre-populated from an "already mid-task" creep (simulating `memory.logistics.current` folded in) → a second creep's allocation must not target the same provider/consumer past its remaining capacity; (d) more `consumers()` demand than `providers()` supply → highest-`priority` consumers get served first, lower-priority ones get nothing this tick (not partial/starved allocations split thin).

3. **Wiring: `src/logistics/index.ts` (`planLogistics`), memory/schema/intent additions.**
   - `src/memory/schema.ts`: add `"transport"` to the `RoleName` union (line 32-43) and add `logistics?: { current?: LogisticsTask; next?: LogisticsTask };` to `CreepMemory` (sibling to `task` at line 21) — note the file's own header rule: *"Each field is owned by exactly one system; others read it via the snapshot, never write it"* (`schema.ts:1`) — `logistics` is owned by `execute.ts`'s new intent handler (write) and `empire/creeps.ts`'s transport branch (read/consume `current`, does NOT write it directly — matches how `task` is written only by `execute.ts` and `empire/creeps.ts`'s `runOne`, per the existing comment at `interpreter.ts` usage sites).
   - `src/behaviors/roles/index.ts`: add a `"transport"` entry to `ROLES` (see the `roleDef`/`ROLES` gap called out above in §2 of the data model section) — likely a new small file `src/behaviors/roles/transport.ts` mirroring `hauler.ts`'s shape (body calculator, priority) but with `steps: []`.
   - `src/intents/types.ts`: add `{ kind: "assignLogisticsTask"; creep: Id<Creep>; task: LogisticsTask }` to the `Intent` union (near `setCreepRole`, line 21, since it's the closest precedent).
   - `src/intents/execute.ts`: add a `case "assignLogisticsTask":` handler, modeled directly on the existing `case "setCreepRole":` handler (`execute.ts:60-68` — look up creep by id, `ERR_NOT_FOUND` if missing, write into `creep.memory.logistics`). Confirm the exact return-code/idempotency convention used by sibling handlers (`setCreepRole`'s `if (creep.memory.role === intent.role) return OK` idempotency check, line 63) and mirror it if a repeated identical assignment should also no-op.
   - Test file: `test/unit/logistics/index.test.ts` or extend `test/unit/logistics/graph.test.ts`/`allocate.test.ts` coverage — `planLogistics` itself is thin (wires graph+allocate+reserved-folding), so may not need extensive standalone tests beyond an integration-style "given a snapshot with one idle transport creep, one provider, one consumer, produces one assignment" case.

4. **`src/operations/logistics.ts` (`Logistics extends Operation`), registered in `operations/index.ts`.**
   - Mirror `src/operations/supply.ts`'s overall shape (small, single-responsibility, `desiredCreeps` only, no `structures()`/`intents()` needed for spawn demand) but add an `intents()` override that calls `planLogistics()` and maps its output to `assignLogisticsTask` intents (see `operation.ts:67-74`'s doc comment on `intents()` — "Direct action, not arbitrated — runs every tick").
   - `desiredCreeps` sizing: start conservative — a flat quota via `this.fillRole(colony, "transport", wanted, priority)` (the shared helper, `operation.ts:48-55`) with `wanted` as a small fixed number (e.g. 1-2) or gated behind an explicit config flag, NOT sized to replace hauler/supply capacity yet. Refine toward `Mining.wantedHaulers()`-shaped throughput sizing only once step 6's benchmark data exists to size against (see Open Question 2).
   - `operations/index.ts`: add `import { Logistics } from "./logistics";`, add `new Logistics(room)` to the array in `operationsFor()` (`operations/index.ts:23-33`) — position in the array only matters for `structures()` ordering (each operation paths against earlier ones' claims, per `Mining` pathing first); since `Logistics` returns no `structures()` initially, insertion point is safe anywhere, but conventionally append at the end near `Supply` since they're conceptually related.
   - Also export `Logistics` from `operations/index.ts`'s re-export block (lines 12-19) for test-file imports, matching every other operation.
   - Test file: `test/unit/operations/logistics.test.ts`, mirror `test/unit/operations/supply.test.ts`'s structure exactly (it's the smallest/simplest existing operation test, good template).

5. **Wire the `"transport"` branch into `src/empire/creeps.ts`.**
   - `runCreepBehaviors()` (`empire/creeps.ts:16-22`) iterates `Game.creeps` and calls `runOne(creep)` — add a branch at the top of `runOne` (or in the loop, before `runOne` is called) checking `creep.memory.role === "transport"` and dispatching to a new function (e.g. `runTransport(creep)`) instead of falling into the `roleDef`/step-table path at line 37 onward. Must come before the `def.steps.length === 0` early-return (line 38) since `"transport"`'s `ROLES` entry deliberately has empty `steps`.
   - `runTransport(creep)`: reads `creep.memory.logistics?.current`; if present, resolves its `NodeRef` to a live object (small switch on `NodeRef.kind` → `Game.getObjectById`), calls the appropriate verb via the step-0-extracted action shim (pickup/withdraw/transfer based on `LogisticsTask.kind` — `"pickup"` reads from `from`, `"deliver"` writes to `to`), and on completion (store full for pickup, store empty or target full for deliver) promotes `next` into `current` (or clears `current` for the next `planLogistics` pass to fill) — mirrors `runOne`'s existing "carry target/step to next tick" pattern (`empire/creeps.ts:60-63`) closely enough that it's worth re-reading those exact lines while implementing this.
   - This function does NOT call `planLogistics` per-creep — that already ran once per tick inside `Logistics.intents()` upstream (step 4) and its output already landed in `memory.logistics` via the intent/execute.ts pipeline by the time `runCreepBehaviors()` executes.
   - **Tick ordering confirmed** (`src/kernel/tick.ts:36-49`, `SYSTEMS` array): `"operations"` is tier 1 and listed *before* `"creeps"`; `tick()`'s loop (lines 66-79) calls `execute(sys.run(...))` synchronously per system, in array order, before moving to the next system. So `Logistics.intents()` (part of the `"operations"` system, line 38: `runOperations` flat-maps every operation's `intents()`) is called and its `assignLogisticsTask` intents are `execute()`d — writing `creep.memory.logistics` — *before* the `"creeps"` system (line 41, wraps `e.creeps()` → `runCreepBehaviors()`) runs the same tick. **Same-tick handoff, no one-tick delay**: a creep that goes idle and gets a fresh assignment this tick acts on it this same tick. This confirms `planLogistics`'s "state aware" requirement is cheap and correct as designed — no race, no stale read.

6. **First benchmark pass.** `Logistics` live alongside full-strength `Mining` haulers and `Supply`, on a job they don't already cover well (tower refill / controller-container consolidation, so there's no target contention to confound the comparison). Compare against committed baselines in `test/benchmark/` (`npm run bench`, per [[Milestone benchmarks]] memory — records RCL2 ticks, RCL2+extensions ticks, harvest rate; also see [[Cold-boot history benchmark]] for the 20k-tick always-passing variant).

7. **Only after step 6 holds up**: consider a `maxHaulers: 0` experiment on a branch/worktree to test whether `Logistics` alone covers source→spawn/extension across RCL1–4, compared against the current hauler-covered baseline. This is the point where deleting `hauler.ts` becomes a real, separately-scoped decision — not assumed here.

## Open questions
1. **Idle-creep ordering in `allocate()`** — nearest-to-highest-priority-consumer first, or largest-capacity-creep-to-largest-job first? Worth a quick benchmark comparison rather than guessing.
2. **Where does throughput-based sizing math live once `Logistics` needs it** — duplicate a `Mining.wantedHaulers()`-shaped formula inside `Logistics`, or have `Logistics` read `Mining`'s already-computed income as one input? Leaning toward the latter (Mining stays the income authority; `Logistics` combines it with `consumers()`' total `wanted`) — but this only matters once `Logistics` is sizing for jobs that overlap with what `Mining`'s haulers already income-track, which isn't step 4's initial conservative quota.
3. **`sweep` behavior** (`behaviors/sweep.ts`, opportunistic en-route pickup) — does a `transport` creep need an equivalent, or does re-running `allocate()` every tick (which would surface a newly-dropped pile as a fresh `Provider`) make it redundant? Worth confirming sweep's real benefit isn't silently lost once there's a real workload to compare against.
4. **Pre-storage phase behavior** — no live risk right now since `hauler.ts` is untouched, but once `Logistics` starts covering that leg (step 7), the graph's `Consumer.priority` ordering needs to reproduce the same pre-/post-storage phase switch `hauler.ts`'s comment block documents (lines 28-36), or risk the same class of stall bug noted in [[traveler-mineral-obstacle]] / [[rewrite-branch-rcl2-stall]].

## Files touched, by step (quick reference)

| Step | New files | Modified files |
|---|---|---|
| 0 | `src/behaviors/actions.ts` (or similar — name TBD) | `src/behaviors/interpreter.ts` |
| 1 | `src/logistics/graph.ts`, `test/unit/logistics/graph.test.ts` | — |
| 2 | `src/logistics/allocate.ts`, `test/unit/logistics/allocate.test.ts` | — |
| 3 | `src/logistics/index.ts`, `src/logistics/types.ts`, `src/behaviors/roles/transport.ts` | `src/memory/schema.ts`, `src/behaviors/roles/index.ts`, `src/intents/types.ts`, `src/intents/execute.ts` |
| 4 | `src/operations/logistics.ts`, `test/unit/operations/logistics.test.ts` | `src/operations/index.ts` |
| 5 | — | `src/empire/creeps.ts` |
| 6 | — | none (benchmark run only, compare against `test/benchmark/` committed baselines) |
| 7 (later, separately scoped) | — | `src/operations/mining.ts` (`config.maxHaulers`) on a branch/worktree only |

`src/kernel/tick.ts` is **not modified** — `Logistics` fits the existing `SYSTEMS` pipeline (`"operations"` tier already flat-maps every operation's `intents()`) with zero changes to the tick loop itself.

## Testing conventions to follow (confirm exact commands at execution time — not re-verified in this plan)
- Unit tests: Vitest, colocated under `test/unit/**`, mirroring `src/**` structure (`test/unit/operations/*.test.ts` ↔ `src/operations/*.ts`) — a `test/unit/logistics/` directory is the natural new home.
- Fixture style: hand-built plain-object `ColonySnapshot`s, no `Game.*` mocking for pure-function tests (see `test/unit/operations/mining.test.ts`/`upgrading.test.ts` for the exact fixture shape to copy).
- Per [[Fast bench loop]] memory: a 52s cold-boot loop (1500 ticks, `--disableConsoleIntercept`) exists for iterating on economy regressions faster than the full benchmark suite — useful during step 6 iteration, not just the final check.
- Per [[A/B bench driver casing]] memory (Windows-specific gotcha): custom vitest bench drivers require cwd to be uppercase `C:/` or the suite silently collects 0 tests; run bench samples sequentially, not parallel.
- Run the full `npm run bench` (or confirm exact script name) before/after step 6 and compare against committed history in `test/benchmark/benchmarks.json` / `test/benchmark/slow/benchmarks-slow.json`.

## What this explicitly does NOT do
- No deletion of `hauler.ts`, `supply.ts`, or any change to `Mining`'s hauler-request logic beyond the `maxHaulers` config value used only in a later, separately-scoped A/B.
- No link operation / `src/operations/links.ts` this pass — graph shapes are link-ready, not link-implementing.
- No change to miner/builder/upgrader/scout roles or the step system — `TargetSpec`/`Step`/`TaskState` untouched.
- No full-plan-commitment queue — creeps hold at most `current` + `next`, both re-derivable each tick.
