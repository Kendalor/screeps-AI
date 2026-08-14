# Worker unification — plan & handoff

## Status: not started (2026-07-29)
Decided in conversation, not yet built. This file is both the *why* (the architectural discussion) and
the *how* (concrete, file-anchored steps) — read start to finish before building; there's no separate
plan/handoff split this time because the discussion was short enough to keep in one place.

**The decision, in one line:** collapse `builder`/`upgrader`/`repair` into one `worker` role with one
body and one priority-ordered step list (repair-if-downgrading → build → repair → upgrade). Keep
`Building`/`Repairing`/`Upgrading` as three separate operations with their own demand math (construction
backlog, decay, storage surplus) exactly as today, but have them request a shared colony-wide `worker`
pool instead of three separate owned roles, sequentially threading how much of that pool each has already
claimed so they don't triple-count the same shortfall in one tick.

## Why (the discussion, compressed)

The trigger: colony behavior "seems uncoordinated," and recent work already trended toward unifying
builder/upgrader (shared step shapes, a live `builder → repair/upgrader` conversion in
`colony/building.ts`). Open question was whether to commit to unification as permanent architecture or
treat it as a pre-RCL4 stopgap.

Resolved by reading the actual code:
- Bodies are **not yet specialized** — `builder`/`upgrader`/`repair` are all WORK/CARRY/MOVE variations on
  the same theme (`behaviors/roles/builder.ts:8-36`, `upgrader.ts:6-28`, `repair.ts:8-16`). The RCL6+
  concern (a stationary, near-zero-MOVE link-upgrader) is **not in the codebase today** — `BodyContext`
  (`behaviors/types.ts:80-88`) only has `hasContainer`/`hasLink`, and only `miner.ts` reads them
  (`behaviors/roles/miner.ts:19,41`). Nothing today makes upgrader bodies diverge from builder bodies.
- Steps already converge: builder is gather→build; upgrader is gather→build→upgrade (builder's steps are
  a strict prefix of upgrader's, per the comment at `upgrader.ts:41-46` — "the two roles now behave
  identically at the site, the only difference being how many of each the operations spawn").
- Conversion already exists (`colony/building.ts:159-168`, `repurposeIdleBuilders`) — idle builders become
  repairers or upgraders colony-wide, once construction is genuinely finished
  (`hasOutstandingConstruction`, `colony/building.ts:146-151`).
- Priority is already one numeric space the spawn arbiter sorts globally
  (`empire/spawning.ts:30-33` — `colonies.flatMap(c => c.requests()).sort((a,b) => b.priority - a.priority)`),
  so "colony-wide coordination" is already the arbiter's job for *spawning*; what's missing is coordination
  of **which task an already-alive creep does**, which today only builder→{repair,upgrader} covers, one-way.

Conclusion: because bodies haven't diverged, conversion is cheap *today*, and pushing further to one
literal role removes the one-way/builder-only limitation of `repurposeIdleBuilders` for free. The
RCL6+ specialization question is real but not urgent — it's designed as an escape hatch (an operation can
opt a role back out of the shared pool later), not solved now.

## Ground truth verified in the code (load-bearing; don't re-derive from the plan text alone)
- **Controller-downgrade urgency does not exist anywhere in the codebase.** `ticksToDowngrade` is not on
  `ColonySnapshot` (`snapshot/types.ts:171` has `controllerLevel` but nothing about downgrade) and is never
  read (`grep -rn "ticksToDowngrade"` returns nothing under `src/`). This is **new work**, not a signal
  being wired into a new consumer — must be added to the snapshot type and to `buildColonySnapshot`
  (`snapshot/colony.ts:106`, right next to `controllerLevel: controller.level`) before the worker's
  top-priority step can read it.
- **`Operation.owned()` (`operations/operation.ts:45-47`) filters by `memory.op === this.name`.** This is
  exactly the mechanism that must ***not*** apply to workers: it exists so two operations of the *same
  kind* (home Mining vs RemoteMining) don't double-count each other's creeps, but for workers, three
  *different* operation kinds (Building/Repairing/Upgrading) all need to see the *same* pool. A worker
  cannot be `op`-owned the way miners/haulers are.
