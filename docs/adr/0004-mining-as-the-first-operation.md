# Mining as the first Operation (narrows ADR 0003)

> **Superseded by [ADR 0005](0005-empire-colony-operations-staged.md).** Narrowing to
> one operation was the wrong cut: with a single `Mining` the load-bearing questions
> (census keying by operation, cross-operation arbitration, role collision) are all
> invisible, and this ADR's answer to them — "counts just sum, creeps are not bound to
> operations" — is incoherent as soon as a second operation exists. 0005 stages the
> work around spawning instead. `docs/prd/0004-mining-operation.md` is superseded with
> it and should not be implemented.

ADR 0003 diagnosed the `systems/*.ts` layout correctly: mining's quota lives in
`logistics.ts`, its structure placement in `mining.ts`, its role in the shared
`roles.ts` table, and room-scoping is a `for (const colony of snap.colonies)` loop
repeated in five files. That diagnosis stands.

Its prescription designed `Empire`, `Colony`, `Operation`, `RoomSnapshot`, flag
commands, per-role files and multi-room support in one step, and the seams between
those pieces have holes its own author cannot answer:

1. `plan(colony, empire)` has no parameter for the operation's target room, yet the
   headline claim is that the target room is a constructor argument.
2. Operations are "constructed fresh every tick from typed Memory and live flags",
   but planning code may not read `Game.flags` — so it is unspecified who constructs
   them and from what.
3. `tick.ts`'s tier/interval CPU degradation has no counterpart in the new shape.
4. "Two live instances never claim the same role" is asserted, not mechanised: two
   `RemoteMining` instances both wanting `hauler` have no arbitration, and a spawned
   creep has no operation binding (`CreepMemory.role` is global).
5. `Colony.canAfford(op)` appears in the diagram and nowhere in the prose.
6. Mining's own quota is entangled with haulers (`desiredMinerCount` is capped by
   hauler count), so "one operation owns mining" crosses a boundary on day one.

Questions 1, 2 and 4 only have real answers once a *second* operation exists to
create the conflict. Designing them now is speculation. This ADR therefore keeps
0003's diagnosis and target shape but ships the smallest thing that proves it.

## Decision

Build exactly one operation — `Mining` — and change nothing else. No `Empire` class,
no `Colony` class, no `RoomSnapshot`, no flags, no per-role files, no multi-room.

### Where operations are created and `plan()` is called

`kernel/tick.ts` keeps its existing `System` array. One new system entry,
`operations`, owns the whole operation layer:

```ts
// kernel/operations.ts
export function planOperations(snap: EmpireSnapshot): Intent[] {
  return snap.colonies.flatMap(colony =>
    operationsFor(colony).flatMap(op => op.plan(snap))
  );
}

// Pure: colony snapshot in, operation instances out. The one place that knows
// which operations a colony runs.
export function operationsFor(colony: ColonySnapshot): Operation[] {
  return [new Mining(colony.name)];
}
```

Three consequences worth stating outright:

- **Construction site**: `operationsFor(colony)`, called from `planOperations`. Not a
  `Colony` class — there is no state for one to hold yet, and introducing the class
  before it has behaviour is the speculation this ADR is avoiding. When `Colony`
  earns its existence, `operationsFor` is its constructor body.
- **Instances are per-tick and hold identity, not data.** `new Mining("W1N1")` takes
  the room *name*, never a snapshot. This is the answer to 0003's question 1: an
  operation stores the identity of what it operates on, and receives the data as a
  `plan()` argument. A `RemoteMining("W1N1", "W2N1")` therefore already has its
  target room as a constructor argument, exactly as 0003 wanted, with no snapshot
  staleness and no per-tick data on the instance.
- **`plan()` takes the whole `EmpireSnapshot`**, not a `ColonySnapshot`. The
  operation looks up the rooms it needs by name. This is why `RoomSnapshot` is not
  needed yet: `Mining` only ever looks up its own colony. When `RemoteMining` needs a
  room the empire does not own, that is the moment to split `RoomSnapshot` out of
  `ColonySnapshot` — driven by a real caller instead of anticipated.

### The Operation interface

```ts
export interface Operation {
  readonly name: string;              // stable identity, e.g. "mining:W1N1"
  desiredCreeps(snap: EmpireSnapshot): Census;
  structures(snap: EmpireSnapshot): PlacedStructure[];
  plan(snap: EmpireSnapshot): Intent[];
}
```

`desiredCreeps` and `structures` are required, not optional as in 0003 — an operation
wanting neither returns `{}` / `[]`, which is one less branch at every call site.

Three methods, three questions an operation answers about itself: *what creeps do you
want*, *what structures do you need built*, *what are you doing this tick*. Each is
polled by a different caller (`planSpawning`, `planBuilding`, `planOperations`) and
none of them needs to know which operations a colony runs.

### Spawning still arbitrates, and still sees the whole census

`planSpawning` keeps its `PRIORITY` list and its deficit logic. Only the source of
`desiredCensus` changes: instead of importing `desiredMinerCount` from `logistics.ts`,
it merges what the colony's operations ask for with the roles no operation owns yet:

```ts
function desiredCensus(colony, snap): Census {
  const fromOps = mergeCensus(operationsFor(colony).map(op => op.desiredCreeps(snap)));
  return {
    bootstrap: desiredBootstrapCount(colony),   // not yet an operation
    upgrader: desiredUpgraderCount(colony),     // not yet an operation
    builder: desiredBuilderCount(colony),       // not yet an operation
    ...fromOps                                  // miner, hauler — owned by Mining
  };
}
```

