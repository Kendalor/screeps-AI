# PRD: Operations — capabilities that own their demand

Implements **stage 3** of [ADR 0005](../adr/0005-empire-colony-operations-staged.md).
Read that first — it carries the reasoning; this document carries the decisions and the
acceptance gate. It follows [PRD 0005 (stage 2)](0005-spawn-requests.md), which built the
request model this stage moves into operations.

Stages 1 and 2 are **done**: `src/colony/`, `src/empire/`, `CreepRequest`, `SnapCreep`,
and six free request functions feeding a `planSpawning` arbiter that knows no role names.

**Type:** infrastructure refactor. This stage builds the skeleton — the `Operation` type,
where operations hang, and how arbiters poll them. Every quota *formula* and every
placement derivation is ported verbatim. **Do not tune, min-max, or "improve" any
behaviour here.** Where this document and an existing formula disagree, the formula wins
and the disagreement is a finding to report, not to fix.

---

## 1. Goal

An **operation is a capability that owns everything that capability needs** — which creeps,
which structures, at which moment, given colony state. `Mining` is the proof: it owns
miners, the haulers that carry what miners produce, and the per-source containers/links
they drop into.

Arbiters stop importing sibling systems and start polling `colony.operations`.

**Done means:** `npm test` green (unit + `test/integration/`), `npm run lint` clean,
`src/systems/logistics.ts` deleted, and `Mining` is the sole owner of miner demand, hauler
demand, and per-source structure placement.

## 2. Non-goals

Do not build, and reject any suggestion to build:

- More than one operation (§4.1 — `Mining` only; the other four requesters stay free functions)
- A `Bunker` operation (§5 — the room planner is a capability, not an operation)
- Persisted operation state, an operation registry in Memory, or `validateCreeps` (§3.2)
- Operation-to-operation lookup, parent/child links, or lazy operation creation (§3.5)
- A second ungated structure channel for demolition (§5.3)
- Structure *replacement* logic — relocating a misplaced structure (§5.4 — explicitly deferred)
- `RoomSnapshot`, flag commands, `RemoteMining`, squad coordination
- Benchmark tuning (§8 — benchmarks measure performance, not functionality)

If the implementation seems to *need* one of these, stop and report. That is a finding
about this PRD, not a task to complete.

---

## 3. The `Operation` type

### 3.1 It is a class (decided — amends ADR 0005)

ADR 0005 stage 1 says *"factories, not classes — `src/` has no classes outside vendored
`lib/traveler.ts`."* **That is amended for operations.** A class bundles the logic of one
capability and gives it an owner; the codebase's existing factories (`colony()`,
`empire()`) stay as they are and are not churned.

```ts
export abstract class Operation {
  abstract readonly kind: string;
  constructor(readonly room: string) {}
  get name(): string { return opName(this.kind, this.room); }

  desiredCreeps(_colony: ColonySnapshot): CreepRequest[] { return []; }
  structures(_colony: ColonySnapshot): PlacedStructure[] { return []; }
  intents(_colony: ColonySnapshot): Intent[] { return []; }
}
```

Base methods return `[]` so an operation overrides only the channels it uses.

`name` is a getter over `opName(kind, room)` — the same helper stage 2's free requesters
call ([`spawn/request.ts`](../../src/spawn/request.ts)), so the `op` string a creep carries
is byte-identical before and after this stage. **No creep memory migration.**

### 3.2 Operations are stateless per-tick values (decided)

Constructed fresh every tick. The only field is `readonly room: string`. **No mutable
fields, no cached derivations, no persisted `data`.**

This is not a style preference — it preserves stage 2's identity mechanism. PRD 0005 §3.1:
ownership is *"derived fresh from the snapshot each tick instead of stored and reconciled,
so there is nothing to validate and nothing that can drift."* A field on an operation is a
second copy of state that can disagree with the snapshot.