- **`Colony.requests()` (`colony/index.ts:24-25`) is a flat, order-blind `flatMap`:**
  ```ts
  public requests(): CreepRequest[] {
    return this.operations.flatMap(op => op.desiredCreeps(this.snapshot));
  }
  ```
  This is the exact seam that must become a sequential fold (mirroring how `claimsOf`,
  `colony/building.ts:50-63`, already threads `planned` structure claims through operations in a fixed
  order so siblings see each other's claims). `desiredCreeps` signatures for Building/Repairing/Upgrading
  need an extra threaded input (claimed-WORK-so-far); other operations (Mining, Scouting, etc.) are
  unaffected and keep the current one-arg signature — only the three worker-consuming operations change.
- **`fillRole`/`fillTo`** (`operations/operation.ts:78-85`, `spawn/request.ts:23-39`) are plain headcount
  fills against `this.owned(colony, role).length`. For workers this owned-count must come from a
  colony-wide, non-`op`-filtered count of `role === "worker"` creeps' **WORK parts**, not creep headcount
  (bodies vary; the demand math in Building/Repairing/Upgrading is already expressed in WORK, see
  `operations/building.ts:37-40`, `upgrading.ts:54-57`) — headcount-of-worker-creeps is the wrong unit to
  compare against wanted-WORK once bodies aren't uniform.
- **`RoleName` union already has room for `worker`** — check `memory/schema.ts` for the exact union before
  adding; `claimer` was added there as precedent (`memory/schema.ts:49` per the remote-mining handoff) with
  no role file until it was built, same shape of change here.
- **Existing role priorities to preserve as request order:** builder=65, repair=64, upgrader=60
  (`behaviors/roles/builder.ts:39`, `repair.ts:19`, `upgrader.ts:31`). These become the fixed thread order
  for Building → Repairing → Upgrading claiming against the shared pool (highest priority claims first),
  and likely also the *within-worker-steps* priority order, modulo the new downgrade-repair step outranking
  everything.

## Invariants that must not break
1. **Purity boundary.** Operations/pure modules take `ColonySnapshot` only, never `Game.*`. The
   downgrade-urgency read happens in `snapshot/colony.ts` (input) only.
2. **Spawn-deadlock lessons** (memory: [[Spawning interleave deadlock]], [[Spawn arbiter stop-not-skip]]).
   Sequential WORK-claim threading must not create a starvation order where a low-priority operation's
   shortfall is silently never requested because a higher one always claims the whole pool on paper even
   when its actual creeps are busy elsewhere — the threaded value is a **request-time claim**, not a
   guarantee those WORK parts are currently doing that operation's task. This is expected slop (per the
   earlier decision to accept it at the request layer) but must not compound into permanent starvation;
   worth a benchmark check specifically for this (see done-check on step 4).
3. **Never regress `RCL3 container collapse` fix** ([[rcl3-container-collapse]]) — builders must still
   never drain haulers mid-transit; the worker's gather step must keep pooling from
   storage/container/drop/tombstone only, never from hauler creeps, same as today's builder/upgrader
   gather steps (`builder.ts:48-59`, `upgrader.ts:49-58`).
4. **Never regress `Logistics plan implemented`** ([[logistics-plan-implemented]]) — no change to
   `logistics.ts`/`transport.ts` is in scope here at all.
5. **`repurposeIdleBuilders` and its supporting functions become dead code**, not dead-but-kept — delete
   them once the worker step list subsumes the behavior (step 6 below), rather than leaving a parallel,
   now-redundant conversion path that could drift out of sync with the worker's own step priority.

## Build order — each step is one commit, independently benchmarkable

### Step 1 — Controller-downgrade signal on the snapshot (pure, no behavior change)
**Files:** `snapshot/types.ts` (`ColonySnapshot`, next to `controllerLevel: number;` at line 171),
`snapshot/colony.ts` (next to `controllerLevel: controller.level` at line 106).
- Add `controllerTicksToDowngrade: number` (raw `controller.ticksToDowngrade`) to the snapshot type and
  builder. Do **not** invent a derived "isCritical" boolean at this layer — keep the snapshot a plain data
  mirror and let the worker's step spec do the thresholding (matches how `repairBelow`/`fillTo` thresholds
  live in `TargetSpec`, not the snapshot).
- **Done-check:** `npm run build` green, existing tests green (additive field, no reader yet) — safe to
  land first, same shape as the remote-mining handoff's step 1.

