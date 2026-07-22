# PRD: Mining as the first Operation

> **Superseded — do not implement.** Its ADR was replaced by
> [ADR 0005](../adr/0005-empire-colony-operations-staged.md), which stages the work
> around spawning rather than starting from a single operation. A replacement PRD
> should be written per stage.

Implements [ADR 0004](../adr/0004-mining-as-the-first-operation.md). Read that first —
it carries the reasoning; this document carries the decisions and the acceptance gate.

**Type:** behaviour-preserving refactor. No gameplay change is intended, wanted, or
acceptable. Every judgement call in this document resolves toward "the bot does
exactly what it did before."

---

## 1. Goal

Collapse mining's three-way split (`systems/mining.ts` structure placement,
`systems/logistics.ts` quotas, spawning's hardcoded census) into a single `Mining`
operation, and make `planSpawning` / `planBuilding` poll operations rather than
import specific capabilities by name.

**Done means:** `npm test` green, `npm run bench` within noise of the committed
history, and `systems/building.ts` contains no reference to mining.

## 2. Non-goals

Do not build, and reject any suggestion to build:

- `Empire` or `Colony` classes
- `RoomSnapshot` / the `ColonySnapshot` split
- Flag commands, `commands/flags.ts`
- `canAfford`, creep-to-operation binding, per-role files
- `RemoteMining` or any second operation
- Any change to role bodies, step lists, quota formulas, or CPU tier values

If the implementation seems to *need* one of these, stop and report rather than
building it — that is a finding about the ADR, not a task to complete.

## 3. Target structure

```
src/operations/
  types.ts        # Operation interface
  index.ts        # operationsFor(), mergeCensus()
  mining.ts       # mining() factory
```

### 3.1 Module direction (decided — do not rearrange)

`src/operations/` imports from `snapshot/`, `layouts/`, `lib/`, `behaviors/`,
`intents/`, `memory/`. Nothing else imports *from* `kernel/`, which stays a leaf that
only `main.ts` reaches.

`systems/spawning.ts`, `systems/building.ts`, and `kernel/tick.ts` all import
**down** into `operations/`. This is why `operationsFor` lives in `operations/index.ts`
and not `kernel/operations.ts` — the latter would make `systems/` import from
`kernel/` while `kernel/tick.ts` imports from `systems/`, a cycle.

### 3.2 The interface

```ts
// src/operations/types.ts
import type { PlacedStructure } from "../layouts/stamp";
import type { Intent } from "../intents/types";
import type { Census, EmpireSnapshot } from "../snapshot/types";

export interface Operation {
  /** Stable identity, e.g. "mining:W1N1". Not yet used as a memory key; present so
   *  logging and future memory-keyed state have one obvious answer. */
  readonly name: string;

  /** Creeps this operation wants. Counts SUM across operations (see mergeCensus). */
  desiredCreeps(snap: EmpireSnapshot): Census;

  /** Structures this operation wants to exist EVENTUALLY — the full RCL8 intent,
   *  ungated by RCL or budget. Callers decide what is buildable now. */
  structures(snap: EmpireSnapshot): PlacedStructure[];

  /** What this operation does this tick. */
  plan(snap: EmpireSnapshot): Intent[];
}
```

All three methods are required. An operation wanting nothing returns `{}` / `[]`.

### 3.3 Construction — factories, not classes (decided)

Operations are **closure factories returning `Operation`**, not classes. `src/` has no
classes today outside the vendored `lib/traveler.ts`; do not introduce the first one
here.

```ts
// src/operations/index.ts
export function operationsFor(colony: ColonySnapshot): Operation[] {
  return [mining(colony.name)];
}
```

Two properties this buys, both load-bearing:

- **`extends` is structurally impossible.** ADR 0003 mandates composition — a future
  `RemoteMining` *holds* a `mining()` instance and delegates to it explicitly. With
  factories there is no base class to inherit from, so the banned option cannot be
  reached for. (Legacy's `RemoteMiningOperation extends FlagOperation` is the pattern
  being moved away from.)
- **No `this`.** Methods cannot be detached from their object, so
  `ops.map(op => op.desiredCreeps)` cannot produce a runtime `this`-is-undefined
  failure that TypeScript will not catch.

**Factories take identity, never data.** `mining("W1N1")` closes over a room name. It
must not accept a snapshot, must not path, must not read Memory. This is load-bearing:
`planSpawning` is tier 1 and constructs operations every tick regardless of CPU
pressure (§3.6).

Return the object literal directly with the `Operation` return type annotated, so
nothing beyond the interface can leak out. Do not add public helpers to the returned
object — anything an operation needs internally stays a closure-scoped `const`.

