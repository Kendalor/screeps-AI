# PRD: Spawn requests — demand as a request, not a count

Implements **stage 2** of [ADR 0005](../adr/0005-empire-colony-operations-staged.md).
Read that first — it carries the reasoning; this document carries the decisions and
the acceptance gate.

Stage 1 (hoist the colony loop into `Colony`/`Empire`) is **done** — `src/colony/`,
`src/empire/`, and the four colony-scoped planners already take a `Colony`.

**Type:** infrastructure refactor. Every existing quota *formula* is ported verbatim.
The shape of demand changes; the arithmetic inside it does not. Where this document
and an existing formula disagree, the formula wins and the disagreement is a finding
to report, not to fix.

**Deliberate scope rule:** this stage builds the skeleton. Behaviour is defined in
operations, which are migrated one at a time in stage 3. Do not tune, min-max, or
"improve" any quota here.

---

## 1. Goal

Replace count-based demand (`desiredCensus` → `firstDeficit`) with **requests**: each
requester computes its own body, its own priority, its own creep memory, and its own
deficit. `planSpawning` stops knowing anything about roles and becomes a pure arbiter:
gather, sort, pair with idle spawns, spend energy, emit.

**Done means:** `npm test` green (unit + `test/integration/`), `npm run lint` clean,
`planSpawning` contains no role name and no census comparison.

## 2. Non-goals

Do not build, and reject any suggestion to build:

- An `Operation` interface, `operationsFor`, or `src/operations/` — that is stage 3
- A persisted spawn queue in Memory (ADR 0005 is explicit: **do not reintroduce**)
- Any change to role bodies, step lists, or quota formulas
- `RoomSnapshot`, flag commands, `canAfford`, per-role files, `RemoteMining`
- Moving request functions into new files (§7 — they stay where their count function
  lives today)
- Benchmark tuning (§9 — a worse benchmark mid-refactor is expected and carries no
  information)

If the implementation seems to *need* one of these, stop and report. That is a finding
about the ADR, not a task to complete.

---

## 3. The model

Five decisions, each following from the one before.

### 3.1 A request is emitted only when it is not already satisfied (decided)

There is **no framework-level deficit check**. A requester looks at the colony's live
creeps, works out what is missing, and emits one request per missing creep. Every
request in the list is by construction a creep that does not yet exist.