### Step 2 — `worker` role: body + steps (net-new file, not yet wired to any operation)
**New file:** `src/behaviors/roles/worker.ts`. **Touch:** `memory/schema.ts` (add `"worker"` to
`RoleName` if not already present — check first), `behaviors/roles/index.ts` (register in `ROLES`).
- Body: reuse the builder curve (`builder.ts`'s `builderBody`, WORK/CARRY/CARRY/MOVE/MOVE-based scaling)
  as the starting point — it's the one shape proven across build/repair/upgrade-adjacent work already.
  Don't invent a new curve; copy/adapt `builderBody` and rename.
- Steps, in this priority order, using the existing `TargetSpec`/`Step` vocabulary (no interpreter
  changes — "commit to a step until its target stops resolving" is already how the interpreter works):
  1. `repair` at a controller-adjacent structure gated on `controllerTicksToDowngrade` being below a
     threshold (needs a new `TargetSpec` discriminator or a dedicated `upgrade`-like priority step — see
     open question below; simplest first cut: an `upgrade` step gated by a `when`-like condition on
     downgrade urgency, since upgrading *is* the fix for downgrade, not repairing the controller structure
     itself — **reconsider this step's verb**, controller downgrade is countered by `upgradeController`,
     not `repair`, so this is really "upgrade, but jump the queue" not a repair step at all).
  2. `gather` (same pooled storage/container/drop/tombstone source as builder/upgrader today).
  3. `build` (`at: { find: "constructionSite", prefer: "mostProgress" }`, as today).
  4. `repair` (`REPAIRABLE`/`needsRepair` two-tier as today's `repair.ts:31-32`).
  5. `upgrade`.
- **Correction from the discussion:** re-examine step 1 above before implementing — "repair-if-downgrading"
  as originally phrased conflates two different actions (repairing a decayed controller-adjacent structure
  vs. upgrading to reset the downgrade timer). The actual fix for `ticksToDowngrade` running low is
  `upgradeController`, so the real priority-jump step is *upgrade*, gated on urgency, ranked above `build`
  — not a new repair variant. Confirm this reading before writing the step list.
- **Done-check:** unit tests over the role's `steps`/`body` in isolation (mirrors `test/unit/roles.test.ts`
  patterns for existing roles) — no operation wiring yet, so nothing spawns one.

### Step 3 — Colony-wide WORK-part counter for the shared pool (pure)
**File:** likely a small addition to `operations/operation.ts` or a new free function (e.g.
`operations/worker.ts` or inline in each of the three call sites) — pick based on where it reads best;
this is shared by three operations so it shouldn't live inside just one of them.
```ts
// No memory.op filter — workers are a colony-wide shared resource, not operation-owned.
export function workerWorkSupply(colony: ColonySnapshot): number {
  return colony.creeps
    .filter(c => c.role === "worker")
    .reduce((sum, c) => sum + countPart(bodyOf(c), WORK), 0); // body-from-creep helper — check what SnapCreep exposes
}
```
- Check what `SnapCreep` actually exposes for body parts before assuming `countPart` applies directly —
  may need `c.body` or a stored WORK count on the snapshot creep; verify in `snapshot/types.ts`.
- **Done-check:** unit test with fixture creeps of mixed bodies, confirms sum is order-independent and
  ignores `memory.op` entirely (add a fixture creep with a foreign `op` stamp and confirm it still counts).

### Step 4 — Thread claimed-WORK through Building → Repairing → Upgrading, request `worker`
**Files:** `operations/building.ts`, `operations/repairing.ts`, `operations/upgrading.ts`,
`colony/index.ts` (`requests()`, lines 24-25).
- Change `desiredCreeps` on these three (only these three) from `desiredCreeps(colony)` to
  `desiredCreeps(colony, claimedWork: number)` — a threaded running total of WORK already requested by
  higher-priority operations this tick, same shape as `structures(colony, planned)` already threading
  `planned` (`operations/operation.ts:93`, `colony/building.ts:57-58`).
- Each of the three: compute its own `wantedWork` (existing math — `sustainableBuildWork`/
  `wantedBuilders`, `wantedRepairers`, `wantedUpgraders`+body-WORK — unchanged), subtract `claimedWork`
  and the pool's existing supply (`workerWorkSupply(colony)`), request the remainder as `worker` bodies
  via a new `fillRole`-equivalent that requests by **WORK shortfall**, not headcount (existing `fillTo`
  is headcount-based — needs a WORK-shortfall variant, e.g. `fillWork(colony, wantedWork, suppliedWork, body, priority, memory)`
  that divides the WORK shortfall by the body's own WORK count to get a creep count, similar to
  `wantedBuilders`'s existing `Math.ceil(wantedWork / builderBodyWork(colony))` pattern at
  `operations/building.ts:54`).
- `Colony.requests()` becomes a sequential fold in fixed priority order (Building, then Repairing, then
  Upgrading — matching 65/64/60), passing the running claimed-WORK total between them; other operations
  (Mining, Scouting, Bootstrap, etc.) keep calling `desiredCreeps(colony)` with no second argument —
  only the three worker-requesting operations gain the parameter.
- `memory.op` on emitted worker requests: stamp it as today (`op: this.name`) for telemetry, but do **not**
  gate any `owned()`/counting logic on it for role `"worker"` — `workerWorkSupply` (step 3) must ignore it.
- **Done-check:** the risky one — benchmark for the starvation failure mode named in invariant #2 (a
  lower-priority operation's shortfall never getting requested because higher-priority operations'
  *claims* always eat the visible pool on paper, even while those WORK parts are actually idle-upgrading).
  Compare against committed baselines (memory: [[Milestone benchmarks]]) for regressions in
  construction-completion time and repair backlog before promoting past this step.