Instances are per-tick and disposable. `operationsFor` may be called several times in
one tick by different callers; each gets fresh instances. That is fine and expected.

### 3.4 Mining

`src/operations/mining.ts` absorbs, verbatim where possible:

| From | What |
|---|---|
| `systems/mining.ts` | `sourceSpots`, `sourceStructureType`, `MIN_CONTAINER_RCL`, `LINK_RCL`; `minedStructures` → `structures()`; `planMining` → `plan()` |
| `systems/logistics.ts` | `desiredMinerCount`, `desiredHaulerCount`, `minerWorkParts`, `WORK_PER_SOURCE`, `MIN_HAULER_ENERGY` → merged into `desiredCreeps()` |

```ts
export function mining(room: string): Operation {
  // Per-instance memo; see §3.5. Lives here, not on the returned object.
  let spots: Map<SnapSource, XY> | undefined;

  const colonyIn = (snap: EmpireSnapshot) => snap.colonies.find(c => c.name === room);
  const sourceSpots = (colony: ColonySnapshot) => (spots ??= computeSourceSpots(colony));

  return {
    name: `mining:${room}`,

    desiredCreeps(snap) {
      const colony = colonyIn(snap);
      if (!colony) return {};
      return { miner: desiredMinerCount(colony), hauler: desiredHaulerCount(colony) };
    },

    // structures(), plan() likewise resolve the colony by name first.
  };
}
```

The returned literal is checked against the annotated `Operation` return type, so
parameter types on the methods are inferred — no need to restate `snap:
EmpireSnapshot` on each.

Resolving `room` against the snapshot yields `undefined` if the room is not in
`snap.colonies` (lost, or not yet visible). Every method returns empty in that case —
do not throw.

`Mining` owns **both** `miner` and `hauler`. Their quotas are mutually dependent
(miner count is capped by hauler count; hauler count derives from container fill), so
they are one quota with two outputs.

**Preserve the ADR-0001 comments** on the cold-start seed and the
haulers-only-count-as-collectors rule when moving that code. They record decisions
that are not re-derivable from the formula.

### 3.5 Per-tick memoization (decided — required)

`sourceSpots()` runs `buildCostMatrix` + `sourceRoadPath` per source. It is real
pathfinding and is the one place this refactor could regress CPU: under the new shape
`structures()` may be called twice per tick (from `wantedStructures` *and*
`planColony`) plus once from `plan()`.

Memoize lazily in the factory's closure (shown in §3.4):

```ts
let spots: Map<SnapSource, XY> | undefined;
const sourceSpots = (colony: ColonySnapshot) => (spots ??= computeSourceSpots(colony));
```

Lazy, so the factory call stays free. Closure-scoped, so the cache lifetime is exactly
one instance — i.e. one tick — and cannot go stale, and is genuinely unreachable from
outside rather than `private` by convention. Note this makes an instance
single-colony, which it already is since `room` is fixed.

`computeSourceSpots` is the module-level pure function moved from `systems/mining.ts`;
only the caching wrapper lives in the closure.

Today `minedStructures` is called twice per tick with no memoization, so this is a
small CPU *improvement*, not a regression.

### 3.6 Spawning

`planSpawning` keeps `PRIORITY`, `recoveryRole`, the affordability guard, and
`bodyContext` unchanged. Only `desiredCensus` changes:

```ts
export function desiredCensus(colony: ColonySnapshot, snap: EmpireSnapshot): Census {
  const fromOps = mergeCensus(operationsFor(colony).map(op => op.desiredCreeps(snap)));
  return {
    bootstrap: desiredBootstrapCount(colony),
    upgrader: desiredUpgraderCount(colony),
    builder: desiredBuilderCount(colony),
    ...fromOps
  };
}
```

`mergeCensus` **sums** counts per role across operations (correct for two remote mines
each wanting their own haulers). It lives in `operations/index.ts`.

The four unowned roles are intentional, visible debt — each is a future operation, and
the `...fromOps` spread is where they land as they migrate.

**`desiredCreeps()` must never be gated by tier or interval.** `planSpawning` is
tier 1; only `plan()` runs on the throttled path.

### 3.7 Building

Replace the named import with a poll:

```ts
// was: import { minedStructures } from "./mining";
function operationStructures(colony: ColonySnapshot, snap: EmpireSnapshot) {
  return operationsFor(colony).flatMap(op => op.structures(snap));
}
```

**Gating stays in `building.ts`.** The two existing call sites treat the structure set
differently and must keep doing so:

- `wantedStructures` (building.ts:67) — filters containers below `CONTAINERS_FROM_RCL`,
  then sorts by `typePriority`.
- `planColony` (building.ts:88) — uses the **unfiltered** set as demolition protection,
  so an existing early container is not torn down for being ahead of schedule.