This is legacy's shape exactly ([`SpawnManager.run()`](../../legacy/empire/SpawnManager.ts#L64)
never compares desired to actual; every `enqueueCreeps()` is
`validateCreeps(); if (have < want) enque(...)`). It is also the only model that can
express the per-assignment case: [`MinerOperation`](../../legacy/empire/operations/economy/MinerOperation.ts#L47)
enqueues one entry **per source**, each with its own `sourceId`. Two requests from the
same op with the same role and different `sourceId` are indistinguishable to any
count-based matcher.

Call this the requester's **satisfaction check**. It is not legacy's `validateCreeps` —
ours validates nothing and reconciles nothing, because there is no ledger to prune. It
reads the snapshot and returns an answer.

**Consequence accepted:** a requester whose satisfaction check is inverted spawns
forever. There are five requesters; each gets a test (§8).

### 3.2 The snapshot carries creeps, not a census (decided)

`ColonySnapshot.census: Census` is **removed**. `ColonySnapshot.creeps: SnapCreep[]`
replaces it. Every count is derived at the point of use by a filter.

This is forced by §3.1: the ADR's own example of a deficit — *"does this source have 6
WORK covering it"* — is a predicate over creep **bodies**, which no
`Record<RoleName, number>` can answer. Different operations want different projections
of the same creeps (WORK per source, CARRY per remote, TTL for pre-spawn); an
aggregate can only serve the projection that was guessed at when it was written.

```ts
export interface SnapCreep {
  // From the live Creep — the only source for these.
  id: Id<Creep>;
  name: string;
  body: BodyPartConstant[];      // live parts only; see §3.2.1
  ticksToLive?: number;          // undefined while spawning
  spawning: boolean;

  // Shortcuts to common memory fields. Memory is ground truth; these are conveniences
  // hoisted because they are read constantly. They are never independently authoritative
  // — if one ever disagrees with memory, the snapshot builder is wrong.
  role: RoleName;                // === memory.role
  home: string;                  // === memory.home

  // The whole memory object, live reference, readonly (§3.2.2).
  memory: Readonly<CreepMemory>;
}
```

**`memory` is the whole object, not cherry-picked fields.** `op`, `sourceId`, and every
future per-role field (`targetRoom`, `depositId`, `squadSlot`) are readable with no
snapshot change. This is the versatility that makes stage 3's operations cheap.

**Excluded on purpose:** position and `store`. Both are cheap to read, but they are what
a *behaviour* wants, and behaviours do not read the snapshot —
[`runCreepBehaviors`](../../src/systems/creeps.ts) iterates `Game.creeps` directly.
Adding them invites planners to duplicate behaviour logic. Add them when a planner
actually asks.

#### 3.2.1 `body` is live parts only

Screeps' `creep.body` is `{type, hits}[]`. A part at `hits === 0` is dead and harvests
nothing. `SnapCreep.body` must be filtered to `hits > 0` and mapped to
`BodyPartConstant[]`, so `countPart(c.body, WORK)` answers the question the caller
means.

Raw array, **not** a pre-counted `work: number`. `countPart` already exists in
[`behaviors/body.ts`](../../src/behaviors/body.ts), and a pre-counted field guesses that
WORK is the only part anyone counts — a hauler quota wants CARRY.

#### 3.2.2 `memory` is a live reference typed `Readonly` (decided)

Not a deep copy. A copy would be a `JSON.parse(JSON.stringify())` per creep per tick —
the exact cost the no-queue decision rejects — and it would be stale by design, since
`task?: TaskState` is written by behaviours every tick.

The snapshot's contract is *"plain data only — no live game objects — so planners can
never touch `Game.*`."* `Memory.creeps[name]` is not a `Game` object, but it is live and
mutable, and a planner writing to it would bypass the `Intent` → `execute.ts` boundary
that ADR 0003 names as the single answer to "what wrote this Memory field."
`Readonly<CreepMemory>` costs nothing at runtime and makes that a compile error.

#### 3.2.3 Creeps are grouped by `memory.home`, never by room

`buildColonySnapshot` currently uses `room.find(FIND_MY_CREEPS)` for
`woundedFriendlies`, but the census comes from `Game.creeps` keyed by `memory.home`.
**These are different sets** — a creep standing in a room it does not call home belongs
to its home colony's `creeps`, not to the room it is visiting.

`SnapCreep` follows the census rule. Getting this wrong makes miner counts flicker
whenever a creep steps across a room border.

`censusByColony` keeps its name and file but its job shrinks to *group creeps by home*.
`Census` and `CensusCreep` types are deleted.

### 3.3 A request defines the creep's memory (decided)

```ts
export interface CreepRequest {
  body: BodyPartConstant[];   // the requester computed it
  priority: number;           // absolute across the empire; higher wins
  memory: CreepMemory;        // complete — role, home, op, and anything role-specific
}
```

**No top-level `role`.** Memory is ground truth for `role` and `home`, so the request
carries them once, inside `memory`. A separate `request.role` would be a second carrier
that must agree with `memory.role` with nothing enforcing it. `planSpawning` reads
`request.memory.role` when it needs the role.

**No `count`.** §3.1 means a request is always exactly one creep. A requester short
three haulers emits three requests.

**The requester fills `home` too.** Every stage-2 requester is handed a `Colony` and
writes `home: colony.snapshot.name`. Slightly repetitive across five functions, but it
keeps the rule absolute — and when `RemoteMining` later sponsors a creep, `home` must be
*its sponsor*, not "whichever colony the arbiter was looping over."

For the same reason, **`Intent.spawn` drops its `role` field.** `memory.role` is ground
truth there too. This is the one part of the stage that can land as a separate commit
(§10).

#### 3.3.1 The memory round trip is the identity mechanism

`CreepRequest.memory` and `SnapCreep.memory` are the same object round-tripped:

```
requester writes {role, home, op, sourceId}
  → planSpawning passes it through untouched
  → execute.ts puts it on the creep
  → next tick the snapshot exposes it as SnapCreep.memory
  → the requester's satisfaction check reads it back
```

That round trip *is* how an operation gets identity over its creeps — the load-bearing
question ADR 0005 exists to answer. Nothing else binds a creep to its requester.

### 3.4 `op` is a name, not an object (decided)

`CreepMemory` gains `op?: string`. In stage 2 the value is a **string literal written by
the request function** (`"mining:W1N1"`) — a name with no object behind it yet. In stage
3 it becomes `op.name` on a real operation, and the census keying, the memory field and
the satisfaction checks do not change.

Both stages must call one helper so the two can never drift:

```ts
export function opName(kind: string, room: string): string {   // `${kind}:${room}`
```

**Known limit, accepted:** `kind:room` is unique only while there is at most one
operation of a type per room. `RemoteMining` breaks it (two mining-family instances on
one colony). That is stage 3+'s problem and is exactly why ADR 0003 wanted a target-room
constructor argument.

`CreepMemory` also gains `sourceId?: Id<Source>` — **singular**. Legacy uses an array
because an RCL7+ miner covers both sources
([`MinerOperation.ts:75`](../../legacy/empire/operations/economy/MinerOperation.ts#L75));
we have no two-source miner. Narrower is the honest port; a future `Mining` widens it.

### 3.5 Priority is absolute, per request (decided)

Legacy's scale, for reference: miner 95, hauler 85, invader 72, builder 50, deposit
30/29 — economy 85–95, military ~72, growth ~50, opportunistic ~30. Adjacent integers
order requests *within* one requester (attacker before healer); there is no
`PRIORITY[role] + offset` scheme.

**Stage 2 ports today's order onto that scale, not legacy's values.** Legacy has no
`bootstrap` role and says nothing about `upgrader`, so its absolute numbers encode a
different role set. Today's order is
[`PRIORITY`](../../src/systems/spawning.ts#L15) = `bootstrap, miner, hauler, upgrader,
builder`:

```ts
export const RECOVERY_PRIORITY = 1000;  // reserved — nothing may exceed it
const DEFAULT_PRIORITY = {
  bootstrap: 100,
  miner:      95,
  hauler:     90,
  upgrader:   60,
  builder:    50
};
```

Gaps are deliberate, so a future requester can slot between without renumbering. The
*relative* order is byte-identical to today's array, so exactly one variable moves in
this stage.

---

## 4. `planSpawning` — the arbiter

After this stage it contains **no role name and no census comparison**. `firstDeficit`,
`desiredCensus`, `recoveryRole`, `bodyContext`'s spawning-side use, and the `recovering`
ternary are all deleted.

```
1. requests = concat of the five request functions (§7), each given the Colony
2. sort by priority descending
3. spawns  = colony.spawns.filter(s => !s.busy)
4. budget  = colony.energyAvailable
5. for each idle spawn:
       take the next unconsumed request
       if bodyCost(request.body) > budget: STOP (§4.2)
       emit spawn intent; budget -= bodyCost(request.body); mark request consumed
```

### 4.1 One intent per idle spawn; each consumes a distinct request

An operation may legitimately produce several spawn intents in a tick — three missing
haulers and two idle spawns fills two now and one next tick. Legacy does exactly this
(`for (const spawn of this.availableSpawns)`, each iteration popping a different entry,
[`SpawnManager.ts:67`](../../legacy/empire/SpawnManager.ts#L67)).

**The invariant is that a request is consumed at most once per tick.** This must be an
explicit take-from-the-list loop, *not* "for each spawn, find the best request" — the
latter hands the same top-priority request to every idle spawn. This is a real trap and
gets its own test (§8).

This invariant is also what closes the double-order window without a queue. Legacy's
persisted `data.creeps` ledger covered a creep from the moment it was *requested*; our
`spawning: true` flag only covers it from the moment it is *in the spawn*. Ours is
closed differently: a request not spawned this tick simply reappears next tick from the
current snapshot, and one that was spawned appears as `spawning: true`. It holds **only
because no request is consumed twice in one tick.**

### 4.2 Energy: running budget, stop on unaffordable

`energyAvailable` is a shared **room** pool, not per-spawn. Two spawns each emitting an
affordable 300-energy body in a 300-energy room produces one success and one silent
`ERR_NOT_ENOUGH_ENERGY`. So the budget is deducted as requests are consumed.

When the next request does not fit, **stop** — do not skip it to fill a cheaper one
lower down. Filling with affordable creeps first means the colony's energy is
permanently consumed by cheap creeps and the expensive high-priority request never
becomes affordable. That is a livelock, not merely priority inversion.

`execute.ts`'s existing dry-run stays a backstop, not a load-bearing arbiter.

### 4.3 Recovery is a request, not a branch

`recoveryRole` is deleted as a special case and becomes `recoveryRequests(colony)`:
returns one request at `RECOVERY_PRIORITY` when no creep is alive, `[]` otherwise. The
role choice is unchanged from
[`spawning.ts:51-60`](../../src/systems/spawning.ts#L51) — `supply` if
`storageEnergy > 0`, else `bootstrap` if the colony has sources, else nothing.

The body is sized against **`colony.energyAvailable`, not `energyCapacity`** — a dead
colony has no creep to fill extensions, so a capacity-sized body would fail the
affordability guard forever. Under §3.3 the requester computes its own body, so it reads
`colony.snapshot.energyAvailable` directly. **No `sizeAgainstAvailable` flag on
`CreepRequest`** — a flag would push body sizing back into the arbiter, which is the
double derivation this stage deletes.

Because recovery's body is sized against available energy, it is affordable by
construction and can never trigger §4.2's stop.

---

## 5. Miner requests are per source

`desiredMinerCount` returns one number for the colony. Ported into a request that means:
loop the sources, and for each source **not covered by a live miner carrying that
`sourceId`**, emit one request with `memory: { role: "miner", home, op: opName("mining",
room), sourceId }`.

The *formula* is verbatim — same `WORK_PER_SOURCE = 6`, same `Math.ceil(WORK_PER_SOURCE
/ workPerBody)`, same `openTiles` clamp, same hauler cap, same ADR-0001 cold-start seed.
Only the deficit is computed per source instead of as one colony total.

**Keep the hauler cap** (`Math.min(wanted, haulers)`,
[`logistics.ts:36`](../../src/systems/logistics.ts#L36)) and the cold-start hack
([`logistics.ts:28-31`](../../src/systems/logistics.ts#L28)) verbatim, applied as a
filter on which sources get a request. Whether they still make sense under per-source
demand is a **stage 3 question for `Mining`**, not a stage 2 change. One variable at a
time.

**Preserve the ADR-0001 comments** when moving this code. They record decisions that are
not re-derivable from the formula.

Per-source is behaviour-neutral in the normal case: with the same formula, "2 sources
each wanting 1 miner" and "colony wants 2 miners" produce the same spawn sequence. They
diverge only where the colony total is already wrong — one source with two miners and
one with none, which the count model cannot see.

`minerRequests` is a **transitional free function**. Its body relocates wholesale into
`Mining.desiredCreeps()` in stage 3. Do not polish it.

---

## 6. Deploy-time over-spawn (accepted, not fixed)

Existing creeps deploy with no `op` and no `sourceId`. Per ADR 0005, absent `op` means
unowned and attrition clears them within a creep lifetime (~1500 ticks). There is **no
migration step** in `memory/migrate.ts`.

The consequence the ADR does not state: for those ~1500 ticks, `minerRequests` sees
existing miners with no `sourceId`, considers every source uncovered, and **over-spawns
once**. Benchmarks and integration tests start from a fresh world so they will not show
it; a live deployment will. Accepted.

---

## 7. File layout — requesters stay where they are

Each request function replaces its count function **in the file where that count
function lives today**. `spawning.ts` imports all five, exactly as it does now
([`spawning.ts:10-12`](../../src/systems/spawning.ts#L10)) — only the return types
change.

| File | Was | Becomes |
|---|---|---|
| `systems/logistics.ts` | `desiredMinerCount`, `desiredHaulerCount` | `minerRequests`, `haulerRequests` |
| `systems/spawning.ts` | `desiredBootstrapCount`, `recoveryRole` | `bootstrapRequests`, `recoveryRequests` |
| `systems/upgrading.ts` | `desiredUpgraderCount` | `upgraderRequests` |
| `systems/building.ts` | `desiredBuilderCount` | `builderRequests` |

Rejected: a new `src/spawn/requests.ts` collecting all five. It would *centralise*
demand — the precise thing ADR 0003 diagnosed as wrong — and stage 3 immediately
re-scatters it into operations. Rejected too: creating `src/operations/` now, which
pre-commits to stage 3's layout before the `Operation` interface exists.

**Accepted consequence:** after this stage `spawning.ts` still imports from four sibling
systems. That is unchanged debt, not new debt. Stage 3 deletes it by inverting to a poll
over operations.

---

## 8. Tests

Port every test that still means something; drop the ones that only assert deleted
concepts. **Do not** invent replacements to keep the count up — ADR 0005's
"test count not decreased" does not apply to this stage (§9). The suite will be
rewritten again in stage 3 when operations land, so leave it functional, not polished.

| File | Disposition |
|---|---|
| `test/unit/census.test.ts` | Shrinks honestly — `censusByColony` is now group-by-home |
| `test/unit/logistics.test.ts` | Formulas ported verbatim, so assertions survive as request-shape assertions. Keep |
| `test/unit/spawning.test.ts` (415 lines) | Largest rewrite. Arbiter is now small and sharp, so it should be *easier* to test |
| `test/fixtures.ts` | `colonySnap` produces `creeps: SnapCreep[]` instead of `census` |
| `test/integration/seed.ts`, `harness.ts` | Must produce creeps with memory, not counts. Highest-risk edit in the stage |

### 8.1 Must exist

1. A request is consumed **at most once per tick** (two idle spawns, one request → one intent)
2. N idle spawns consume N **distinct** requests, in priority order
3. Running budget: two affordable-alone requests, only one affordable together → one intent
4. Stop-on-unaffordable: expensive high-priority request blocks a cheap low-priority one
5. Recovery outranks everything, and its body is sized against `energyAvailable`
6. Per-source miner deficit: source with a live `sourceId`-carrying miner gets no request; bare source does
7. Memory round trip: request memory → `SnapCreep.memory` → satisfaction check
8. Each of the five requesters returns `[]` when satisfied (the infinite-spawn guard from §3.1)

### 8.2 Integration tests are a gate

`test/integration/` is **not** the benchmark suite. `rcl3.test.ts` asserts *"the climb
completes"* with generous ceilings and its own comment says *"Asserts the climb
completes, not which role completes it."* These are correctness tests and they must stay
green — they are what catches an inverted satisfaction check that spawns nothing.

`emergency-recovery.test.ts` deserves specific attention: recovery becoming a request
(§4.3) is the most behaviour-sensitive change in the stage, and that test is the proof.

---

## 9. Acceptance

**This section amends ADR 0005 §Acceptance for stage 2** (see §11).

- `npm test` green — unit **and** `test/integration/`
- `npm run lint` clean
- `planSpawning` contains no role name and no census comparison
- `npm run bench` **recorded once** at the end of the stage and committed to
  `test/benchmark/benchmarks.json`. **Not a gate.**

The ADR's ">5% on any milestone is a failure" does **not** apply. Benchmarks measure
performance and optimisation; this stage is infrastructure. Mid-refactor a worse number
is expected behaviour and does not mean anything — it is a baseline for stage 3, not a
verdict on stage 2. Do not re-baseline, do not tune to chase it, do not block on it.

"Test count not decreased" does not apply either (§8).

---

## 10. Sequencing

One commit for the main change; the compiler is the worklist.

**Optional warm-up commit first:** drop `role` from `Intent.spawn` (§3.3). Independent
of everything else, touches two files plus `execute.test.ts`.

**Main commit**, in this order — additive first so it compiles, then the break that
makes the compiler enumerate every call site:

1. Add `CreepRequest`, `opName`, `RECOVERY_PRIORITY`, `DEFAULT_PRIORITY`; extend
   `CreepMemory` with `op?` / `sourceId?` *(additive — still compiles)*
2. Add `SnapCreep`; add `ColonySnapshot.creeps`; remove `ColonySnapshot.census` and the
   `Census` type *(breaks every reader — the compiler now lists them)*
3. `censusByColony` → group-by-home; snapshot builder emits `SnapCreep`s keyed by
   `memory.home` (§3.2.3)
4. Five count functions → five request functions (§7)
5. Rewrite `planSpawning` as the arbiter (§4)
6. `test/fixtures.ts`, `seed.ts`, `harness.ts`
7. Port/drop tests (§8)

There is no green intermediate state between steps 2 and 5 — `colony.census` has 68
references across 14 files. Do not attempt to split it.

---

## 11. What this PRD changed in ADR 0005

**Already applied** — ADR 0005's stage-2 section, Consequences and Acceptance carry
these corrections inline. Recorded here so the reasoning is not lost:

1. **Stage 2 never said who emits requests.** There is no `Operation` type until stage
   3, so the ADR described a `CreepRequest` with no producer. Resolved by §7 (free
   functions, in place) and §3.4 (`op` as a string literal for one stage).
2. **"Census keyed by operation" could not express its own example.** *"Does this source
   have 6 WORK covering it"* is a predicate over bodies; no `Record<RoleName, number>`
   answers it. The snapshot carries creeps instead (§3.2) and `Census` ceases to exist as
   a concept, not merely as a snapshot field.
3. **"`recoveryRole` overrides a request's body" was wrong.** There is no census
   comparison to bypass, and in total collapse there may be no request to override —
   every normal quota evaluates to zero, which is the entire reason recovery exists.
   Replaced by §4.3.
4. **The >5% benchmark gate does not apply to stage 2** (§9). Stage 3 keeps it.
5. **`spawning: true` is not a drop-in replacement for legacy's ledger.** The ledger
   covered a creep from *request*; the flag covers it from *spawn*. The window closes
   because there is no queue **and** because no request is consumed twice per tick
   (§4.1) — an invariant the ADR never stated.

Two things the ADR got right that survived scrutiny and should not be relitigated: **no
persisted spawn queue**, and **`sourceId` alongside `op`** (ownership and the specific
job are different keys, exactly as legacy had them).