### Step 5 — Census/`roleTargets` keeps three virtual lines against the shared pool
**Files:** same three operation files, `roleTargets` overrides (`building.ts:66-68`, `repairing.ts:27-29`,
`upgrading.ts:108-110`).
- Keep three separate reported lines (`building: X/Y`, `repairing: X/Y`, `upgrading: X/Y`), each still
  computed from that operation's own `wantedWork` translated to an equivalent headcount, but compared
  against the shared pool's actual WORK supply rather than an op-owned subset. Do **not** collapse to one
  flattened `worker: N/M` — the whole point is keeping visibility into which of the three needs is
  starved, per the earlier design decision.
- **Done-check:** existing census/dashboard tests (if any — check `test/unit/` for census coverage) still
  distinguish the three; manually sanity-check output reads sensibly (e.g. `building: 3/2` meaning surplus
  WORK exists for building specifically, even though the physical creeps are named `worker`).

### Step 6 — Delete `repurposeIdleBuilders` and its support functions
**File:** `colony/building.ts` (`hasOutstandingConstruction` at 146-151, `hasRepairWork` at 155-157,
`repurposeIdleBuilders` at 162-168, plus wherever `repurposeIdleBuilders` is called from — grep for the
call site before deleting).
- Once the worker's own step list (step 2) already falls through repair→upgrade with no explicit
  role-memory conversion needed, this whole mechanism is subsumed. Confirm no other caller depends on
  `hasOutstandingConstruction`/`hasRepairWork` before deleting them too (`hasRepairWork` in particular —
  check if `Repairing`'s `wantedRepairers` or `Defense`'s `coveredByTower` share logic with it first;
  don't delete a function that's independently load-bearing elsewhere just because its *caller* is dead).
- **Done-check:** grep confirms zero remaining references; full test suite green; delete the now-orphaned
  tests in `test/unit/` that covered only this mechanism (don't leave tests exercising deleted code, but
  don't delete tests that happen to share a file with unrelated coverage).

### Step 7 — Retire or repurpose old `builder`/`upgrader`/`repair` role files
**Files:** `behaviors/roles/builder.ts`, `upgrader.ts`, `repair.ts`, `behaviors/roles/index.ts`.
- Per the discussion's resolution: these are an **escape hatch for future RCL6+ specialization**, not
  immediately dead. Two honest options, decide at this point in the build (not before — you'll have real
  worker-pool behavior to look at by then):
  (a) delete outright now, re-add later if/when a specific role earns its own body again (simplest, matches
      "don't design for hypothetical future requirements"), or
  (b) leave the files in place but unregistered from `ROLES`/unrequested by any operation (inert, no
      behavior change, pure dead-code risk if left too long).
- **Recommendation:** (a) — delete now. Nothing in this plan depends on them surviving, and the whole
  point of checking `BodyContext`/`hasLink` earlier was confirming no live consumer needs them yet. If
  RCL6 specialization becomes real, re-introduce a role file then with the actual link-adjacent body it
  needs, not a speculative one written today against unverified requirements.
- **Done-check:** full test suite green after deletion; grep confirms no remaining `roleDef("builder")`
  etc. call sites outside the files just deleted.

## Open questions to settle during build
- **Step 2's downgrade-priority verb** (repair vs. upgrade-jump-queue) — flagged above as likely wrong in
  the original phrasing; resolve before writing the step list, not after.
- **WORK-shortfall request helper** (step 4) — exact signature of the `fillTo`-equivalent for WORK-based
  (not headcount-based) demand; check whether `fillTo` can be generalized in place or needs a sibling
  function, given `fillTo` is also used by non-worker roles that must stay headcount-based.
- **Where `workerWorkSupply` (step 3) lives** — shared free function vs. a method on `Operation` — pick
  based on how it reads once step 4 is actually being written, not in the abstract.
- **`SnapCreep` body-part access** (step 3) — confirm the exact field before assuming `countPart` applies.

## How to measure a win (don't skip)
Step 4 is the one with real regression risk (invariant #2's starvation mode). Benchmark before and after
against the committed history in `test/benchmark/` (memory: [[Milestone benchmarks]],
[[Cold-boot history benchmark]]) — specifically watch construction-completion ticks and time-to-repair
for regressions, not just "does it build." Land steps 1-3 (additive, no behavior change) first and confirm
green; step 4 is the only step that changes what actually spawns and runs.