If `structures()` self-gated by RCL, the second site would start demolishing early
containers. It must not.

`wantedStructures` gains a snapshot parameter. Signature:
`wantedStructures(colony: ColonySnapshot, snap: EmpireSnapshot)`.

### 3.8 Tick

`SYSTEMS` swaps its `mining` entry for `operations`, keeping tier and interval
identical so the change is CPU-neutral by construction:

```ts
{ name: "operations", tier: 2, interval: 50, run: planOperations },
```

`planOperations` lives in `operations/index.ts`:

```ts
export function planOperations(snap: EmpireSnapshot): Intent[] {
  return snap.colonies.flatMap(colony =>
    operationsFor(colony).flatMap(op => op.plan(snap))
  );
}
```

## 4. Call sites to update

`wantedStructures` and `minedStructures` have callers outside `src/`. All must move in
**one commit** — seeding derives its structure set from the planner, so a divergence
silently invalidates the RCL3 benchmark instead of failing loudly.

| File | Change |
|---|---|
| `src/systems/building.ts` | drop mining import; add `operationStructures`; thread snapshot |
| `src/systems/spawning.ts` | `desiredCensus` merges from operations |
| `src/systems/logistics.ts` | **delete** |
| `src/systems/mining.ts` | **delete** (moved to `operations/mining.ts`) |
| `src/kernel/tick.ts` | `mining` entry → `operations` |
| `test/integration/seed.ts:299` | pass snapshot to `wantedStructures` |
| `test/benchmark/milestones-rcl3-from-seed.test.ts:62` | same |
| `test/unit/building.test.ts` | 4 × `minedStructures` → `mining(room).structures(snap)` |
| `test/unit/mining.test.ts` + `test/unit/logistics.test.ts` | merge → `test/unit/operations/mining.test.ts` |

## 5. Sequence (test-first)

1. **Write `operations/types.ts`.** Interface only, no implementation.
2. **Merge the two test files** into `test/unit/operations/mining.test.ts`, rewritten
   against `mining(...)`. They fail to compile — that is the red state.
3. **Implement `Mining`** by moving code. Green.
4. **Add `operations/index.ts`** (`operationsFor`, `mergeCensus`, `planOperations`)
   with unit tests for `mergeCensus` summing across operations.
5. **Rewire `spawning.ts`**, keeping `test/unit/spawning.test.ts` green.
6. **Rewire `building.ts`**, keeping `test/unit/building.test.ts` green. Assert the
   demolition-protection behaviour explicitly if no test covers it today.
7. **Rewire `tick.ts`**; delete `systems/mining.ts` and `systems/logistics.ts`.
8. **Run the gate** (§6).

Commit as one unit once §6 passes.

## 6. Acceptance

**Hard gate — all must hold.**

1. `npm test` green. Total test count does not decrease.
2. `npm run lint` clean.
3. `npm run bench` — each milestone within noise of the committed history in
   `test/benchmark/benchmarks.json`:

   | Milestone | Expected |
   |---|---|
   | `rcl2` | ~775 ticks |
   | `rcl2-extensions-built` | ~3050 ticks |
   | `rcl3` | ~7300 ticks |
   | `rcl3-buildings-built` | ~11400 ticks |

   Run-to-run spread in the existing history is roughly ±3%. Treat **>5% on any
   milestone as a failure**, not as noise: this refactor changes no behaviour, so a
   real move means something was not preserved. Report it rather than adjusting the
   benchmark.
4. `grep -rn "mining\|logistics" src/systems/` returns nothing.
5. No file in `src/operations/` imports from `src/kernel/` or `src/systems/`.

**Report on completion:** the four bench numbers against the previous run, the test
count before and after, and any point where §2's non-goals felt necessary.

## 7. Notes for the implementer

- `EmpireSnapshot` is passed by reference; passing the whole snapshot everywhere costs
  nothing. Do not slim it for performance.
- The factory style (§3.3) is a deliberate choice, not an oversight. Do not convert
  operations to classes, and do not add a base factory that other operations call
  through to get shared behaviour — that reintroduces inheritance under another name.
  Shared logic between operations belongs in module-level pure functions that each
  factory calls, the way `computeSourceSpots` is called from `mining()`.
- The `roleDef("miner")` lookup inside `minerWorkParts` asks the role table for its
  own body formula rather than restating it. Keep that — it is why the quota tracks
  body changes automatically.
- `systems/creeps.ts` deliberately acts directly instead of returning intents
  (travelTo holds path state). Out of scope; do not "fix" it.
- If the bench moves more than 5%, the likeliest cause is `structures()` gating that
  should have stayed in `building.ts` (§3.7), or a lost `??` fallback in the census
  merge. Check those two before anything else.