`mergeCensus` sums counts across operations. Summing is right for the case that
actually exists (two remote mines each needing their own haulers) and is trivially
replaced if a future operation needs max-semantics. This is 0003's question 4, given
the smallest answer that is not wrong: **operations may both want a role, the counts
add, and no creep-to-operation binding exists.** Binding creeps to operations is
deferred until an operation needs to address its own creeps individually — which
`Mining` does not.

### What Mining owns

One file, `operations/mining.ts`, containing what is today spread across three:

- `desiredCreeps()` — the `miner` and `hauler` quotas, moved verbatim from
  `logistics.ts`, which is then deleted.
- `plan()` — the `recordSourceSpot` intents, moved from `systems/mining.ts`.
- `structures()` — the per-source container/link declaration, moved from
  `minedStructures`.

`Mining` owns **both** `miner` and `hauler`. This is 0003's question 6, answered by
scope rather than by architecture: `desiredMinerCount` is capped by hauler count and
`desiredHaulerCount` is derived from container fill, so the two are one quota with two
outputs. Splitting them across operations would recreate the cross-operation read the
whole exercise is meant to remove. If a future `Logistics` operation claims haulers,
that split gets its own decision.

### Building polls operations instead of importing them

`systems/building.ts` currently does `import { minedStructures } from "./mining"` —
a named import of one specific capability, which is the cross-module read 0003
objects to. It is replaced by a poll over the same `operationsFor(colony)` list that
`planSpawning` uses:

```ts
function operationStructures(colony: ColonySnapshot, snap: EmpireSnapshot) {
  return operationsFor(colony).flatMap(op => op.structures(snap));
}
```

`building.ts` then knows only that colonies have operations and operations declare
structures. Adding `RemoteMining` later contributes its remote containers with no
edit to `building.ts` at all — which is the actual test of whether this refactor
bought anything.

**The gating stays in `building.ts`, not in the operation.** `minedStructures` is
called from two places today with deliberately different treatment:

- `wantedStructures` filters containers below `CONTAINERS_FROM_RCL` (a container
  built before miners exist is 5000 energy in a scarce focus slot), then sorts
  everything by `typePriority`.
- `planColony` uses the *unfiltered* set as demolition protection, so a container
  that already exists at RCL2 is not torn down for being ahead of schedule.

So `structures()` answers "what does this operation want to exist, eventually" —
the full RCL8 intent, ungated. What is buildable *now*, in what order, against
`FOCUS_SITE_CAP`, remains `building.ts`'s decision. An operation declaring a
structure does not get to decide the colony's construction budget; that is one
concern owning one budget, and it stays whole.

This is the same split the ADR makes for creeps: operations state demand
(`desiredCreeps`), a single arbiter (`planSpawning`) decides what is affordable.
`structures()` is that shape applied to construction.

### CPU tiers stay where they are

The `operations` system is a normal `System` entry and inherits `tier`/`interval`
unchanged. `Mining` moves in at tier 2 / interval 50, matching what `systems/mining.ts`
has today, so this ADR is CPU-neutral by construction.

The one rule that follows: **`desiredCreeps()` must not be gated by tier or interval.**
`planSpawning` is tier 1 and calls `operationsFor` directly; only `plan()` runs on the
throttled path. Constructing an operation must therefore stay cheap — identity only,
no pathfinding in constructors. That is 0003's question 3, and it is the reason the
constructor takes a room name rather than doing work.

### Explicitly not decided here

`Empire`/`Colony` classes; `RoomSnapshot`; flag commands; per-role files; creep-to-
operation binding; `canAfford`; multi-room. Each is revisited when a concrete second
operation forces it, and 0003 remains the sketch of where that is heading.

## Consequences

- The proof case is verifiable rather than argued: `npm run bench` must show RCL2,
  RCL2+extensions and RCL3 within noise of the current history, since no behaviour
  changes. A regression means the refactor was not behaviour-preserving.
- `systems/logistics.ts` is deleted; `systems/mining.ts` becomes
  `operations/mining.ts`; `test/unit/logistics.test.ts` and `test/unit/mining.test.ts`
  merge into `test/unit/operations/mining.test.ts`, testing one object instead of two
  free functions. Test count should not drop.
- `wantedStructures(colony)` gains a snapshot parameter (it must reach
  `operationsFor`), which touches three non-src callers: `test/integration/seed.ts`,
  `test/benchmark/milestones-rcl3-from-seed.test.ts`, and `test/unit/building.test.ts`
  (which imports `minedStructures` directly in four places). Those call sites are the
  reason to do this migration in one commit rather than leaving both paths alive —
  seeding derives its structure set from the planner, so a divergence there silently
  invalidates the RCL3 benchmark rather than failing loudly.
- `desiredCensus` still names four roles no operation owns. That is visible,
  intentional debt: each is a candidate operation (`Bootstrap`, `Upgrading`,
  `Building`), and the `...fromOps` spread is where they land as they migrate.
- If `Mining` lands and questions 1, 2 and 4 still feel unanswered, the second
  operation is the experiment that answers them — not another design round.
- Legacy's faster cold start to RCL2 (~402 ticks vs ~775, per the `legacy-rcl2`
  benchmark series) is a prioritisation difference, not a structural one, and is
  orthogonal to this ADR. Worth chasing separately; legacy reaches RCL2 sooner and
  then builds nothing (`sinkConstruction: 0`, RCL2+extensions never reached), so the
  win is real only at the very start.
