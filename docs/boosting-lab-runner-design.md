# LabRunner design (v1 — supersedes boosting-plan.md's decision 8/B5 lab-allocation shape)

## Status: design only (2026-08-26)
Came out of a grilling session following up on the gh #61 code review (5 standalone bugs fixed, 7 wiring
gaps left open — see that review's findings for the "never wired" list this design closes). Supersedes
`boosting-plan.md` decision 8's `planBoostLabAllocation(colony): Map<Id<Creep>, BoostLabAssignment>` shape —
that function assigned each creep its own lab; this design has creeps self-discover instead, and the
allocator's real output is lab CLAIMS (which compound a lab should hold), not per-creep assignments.

## Why the previous shape (per-creep assignment) was replaced

Deep research into 6 other Screeps bots' boosting implementations (`docs/boosting-competitor-research.md`,
plus a follow-up deep-trace of Overmind/Hivemind/TooAngel/KasamiBot/HoPGoldy's exact wiring) found that
**every bot with a real allocator (Overmind, Hivemind) has creeps self-discover their lab** by scanning for
one whose stocked mineral matches a still-needed compound — neither bot ever writes a per-creep→lab
assignment. The per-creep grouping that exists at spawn time (a creep's full compound wishlist) is
deliberately flattened to a per-compound aggregate at allocation time in both bots. This sidesteps an
entire class of problem the previous per-creep-assignment design in this codebase created: getting a
`Map<Id<Creep>, BoostLabAssignment>` computed once per colony per tick to the exact per-creep dispatch call
(`runOne`, tier-1 `SYSTEMS`) before that creep acts the same tick, without a tier-ordering lag.

## The design

### 1. Demand aggregation (unchanged, already built)
`aggregateBoostDemand` (`src/empire/boostDemand.ts`) pools every contending creep's `computeBoostNeeds`
output into one cumulative amount per compound, colony-wide. Three creeps needing the same compound produce
one pooled demand figure, not three separate ones. This part of the existing implementation is correct and
unchanged by this redesign.

### 2. Lab claims — new persisted state
A **claim** is `{ labId: Id<StructureLab>; compound: ResourceConstant; amount: number }` — nothing else. No
creep ID. A lab holding a claim is committed to stocking exactly that compound up to that amount; any creep
in the colony needing that compound may draw from it once stocked (see step 4). Claims persist in
`ColonyMemory` across ticks (exact field TBD at implementation time, e.g. `boostClaims:
Partial<Record<Id<StructureLab>, { compound: ResourceConstant; amount: number }>>`).

### 3. Allocation pass — runs every tick (or on the colony's existing tier-3 interval), two phases

**Phase A — reconcile existing claims.** For each of the 3 reserved boost labs currently holding a claim:
compare the claim's `compound` against this tick's freshly recomputed aggregated demand (step 1) for that
same compound.
- If aggregated demand for that compound is now `0` (no creep in the colony still needs it) — release the
  claim. The lab returns to the unclaimed pool for Phase B to reconsider.
- If aggregated demand is still `> 0` — the claim stands, and its `amount` is updated to track the live
  aggregated total (so it can grow if another creep queues up wanting the same compound, or the logistics
  system fills the gap between what's currently stocked and this shifting live target).

**Phase B — FCFS allocation of whatever's left unclaimed.** Build one ordered queue of every contending
creep, colony-wide, ranked by **time until it can physically reach a lab**: a still-spawning creep ranks by
its remaining ticks until birth; an already-alive creep ranks by `ticksToLive`. Lower time wins (arrives at
a lab soonest). Walk the queue front-to-back:
- For the creep at the front, look at its full remaining (unclaimed) compound needs.
- For each such compound, if a still-unclaimed boost lab is free, create a new claim for it (compound +
  current aggregated amount for that compound, from step 1).
- Continue until either this creep's whole remaining compound set is claimed, or no unclaimed labs remain.
- Move to the next creep in the queue and repeat, using whatever unclaimed labs are still left.
- A creep that reaches the front of the queue with no free labs left simply gets nothing new claimed this
  pass; it isn't a special case — it's just what "no free labs" naturally produces at that point in the
  walk.

No combinatorial optimization is performed. The ordering by "arrives at a lab soonest" is what makes FCFS
sufficient: the earliest-arriving creep's full order is prioritized as one unit (never split against a
later creep's needs), so labs converge on finishing the creep who can actually use them first, rather than
splitting capacity evenly across several creeps and finishing none. A creep whose full compound set can't
fit in the labs still unclaimed gets whatever fits; the rest waits for the next tick's reconciliation to
free up capacity (typically once the creep at the front finishes and its compound's demand aggregate drops
to `0` in Phase A).

Claim loss on death: if a creep dies before consuming its share, nothing explicit needs to happen — Phase
A's next-tick reconciliation naturally sees that dead creep no longer contributing to the aggregated demand
figure for its compound, and releases (or shrinks) the claim accordingly. No separate cleanup pass needed.

### 4. Claims are data; the logistics system generates its own request from them
The LabRunner does not construct or post a logistics request itself — its only job is to write and persist
the claim set (step 2/3) to `ColonyMemory`. The colony's existing logistics system reads that persisted claim
data on its own terms and generates whatever request shape it already uses for other structure fills (the
same "generic hauler role fulfills a posted request" pattern this codebase already uses for
extension/tower/spawn fills) — the LabRunner never reaches into logistics code to build a request by hand.
This keeps the ownership boundary clean: LabRunner owns "what should each boost lab contain," logistics
owns "how that need actually gets serviced." Exact logistics-side read/registration mechanism (e.g. a new
`registerBoostLabWantRequest`-style function, mirroring `stewardRegister.ts`'s existing per-structure
want-request registration pattern) is an implementation detail for whoever wires this side, not designed
further here.

### 5. Creep-side self-discovery (no assignment map, matches Overmind/Hivemind exactly)
`boostPreemption` (the `runOne` pre-emption check, `src/behaviors/interpreter.ts`) no longer receives a
`Map<Id<Creep>, BoostLabAssignment>` parameter at all. Instead, for a creep with a pending boost order, it
scans the colony's 3 reserved boost lab objects directly (live `Game` read, same as any other step-table
target resolution in this codebase) for one whose current stock matches a compound the creep still needs, in
sufficient amount. If found: walk to range 1, `boostCreep()`. If none found: park/wait, retry next tick — no
persisted "I'm waiting" state needed, since the check is cheap and re-evaluated fresh every tick like every
other pre-emption check in `runOne`.

This eliminates the tier-ordering problem entirely (`planBoostLabAllocation`'s output no longer needs to
reach `runCreepBehaviors`/`runOne` before creep dispatch runs) — the LabRunner (tier 3, colony-scoped) and
`runOne`'s boost check (tier 1, per-creep) become fully decoupled; whichever ran more recently just reflects
in live lab state either way.

## Who calls what (new colony subsystem: LabRunner)

A new colony-scoped subsystem, `LabRunner`, owns:
- **Persistent lab identity** — which structure IDs are the 3 reserved boost labs. Decided: **the first 3
  labs built** (RCL6, when labs first become available) are permanently persisted as the boost labs, once,
  the same tick they're first observed built — never re-decided afterward, matching `boosting-plan.md`
  decision 8's "static, not dynamic" call.
- **The allocation pass** (phases A+B above), reading live lab `Game` state + colony-wide boost demand.
- **Persisting the claim set to `ColonyMemory`** (step 4) — writes only, no logistics-request construction.

Registered as a new tier-3, colony-scoped `SYSTEMS` entry in `kernel/tick.ts`, decided cadence **every 5
ticks** (`interval: 5`, same shape as the existing `"building"` entry's `interval: 100` but far more
frequent, since a satisfied compound's lab should free up for the next contender promptly) — `{ name:
"labs", tier: 3, scope: "colony", interval: 5, run: c => c.labs() }`, calling a new `Colony.labs()` method,
mirroring `Colony.building()`'s existing shape (thin wrapper: reads live state, calls a pure planner, writes
the claim memory). No tier-ordering coupling to `runCreepBehaviors` is needed (per section 5), so this runs
on its own cadence fully independent of tier-1 creep dispatch.

## What changes in already-built code

- `src/empire/boostLabAllocation.ts`'s `planBoostLabAllocation` — replaced by the two-phase claim
  reconciliation + FCFS allocation described above. Return type changes from
  `Map<Id<Creep>, BoostLabAssignment>` to something like `{ compound: ResourceConstant; amount: number }[]`
  (or a `Map<Id<StructureLab>, {compound, amount}>`) — the claim set, not a per-creep map.
- `src/empire/boostReadiness.ts`'s `readinessScore`/`resolveScarcity` — no longer used by the allocation
  pass (scarcity is now resolved by queue order, not by scoring). May still be useful in isolation for
  something else, or may be dead code to remove — TBD at implementation time.
- `src/behaviors/interpreter.ts`'s `boostPreemption` — drops its `assignment: BoostLabAssignment | undefined`
  parameter entirely; gains direct lab-scanning logic instead.
- `src/empire/creeps.ts`'s `dispatchCreep`/`runOne`/`runCreepBehaviors` — drop the `boostAssignment`
  threading added for the old design (the `BoostLabAssignment` parameter chain added when fixing the
  flee/retreat-bypass bug in the gh #61 code review).
- New: `Colony.labs()` method, new `SYSTEMS` entry, new `ColonyMemory.boostClaims` (or similar) field, new
  persisted "which 3 labs are boost labs" field.

## Decided (previously open items)
- **Which 3 labs are boost labs:** the first 3 labs built at RCL6, persisted once and never re-decided.
- **LabRunner cadence:** tier-3, `interval: 5` (every 5 ticks).

## Open items not yet decided (flag for a future session, not blocking this design)
- Exact `ColonyMemory` field shape/name for claims and lab identity.
- Exact logistics-side mechanism that reads persisted claims and turns them into a real want-request
  (mirroring `stewardRegister.ts`'s existing per-structure registration pattern, per step 4).