Legacy is the cautionary tale: `Operation.data.creeps` was a persisted ledger, which forced
`validateCreeps()` ([`Operation.ts:49`](../../legacy/empire/operations/Operation.ts#L49)),
which forced `toMemory()`/`loadOperationList()` every tick
([`OperationsManager.ts:117`](../../legacy/empire/OperationsManager.ts#L117)), which forced
the `pause`/`didRun` machinery. **None of it is ported.**

Global resets wipe the heap unpredictably, so any cached field would have to survive being
empty anyway.

### 3.3 Methods take `ColonySnapshot`, never `Colony` (decided)

This keeps the dependency one-directional: `Colony` owns operations, operations read
snapshots, **operations never see the wrapper.**

If an operation took `Colony`, it could reach `colony.operations` and call its siblings —
the cycle §3.5 forbids. Taking `ColonySnapshot` makes that a compile error rather than a
convention, and reinforces that `ColonySnapshot` is a plain data object.

It is also the testability requirement discharged: a test constructs `new Mining("W1N1")`
and calls it with a `colonySnap({...})` fixture. No `Game` mock, no wrapper, no container.

**Correction to ADR 0005:** stage 3 writes `structures(snap: EmpireSnapshot)`. That is a
stale signature from the pre-stage-1 draft when planners were empire-scoped. Every
operation belongs to exactly one colony; an empire-scoped signature would force each one to
re-find its own room. Both demand methods take `ColonySnapshot`.

### 3.4 Three channels, two meanings (decided)

| Method | Meaning | Consumer |
|---|---|---|
| `desiredCreeps()` | **demand** — arbitrated | `planSpawning` sorts, budgets, emits `spawn` |
| `structures()` | **demand** — arbitrated | `planBuilding` merges, orders, emits `placeSite` |
| `intents()` | **direct action** — not arbitrated | executed as returned |

The line: demand is *plain data an arbiter decides on*; an operation never constructs a
`spawn` or `placeSite` intent itself. `intents()` is the escape hatch for work that has no
arbiter — it goes straight to `execute()`.

Legacy had both channels already: `RoomOperation.getBuildingList()`
([`RoomOperation.ts:35`](../../legacy/empire/operations/Operations/RoomOperation.ts#L35))
returning `[]` by default, overridden by `MinerOperation` to declare its per-source
container/link. That shape is confirmed and ported.

**Not ported:** legacy's `getBuildingList()` mutates a shared cost matrix while collecting
([`InitRoomOperation.ts:263`](../../legacy/empire/operations/Operations/InitialBuildUpPhase/InitRoomOperation.ts#L263)),
making collection order load-bearing. Ours returns plain data and merges in the arbiter.

### 3.5 `kind` names; it does not look up (decided)

`kind` exists to build `name`. **No operation may look up another** — no
`getOperationsOfType`, no `find(o => o.kind === ...)`, no parent/child links.

Legacy shows where lookup ends: `MinerOperation`'s constructor **throws** if it cannot find
its parent base op
([`MinerOperation.ts:16-20`](../../legacy/empire/operations/economy/MinerOperation.ts#L16-L20)),
and `getMiningOperation()` lazily *creates* the missing operation and recurses
([`InitRoomOperation.ts:252-261`](../../legacy/empire/operations/Operations/InitialBuildUpPhase/InitRoomOperation.ts#L252-L261))
— mutating the operation list while it is being iterated.

**Merging happens only in the arbiter.** Where today's code has one operation consulting
another's output — [`building.ts:79`](../../src/systems/building.ts#L79) calling
`minedStructures()` — the arbiter merges both sources first and *then* gates roads (§5.2).

Consulting the **room planner** is not operation-to-operation lookup and is explicitly
allowed (§5.1).

---

## 4. Where operations hang

### 4.1 `Colony` gains `operations`, built unconditionally (decided)

```ts
export interface Colony {
  snapshot: ColonySnapshot;
  operations: Operation[];
}
export function colony(snapshot: ColonySnapshot): Colony {
  return { snapshot, operations: operationsFor(snapshot.name) };
}

// src/operations/index.ts — the list of what exists, not a rules engine.
export function operationsFor(room: string): Operation[] {
  return [new Mining(room)];
}
```

**On `Colony`, not re-derived per caller.** `planSpawning` and `planBuilding` both need the
list; a free `operationsFor()` called by each would mean "the colony's operations" is not a
thing that exists but a thing each caller re-derives — the copy-pasted colony loop again,
one level up.

This does not contradict stage 1's *"`Colony` is `{ snapshot }` and nothing else: no
`plan()`, no methods."* That rule was aimed at **dispatch**; `operations` is
**composition**. Dispatch stays in `tick`.

**Unconditional.** Every colony gets every operation kind. Whether an operation does
anything is *its own* decision, made against the snapshot it is handed — a colony with no
sources gets a `Mining` that returns `[]` from every channel. Hoisting that condition into
`operationsFor` would split one piece of knowledge across two files and let the two drift.

**Known limit, accepted:** `opName`'s `kind:room` is unique only while there is at most one
operation of a kind per room. `RemoteMining` breaks it — the honest future form is a
constructor that takes a *target* room and an `operationsFor` that maps over remotes, which
is still not a condition on whether a kind exists. ADR 0005 already flags this; it is stage
4+'s problem.

### 4.2 Arbiters concatenate two explicit sources (decided)

```ts
const requests = [
  ...FREE_REQUESTERS.flatMap(r => r(colony)),          // transitional debt
  ...colony.operations.flatMap(op => op.desiredCreeps(colony.snapshot))
].sort((a, b) => b.priority - a.priority);
```

The two sources are genuinely different — one is the target architecture, one is debt with
a known end date — so they stay visibly separate. Adapting operations into the free-function
array (or vice versa) would buy uniformity by hiding the seam this stage exists to build.
"What is left to migrate" must be answerable by reading one array, and stage 4's diff is a
deletion.

Sorting is a **flat sort over the concatenation**. Priority is absolute across the empire
(PRD 0005 §3.5); there is no source-based tiebreak and no operation preference. A bootstrap
request at 100 outranks a miner request at 95 whether or not the miner came from an
operation.

Everything else in `planSpawning` — the take-from-the-list loop, the running energy budget,
stop-on-unaffordable (PRD 0005 §4.1–4.2) — is **unchanged**.

---

## 5. Building: the room planner is a capability, not an operation

### 5.1 The layering (decided)

| Layer | Knows | Is |
|---|---|---|
| **Room planner** (`src/layouts/`) | the full RCL8 bunker at this anchor | a pure capability, consulted |
| **Operation** | what *it* needs now, given colony state | a demander |
| **`planBuilding`** | how to realise the merged demand | the arbiter |

The room planner answers *"where may things go"* and *"what does the layout occupy."* It is
**not** an operation and gains no `Operation` subclass — a `Bunker` operation would be a
pass-through that owns nothing and computes nothing.

An operation consulting the **room planner** is allowed and is the point: it is how mining's
roads route *around* future bunker structures instead of through them. Legacy did exactly
this — `MinerOperation.getBuildingList()` asks `roomPlanner.getPath(...)` rather than
pathing blind
([`MinerOperation.ts:126`](../../legacy/empire/operations/economy/MinerOperation.ts#L126)).
Our equivalent already exists: [`mining.ts:22-35`](../../src/systems/mining.ts#L22-L35)
calls `buildCostMatrix` + `sourceRoadPath`. No cycle, because the planner is a pure function
over the snapshot, not an operation.

### 5.2 `planBuilding` merges baseline plus additions (decided)

```
1. baseline  = stampLayout(buildableAtRcl(GOAL, rcl, {anchor, sources}), anchor)   // room planner
2. additions = colony.operations.flatMap(op => op.structures(snapshot))
3. merged    = gateRoads([...baseline, ...additions])      // AFTER merge — see below
4. sort by typePriority, ties keep build-sequence order
5. spend the FOCUS_SITE_CAP site budget
6. demolish (§5.3)
```

Steps 3–6 are **ported verbatim** from today's
[`building.ts`](../../src/systems/building.ts). The only structural change is that step 2
replaces the direct `minedStructures(colony)` call, and step 3 now runs over the merged
list rather than over a list that already had mining's containers folded in.

`gateRoads` **must** run after the merge: it keeps a road only if it neighbours a served
structure ([`building.ts:128-134`](../../src/systems/building.ts#L128-L134)), and mining's
containers are served tiles. This is the concrete case §3.5 exists to handle — the arbiter
sees everything, no operation consults another.

`CONTAINERS_FROM_RCL` moves out of `building.ts` and into `Mining`: gating a source
container on RCL is mining's knowledge of what it needs *when*. `ROADS_FROM_RCL` and
`FOCUS_SITE_CAP` stay in the arbiter — they are realisation policy, not demand.

### 5.3 Demolition compares against the merged gated list (decided)

**One structure channel only.** `structures()` returns what an operation wants *now*, RCL
gating included. Demolition uses that same merged list — *tear down what neither the layout
nor any operation claims this tick*, which is ADR 0005's rule.

**A second ungated `claims()` channel was considered and rejected.** It would preserve
today's behaviour exactly (today demolition compares against the full ungated RCL8 goal,
[`building.ts:103`](../../src/systems/building.ts#L103)) at the cost of a second channel
that exists only to soften the first.

**Accepted consequence, stated plainly:** demolition becomes more aggressive than today.
At RCL2, a container Mining does not yet ask for, and any structure belonging to a higher
RCL tier, becomes a demolition candidate. Integration tests are the check. If this proves
harmful it is a **finding for a follow-up PRD**, not a reason to add the channel back.

Today's one safety rule is **ported verbatim**: spawns are never auto-demolished
([`building.ts:119`](../../src/systems/building.ts#L119)) — colony-fatal if wrong.

### 5.4 Structure replacement is explicitly deferred

The intended long-term model is richer than "demolish the unclaimed": operations state a
*target state* ("at RCL2 I want a spawn at 15,20"), and the planner realises it — including
**relocating** a misplaced structure, guarded by safety rules ("replace a spawn only if
more than one exists").

**Not in this stage.** It needs a per-type *count* of wanted-vs-existing, which today's
`sameSpot` matching does not compute, and it is where `MAX_STRUCTURES`-style limits live.
That deserves its own design pass, not a rider on a refactor. Recorded here so the seam's
purpose is not lost.

---

## 6. `Mining` — the one operation

`Mining` owns the **source-to-storage capability end to end**, not "the miner role."
`src/systems/logistics.ts` is deleted because there was never a logistics capability —
there was a hauler role that belonged to mining all along.

```ts
export class Mining extends Operation {
  readonly kind = "mining";
  desiredCreeps(colony: ColonySnapshot): CreepRequest[];  // miners (per source) + haulers
  structures(colony: ColonySnapshot): PlacedStructure[];  // per-source container/link
  intents(colony: ColonySnapshot): Intent[];              // recordSourceSpot
  private sourceSpots(colony: ColonySnapshot): Map<SnapSource, XY>;
}
```

`sourceSpots()` stays **private** and is the shared derivation all three channels read, so
the recorded spot can never disagree with the built spot — the invariant
[`mining.ts:21`](../../src/systems/mining.ts#L21) already names.

### 6.1 What moves, verbatim

| From | To |
|---|---|
| `logistics.ts` `minerRequests` (per-source deficit, `WORK_PER_SOURCE`, `openTiles` clamp, hauler cap, ADR-0001 cold-start seed) | `Mining.desiredCreeps()` |
| `logistics.ts` `haulerRequests` (`MIN_HAULER_ENERGY`, containers-with-energy quota) | `Mining.desiredCreeps()` |
| `mining.ts` `minedStructures` + `MIN_CONTAINER_RCL` + `LINK_RCL` | `Mining.structures()` |
| `building.ts` `CONTAINERS_FROM_RCL` gate | `Mining.structures()` |
| `mining.ts` `planMining` (`recordSourceSpot`) | `Mining.intents()` |

**Preserve every ADR-0001 comment.** They record decisions not re-derivable from the
formula.

The hauler cap and cold-start seed
([`logistics.ts:44-54`](../../src/systems/logistics.ts#L44-L54)) stop being cross-role
coupling and become **internal arithmetic inside one operation** — Mining sizes its miners
against its own haulers. Ported unchanged; whether they still make sense is a **later**
question.

`desiredCreeps()` returns miners and haulers **concatenated in that order**, with their
existing priorities (`miner: 95`, `hauler: 90`). The arbiter's flat sort makes emission
order irrelevant, but keeping source order stable keeps diffs readable.

### 6.2 `recordSourceSpot` is a known inefficiency, ported

It rewrites the same values every run, unconditionally, whether or not they are already
recorded. Throttled only by the tick interval. **Ported as-is** — noted so it is not
mistaken for something this stage introduced.

---

## 7. `tick` and `SYSTEMS`

The `mining` entry in [`SYSTEMS`](../../src/kernel/tick.ts#L42) becomes:

```ts
{ name: "operations", tier: 2, scope: "colony", interval: 50,
  run: (c: Colony) => c.operations.flatMap(op => op.intents(c.snapshot)) }
```

Tier 2 and interval 50 are carried over verbatim from the `mining` entry. The `stats.record`
key changes from `mining` to `operations` — one discontinuity in stats history, accepted.

**All operations share one tier and interval.** An operation does **not** declare its own
scheduling: `SYSTEMS` is scaffolding ADR 0005 says is being dismantled, and per-operation
scheduling is untestable with one operation. **This whole mechanism is expected to be
scrapped** in a later stage; do not invest in it.

---

## 8. Acceptance

**This section amends ADR 0005 §Acceptance for stage 3**, which said stage 3 keeps the >5%
benchmark rule.

- `npm test` green — unit **and** `test/integration/`
- `npm run lint` clean
- `src/systems/logistics.ts` deleted
- `planSpawning` and `planBuilding` import no sibling system for demand
- `npm run bench` **not run as a gate.** Optionally recorded once.

**The benchmark is ignored completely.** Benchmarks measure *performance*; this stage
changes *structure*. A refactor that moves demand into operations has no reason to produce
the same tick counts, and gating on it would mean tuning a refactor to chase a number that
carries no information. Integration tests passing is the bar.

"Test count not decreased" does not apply — port what still means something, drop what
asserts deleted concepts.

---

## 9. Tests

Testability is a **mandatory** requirement of this design, and §3.3 is how it is
discharged: `new Mining("W1N1").desiredCreeps(colonySnap({...}))` needs no `Game` mock, no
wrapper, no container.

### 9.1 Call sites construct the operation directly

No compatibility shims. `minedStructures` and `minerRequests`/`haulerRequests` cease to
exist as free functions; every caller constructs a `Mining`.

| File | Change |
|---|---|
| `test/unit/logistics.test.ts` | Becomes `test/unit/mining.test.ts` — same assertions against `Mining.desiredCreeps()` |
| `test/unit/building.test.ts` | Four `minedStructures(base)` calls → `new Mining(room).structures(base)` |
| `test/integration/seed.ts` | [`plannedWorkforce`](../../test/integration/seed.ts#L157) drops `minerRequests`/`haulerRequests` imports, adds the operation poll. Highest-risk edit |
| `test/unit/spawning.test.ts` | Arbiter tests keep working via `FREE_REQUESTERS`; add operation-source coverage |

Re-using the production surface in tests is deliberate: if constructing an operation is
awkward in a test, the design is wrong and this stage is when we find out.

### 9.2 Must exist

1. `new Mining(room)` with a source-less snapshot returns `[]` from all three channels (§4.1 self-gating)
2. Per-source miner deficit survives the move — covered source gets no request, bare source does
3. Hauler requests come from `Mining.desiredCreeps()`, carrying `op: "mining:W1N1"`
4. `Mining.structures()` respects `CONTAINERS_FROM_RCL` after the move from `building.ts`
5. `planSpawning` merges free requesters and operation requests into one priority order
6. `planBuilding` gates roads over the **merged** list — a mining container counts as a served tile
7. Demolition spares spawns (§5.3 ported safety rule)
8. A creep spawned from `Mining.desiredCreeps()` is recognised by the next tick's satisfaction check (the §3.2 identity round trip, now through a class)

### 9.3 Integration tests are the gate

Per §8 they are the *only* functional gate. `rcl3.test.ts` asserts the climb completes;
`emergency-recovery.test.ts` covers the cold-start path — untouched by this stage, since
recovery and bootstrap stay free requesters, and that is exactly why they were held back.

---

## 10. Sequencing

One commit; the compiler is the worklist.

1. Add `src/operations/operation.ts` (the base class) and `src/operations/index.ts`
   (`operationsFor`) — *additive, still compiles*
2. Add `Mining`, moving `minerRequests`/`haulerRequests` bodies out of `logistics.ts` and
   `minedStructures`/`planMining` out of `mining.ts`; delete both files
   — *breaks every caller; the compiler now lists them*
3. `colony()` builds `operations`
4. `planSpawning` — two-source concatenation (§4.2)
5. `planBuilding` — baseline + additions, gate roads after merge (§5.2)
6. `tick`/`SYSTEMS` — `mining` entry → `operations` (§7)
7. Tests and `seed.ts` (§9)

There is no green intermediate state between steps 2 and 6.

**Done** — all seven steps landed as written. `src/operations/` holds the base class,
`operationsFor`, and `Mining`; `systems/logistics.ts` and `systems/mining.ts` are deleted.
Unit 274 green, lint clean, `test/integration/` unchanged from its pre-stage state
(6 passed; `mining-container` and `rcl3` fail identically on the parent commit — a
pre-existing failure this stage neither caused nor fixed, see §8's note that integration is
the gate: the bar is "no new breakage", and it is met).

Two details worth carrying forward:

- `CONTAINERS_FROM_RCL` moved from `building.ts` into `Mining`, so the RCL gate now lives
  with the operation that knows what it needs *when*. `building.ts` no longer re-gates what
  an operation hands it — one owner, per §5.2.
- `wantedStructures(colony, claimed)` gained the claims parameter rather than reaching for
  operations itself, keeping it a pure function of its arguments for the benchmark and seed
  call sites that were already using it.

### Follow-up: per-tick intents and the planned/built distinction

Two problems surfaced after the stage landed, both fixed in the same change.

**`intents()` ran on the old mining system's `interval: 50`.** That interval was a property of
that system's single idempotent write, not of the channel. Per-tick capabilities — link
transfers, lab reactions — do not survive being sampled every 50th tick. `intents()` is now
tier 1 with no interval, and the cadence rule inverted: an operation with genuinely periodic
work gates *itself* off the new `ColonySnapshot.tick`, and an operation whose write would
change nothing returns nothing. Mining now compares against `ColonySnapshot.sourceMemory`
(what it previously recorded) and emits only when the write would actually change something —
the "known inefficiency, ported as-is" noted in stage 3 is now fixed rather than hidden by a
low sample rate.

**`structures()` gained a `planned` parameter, and the poll became sequential.** Mining paths
a road to its container, and it was pathing against *built* structures only — so the route ran
through ground the layout will occupy and the container position shifted the tick that
structure went up, which makes planBuilding demolish and re-place the container forever.
`planBuilding` now seeds the poll with the layout and accumulates each operation's claim into
it, so a later operation sees what earlier ones planned. Because a planned road sits at
`ROAD_COST`, A* reuses a sibling's route instead of laying a parallel one a tile over — the
convergence property, obtained without any operation knowing another exists.

Three consequences worth carrying forward:

1. **`operationsFor()`'s order is now semantically load-bearing.** The first operation paths
   freely; later ones bend toward what is already planned.
2. **"Planned" cannot mean the full RCL8 goal.** The goal is a solid 13×13 block of 132
   structures centred on the anchor, and `buildCostMatrix` marks every non-walkable type
   impassable — so pathing outward from the anchor against the complete goal *always fails*,
   the anchor being sealed in by its own plan. `plannedObstacles()` (in `layouts/goal.ts`)
   returns the buildable-at-RCL subset instead, shared by `building.ts` and Mining so the two
   can never path against different plans.
3. **A claim is a statement of what should exist, not a request to place a site.** Mining's
   dedupe deliberately ignores *built* structures: dropping a claim because the structure was
   finished would make the demolition pass tear down the container Mining just built. Only
   *planned* tiles suppress a claim.

Mining now also claims the road to its container, not just the container — the route is
computed anyway to find where the container goes, and a container haulers cannot reach is not
worth having.

---

## 11. What this PRD changed in ADR 0005

1. **Classes, not factories** (§3.1). The ADR's blanket "factories, not classes" is amended
   for operations only.
2. **`Bunker` is not an operation** (§5.1). The ADR made it a peer of `Mining`; the room
   planner already owns the full-RCL layout, and operations consult it — which is why
   legacy's `MinerOperation` asked the room planner for its road path.
3. **`Mining` is the only operation** (§6). The ADR wanted two, arguing one cannot test the
   abstraction. With `Bunker` dissolved, the second would have to be `Logistics` — but
   haulers *belong to* mining, which is why `logistics.ts` can be deleted at all. **Accepted
   consequence:** cross-operation arbitration is genuinely untested this stage.
4. **`structures()` takes `ColonySnapshot`, not `EmpireSnapshot`** (§3.3) — a stale
   signature from the pre-stage-1 draft.
5. **The >5% benchmark gate does not apply to stage 3 either** (§8). Benchmarks are
   performance, not functionality.
6. **`intents()` is a third channel** (§3.4). The ADR described only two and never said
   where `planMining`'s `recordSourceSpot` goes.
7. **Demolition's wider blast radius is named explicitly** (§5.3). The ADR endorsed the
   gated comparison via the mining-container example; the real consequence is broader.
8. **Structure replacement is named and deferred** (§5.4) — the seam's purpose, recorded so
   a future PRD does not have to rediscover it.
