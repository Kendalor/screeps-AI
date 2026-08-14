# Boosting & reactions plan

## Status: design only (2026-08-12)
Zero code written. This file is the agreed design after a research + back-and-forth session on how
other Screeps bots (Overmind, bonzAI, TooAngel, The International) handle lab reactions and creep
boosting, and how the equivalent should be shaped for this codebase. Each milestone below is meant to
be its own session — this doc exists so a fresh session (or a fresh agent) doesn't have to re-derive
the reasoning, especially the two forks that took the longest to resolve (empire vs. colony scoping,
and demand-driven vs. standing-policy stockpiling).

## Handoff orientation (read this first if picking this up cold)
- Repo: `c:\Users\Kenda\Documents\GitHub\screeps-AI`, branch `rewrite`.
- No lab/boost/reaction code exists yet anywhere in `src/` — this is greenfield for M1 onward. M0 is
  *not* fully greenfield in one narrow sense: `ColonySnapshot.mineral` already exists (type-only, see M0's
  own writeup below) as a foothold from an earlier, unrelated capability (empire-wide colonization
  scoring). Confirmed by grep before this doc was written, and again before M0 was fleshed out.
- Read order for a fresh agent: this file top to bottom (M0's section is now fully specified — read it
  before writing any mineral-mining code, it resolves several non-obvious scope questions: operation/role
  identity, the interpreter gap, the Logistics generalization), then `src/operations/operation.ts` (the
  base class every milestone's colony-level piece extends — its `intents()` docstring already names "lab
  reactions" as expected tier-1 per-tick work), `src/logistics/links.ts` (the closest existing analogue:
  a pure per-tick function reading `ColonySnapshot` state and emitting intents for a structure-to-
  structure transfer — `worthSending`'s readiness-gate pattern is the template for lab-readiness checks
  throughout this plan), `src/empire/market.ts` (already has the reaction-recipe graph: `REACTIONS`
  reverse lookup via `buildReactionInputs`/`reactionInputsFor`, and `manufacturingCost`'s recursive
  component-cost traversal — reuse this instead of re-deriving a recipe walker), `src/snapshot/types.ts`
  (no lab fields exist yet; every milestone from M1 on needs them added, same shape as `SnapLink`),
  `src/operations/mining.ts` (the pattern M0's `MineralMining` deliberately diverges from in places —
  read M0's section for exactly where and why before assuming 1:1 reuse).
- No memory entries exist yet for this effort (this doc is the first artifact). Once M0 lands, a memory
  entry should record it same as other operations (see e.g. `[[Remote mining progress]]` for the shape).

## The decisions (and why)

### 1. Empire-scoped assignment, not per-colony independent stockpiling, not global equilibrium
**A colony's mineral deposit is one fixed type** (`Mineral.mineralType`), so no single colony can ever
produce every raw input a reaction chain needs — cross-colony movement is a structural requirement, not
an optimization. Three options were considered:

- **Per-colony independent stockpiling** (each colony tries to stock every tier's compounds off its own
  storage alone) — rejected: physically impossible past T1 for any colony whose mineral type doesn't
  happen to match what a recipe needs.
- **Global shortfall + terminal equilibrium** (empire computes one shared shortfall list across all
  compounds; every colony's reaction labs pull from it; a balancing pass moves surplus toward shortfall
  after the fact) — rejected: if every colony sees the same shortfall list and reacts independently, two
  colonies can both start reacting the same scarce compound the same tick, overshoot combined, while
  another compound goes neglected. Fixing that after the fact is corrective logistics for a coordination
  problem that didn't need to exist. This codebase's whole `Operation` shape (pure, snapshot-driven,
  decide-correctly-once) argues against a detect-and-correct pattern here.
- **Empire-assigned specialization** (chosen) — the empire layer assigns *which* compound(s) each colony
  is responsible for reacting, based on capability it alone can see across colonies (mineral surplus,
  terminal presence, lab count/RCL, later: border proximity/safety). Each colony's own reaction operation
  then stays trivially colony-scoped — "react toward *my assigned* compound's target" — with zero need to
  see other colonies, consistent with every other `Operation` in this codebase. The empire layer's own
  job shrinks to two clean questions: **assignment** (who reacts what) and **distribution** (move
  finished/intermediate compounds via terminal to where they're consumed). A colony with an SK room's
  extra mineral access needs no special-casing — it just naturally shows up with more than one mineral
  type in its surplus data, same as any other colony's surplus, once M0 exists.

### 2. Standing tiered stockpile policy, not creep-demand-triggered production
**Reaction chains run thousands of ticks** (a T3 boost is 3 sequential `REACTION_TIME`-gated steps, each
needing its predecessor fully stocked first) — far too slow to trigger from "a role wants a boost, start
producing it." Two options:

- **Demand-triggered** (a role's spawn request declares a boost need; that need drives reaction
  production) — rejected: by the time a creep is requesting a boost, it's already too late to start the
  underlying reaction chain. This was the original framing early in this session and is wrong.
- **Standing policy** (chosen) — the empire (per decision 1) continuously drives every assigned colony
  toward full T1 stock first, then T2, then T3 (each tier only pursued once the previous tier's targets
  are met), entirely independent of whether any creep currently wants a boost. Boosting becomes a **pure
  consumer** of whatever standing stock already exists: check current stock only, no reachability
  reasoning, no waiting on a chain to complete. If the stock isn't there, the role spawns unboosted (or
  skips spawning, a role-level policy choice outside this plan's scope) — M1-M4's job is to make that
  case rare in practice, not to handle it reactively when it happens.

### 3. Lab logistics is one shared mover, not duplicated between reactions and boosting
"Get a mineral from storage into a specific lab" is the same mechanism whether the compound is a
reaction input/output or a final boost compound about to be applied to a creep. Originally scoped as two
separate milestones ("reaction management" and "lab logistics"); merged into one shared capability
(M6) that both reaction-running (M5) and boost-lab provisioning (M7) call into, to avoid building the
same hauler-to-lab logistics twice.

## Milestones

Each is scoped to be its own session. Ordered so each is independently testable and motivates the next;
later milestones consume earlier ones' output rather than reaching sideways.

### M0 — Mineral harvesting
Extractor placement, a new `mineralMiner` role, a new `MineralMining` operation, and mineral hauling
threaded through the existing Logistics graph — end to end, colony-scoped, same shape as existing
source-energy mining (`operations/mining.ts`). Prerequisite for everything downstream: M1's empire
assignment needs *real* per-colony mineral surplus data to assign against, not a hypothetical.

Fleshed out via a grilling session on 2026-08-14 (see git history for the doc's prior, terser version).
Legacy's `legacy/empire/{operations/economy/MineMInerals.ts, creeps/roles/MineralMiner.ts,
creeps/jobs/MineMineral.ts}` was consulted as a rough, pre-rewrite-architecture reference only — its
demand-throttle (pause mining at 50% storage/terminal free capacity) and role/job split informed the
design below but neither is carried over unchanged; see decisions below for where and why this design
diverges from it.

#### Scope, precisely
Confirmed via grep before scoping: zero references to `STRUCTURE_EXTRACTOR` anywhere in `src/`.
Extractor placement, the mineral-mining role, and mineral-aware hauling are all genuinely unbuilt — this
is not a small extension of an existing pattern. `ColonySnapshot.mineral` already exists but is
type-only (`MineralConstant`, no id/position/amount/regen) and has exactly one reader outside
`snapshot/colony.ts`: `Colony.getMinerals()` (`src/colony/index.ts:98`), whose own doc comment already
flags it as the extension point ("extend this once that capability is built"). This is unrelated to (and
must not be confused with) `ScoutInfo.mineral`, a separate type used by the empire-wide colonization
picker for *scouted* rooms' mineral types (`src/empire/pickColonyTargets.ts`,
`src/mining/summarizeNeighborhoodPotential.ts`) — M0 does not touch that.

M0 spans four layers, in dependency order:
1. **Snapshot**: widen mineral state from a bare type to full per-tick facts.
2. **Interpreter**: teach the `Step[]`/`TargetSpec` system to resolve and harvest a `Mineral`, not just a `Source`.
3. **Operation + role**: a new `MineralMining` operation and `mineralMiner` role, mirroring `Mining`/`Miner`'s shape where a mineral deposit's own nature (singular per room, cooldown-gated yield, not a continuous regen curve) actually fits — and diverging where it doesn't.
4. **Logistics**: generalize the existing graph-based transport allocator (`src/logistics/`) to move a resource other than `RESOURCE_ENERGY`, rather than building a second hauling path.

#### 1. Snapshot: `SnapMineral`
Replace `ColonySnapshot.mineral?: MineralConstant` with `ColonySnapshot.mineral?: SnapMineral`, shaped
like `SnapSource` but for the room's one mineral deposit:
```ts
interface SnapMineral {
  id: Id<Mineral>;
  x: number;
  y: number;
  mineralType: MineralConstant;
  mineralAmount: number;
  ticksToRegeneration: number; // 0 while actively mineable
  extractorId?: Id<StructureExtractor>; // embedded at snapshot-build time, unlike SnapSource's containers
  containerId?: Id<StructureContainer>; // (which are found via a near-position scan over colony.containers)
}
```
Embedding `extractorId`/`containerId` directly (rather than deriving them from a near-position scan over
`colony.structures`/`colony.containers` the way `mining.ts` does for source containers today) is a
deliberate divergence from `SnapSource`'s shape: chosen for a simpler read path in the new operation,
even though it means `snapshot/colony.ts`'s construction does the position-matching once at snapshot-build
time instead of leaving it to the operation.

`Colony.getMinerals()` becomes `this.snapshot.mineral ? [this.snapshot.mineral.mineralType] : []` — its
only call site, so this is a single low-risk edit, not a migration with fan-out risk.

#### 2. Interpreter: a new `find: "mineral"` target
`TargetSpec`'s union (`src/behaviors/types.ts`) has no mineral case today, and `harvestStep`
(`src/behaviors/interpreter.ts:510`) hard-casts its resolved target to `Source`. Add `{ find: "mineral" }`
as its own variant, mirroring `find: "source"` exactly, rather than unifying the two into a shared
`find: "harvestable"` — a new sibling variant is minimal blast radius (every existing `find: "source"`
call site, and every test exercising it, is untouched), where a unification would force a rename across
all of them for no new behavior. `harvestStep`'s cast widens to `Source | Mineral` (both accept
`creep.harvest()` in the real engine) and branches only where the two genuinely differ — a mineral has no
`ERR_NOT_ENOUGH_RESOURCES`-equivalent "instantly regenerates" behavior; `mineralAmount === 0` simply means
not mineable until `ticksToRegeneration` elapses.

Add `"assignedMineral"` to the `Near` union in `src/behaviors/targets.ts` (alongside `"assignedSource"`,
`"controller"`, `"notController"`), reading `creep.memory.mineralId` the same way `nearMatches`'s
`"assignedSource"` case reads `creep.memory.sourceId`. This is technically redundant for a single owned
room (there's only ever one mineral to be near), but it's *not* redundant once remote/keeper-room mineral
mining exists — deliberately deferred, not M0's scope, but noted in `MineralMining`'s constructor doc the
same way `Mining`'s constructor documents `siblingRemoteSourceIds` — so `assignedMineral` disambiguates
across rooms the same way `assignedSource` disambiguates across a room's multiple sources, from day one.

#### 3. `MineralMining` operation + `mineralMiner` role
**New `Operation` subclass**, new file `src/operations/mineralMining.ts`, `kind: "mineralMining"`,
registered in `operations/index.ts` alongside `Mining`. Not folded into the existing `Mining` class and
not sharing its `kind`: `Mining`'s per-source WORK-target math and route cache are keyed off
`colony.sources`, a multi-source, continuously-regenerating abstraction — a mineral deposit is exactly one
per room, with a cooldown-gated (`EXTRACT_MINERAL_COOLDOWN`) burst-then-idle yield curve, not a fit for
that machinery. A shared route-caching *helper* may still be extracted later if the duplication proves
real; M0 doesn't presuppose it.

**New `mineralMiner` role**, new file `src/behaviors/roles/mineralMiner.ts`. Not an extension of
`Miner`: `Miner`'s body-sizing constants (`SOURCE_SATURATING_WORK`, `REMOTE_UNRESERVED_WORK`) are
energy-harvest-rate-specific and don't transfer to `EXTRACT_MINERAL`'s cooldown-gated throughput; its
`steps[]` pipeline is scoped throughout via `near: "assignedSource"`, which has no meaning for a mineral
creep. `mineralMiner` gets its own `steps[]` (repair/build/transfer scoped via `near: "assignedMineral"`
instead, `harvest` via `find: "mineral"`) and its own body function.

**Body shape**: includes 1 `CARRY` once energy allows, mirroring `Miner`'s self-buffering pattern (energy
≥ `MIN_CARRY_ENERGY` gets a `CARRY` for overflow even with a container present) — kept consistent with
the energy miner's body-shaping philosophy rather than diverging to legacy's flat WORK/MOVE (which
assumed zero self-buffering, banking entirely on a hauler being prompt).

**Extractor gate**: `structures()` gates directly on `colony.controllerLevel >= 6` — `STRUCTURE_EXTRACTOR`'s
RCL6 requirement is a hard engine rule, unlike `mining.ts`'s `structuresFromEnergyCapacity` heuristic
(which exists only because a plain container has no RCL requirement of its own to check against). No new
energy-capacity threshold invented for this.

**No demand throttle in M0.** Legacy paused mining outright once storage/terminal free capacity dropped
below 50%. This design deliberately does *not* port that: per decision 2 (standing tiered stockpile,
downstream-gated demand), M0 is a pure, always-on producer once extractor+container exist — mirroring
`mineral (own deposit) depletion` as the only pause condition (`mineralAmount === 0` /
`ticksToRegeneration > 0`, read directly off `SnapMineral`), not storage fullness. M2/M3's shortfall logic
is where demand-side throttling belongs once it exists; M0 shipping alone means storage can fill up with
unconsumed raw mineral in the interim, an accepted, explicitly-chosen cost rather than an oversight.

#### 4. Logistics: mineral through the existing transport graph
Confirmed: the live transport mechanism is the graph-based allocator in `src/logistics/`
(`graph.ts`'s `providers()`/`consumers()`, `allocate.ts`'s `planLogistics`), not the `Step[]` interpreter —
`Transport`'s role (`src/behaviors/roles/transport.ts`) deliberately has an empty `steps[]` so it diverts
entirely to this allocator. `Provider`/`Consumer` (`src/logistics/graph.ts`) already carry a
`resource: ResourceConstant` field, but every concrete provider/consumer pushed today hardcodes
`RESOURCE_ENERGY`, and `allocate.ts`'s planning pass (`buildDeliverChain`, `buildPickupChain`,
`pickNearestFillingProvider`, and the chain-building around them) passes the `RESOURCE_ENERGY` literal at
every call site rather than reading a provider's own `resource` field.

M0's hauling piece **generalizes this existing pass** rather than building a second, mineral-only one:
thread the provider's/consumer's own `resource` field through `allocate.ts`'s planning functions in place
of the `RESOURCE_ENERGY` literal, then add to `graph.ts`:
- a **mineral provider**: the container near the extractor (`SnapMineral.containerId`), `resource:
  <the room's mineralType>`, same shape as an energy source-container provider;
- a **mineral consumer**: storage, while it has free capacity, `resource: <mineralType>` — no
  controller-container/tower/spawn equivalent exists for a raw mineral, so this tier list is much
  shorter than energy's.

One planning pass then handles both resources per creep (a `Transport` creep isn't mineral- or
energy-dedicated), matching "Logistics should be able to handle transportation" directly rather than
building parallel infrastructure. This is real, contained, mechanical work (thread a field that's already
declared through call sites that currently ignore it) rather than an open-ended rabbit hole — flagged
explicitly during design as the one piece of M0 that touches shared, load-bearing code (`allocate.ts`) used
by every colony's energy transport today, so its generalization must not regress the energy-only paths any
existing test already covers.

- **Validates independently**: given a room with a mineral deposit, a built extractor and a built
  container, mined mineral accumulates in storage over time — the mineral-mining role harvests into its
  container, and a `Transport` creep hauls it from there to storage via the generalized Logistics pass
  (same validation style as existing mining benchmarks, extended to assert on storage's mineral store,
  not just its energy store).

### M1 — Lab state in the snapshot
Add lab representation to `ColonySnapshot` — position, `mineralType`, `mineralAmount`, `cooldown` — same
shape as `SnapLink` in `snapshot/types.ts`. No behavior, just the read path every later milestone needs.
- **Validates independently**: snapshot lab fields match `Game.rooms[x].find(FIND_MY_STRUCTURES)` labs
  filtered to `STRUCTURE_LAB`.

### M2 — Empire assignment policy
Given each colony's mineral surplus (from M0), terminal presence, and lab count/RCL, assign each colony
0+ compounds it's responsible for stockpiling toward the tiered targets. Low-capability colonies (no
terminal, too few labs) get nothing assigned rather than being force-fit. Lives in `src/empire/`,
reading across colonies — the one milestone in this plan that isn't colony-scoped by design (see
decision 1).
- **Validates independently**: given fake colony capability profiles, assignment doesn't duplicate the
  same compound onto multiple colonies unnecessarily, and correctly excludes ineligible colonies.

### M3 — Colony-scoped stockpile shortfall
Given *this* colony's assigned compounds + targets (M2's output) and its own current storage/terminal
stock, compute the shortfall to work toward. Trivial and fully colony-scoped, same shape as every other
`Operation` — no empire-wide visibility needed inside it.
- **Validates independently**: given fake storage contents and an assignment, the shortfall list is
  correct and stops wanting a compound once its target is met.

### M4 — Terminal distribution
Move a colony's *finished* surplus (an assigned compound stocked past that colony's own need) to where
it's needed — another colony's boost demand, or as a reaction input for another colony's own assigned
higher-tier compound. Directional (producer → consumer) rather than bidirectional balancing, since
assignment (M2) already resolves "who should have made this" ahead of time — this milestone only moves
resources, it doesn't decide who owes what.
- **Validates independently**: given one colony with surplus and another with a shortfall of the same
  compound (per M2's assignment), a `terminalSend`-style intent moves stock from producer to consumer.

### M5 — Reaction running
Given a target compound + quantity (M3's shortfall, highest priority first), walk the ingredient tree
(reuse `market.ts`'s `REACTIONS` reverse-lookup / `buildReactionInputs` / recursive component traversal,
repurposed from "cheapest in credits" to "available in colony stock") and emit `runReaction` intents
across a pool of reaction labs.
- **Validates independently**: point it at a target compound with known raw-mineral stock, assert
  reactions fire in correct dependency order and eventually produce the target.

### M6 — Lab logistics (shared mover)
Generic "fill lab X with N of resource Y from storage/terminal, pull finished output back to storage."
Consumed by both M5 (reaction inputs/outputs) and M7 (boost-lab provisioning) — built once, not framed
around either.
- **Validates independently**: given a lab wanting resource Y and storage holding it, a hauler
  intent/gather is emitted and the lab ends up filled.

### M7 — Boosting flow (pure consumer)
A role's boost need checks *current stock only* (storage, terminal, or an already-loaded boost lab) — no
reachability/chain reasoning, per decision 2. If stock exists: provision a boost lab via M6, gate the
`boostCreep` intent on lab readiness (`mineralAmount >= LAB_BOOST_MINERAL`), same pattern as
`links.ts`'s `worthSending`. If stock doesn't exist: role spawns unboosted or skips (role-level choice,
outside this plan). Deliberately last — everything it needs already exists and is independently tested
by the time it's built.
- **Validates independently**: given a colony snapshot with sufficient stock and a creep positioned near
  labs, correct `runReaction`/logistics/`boostCreep` intents are emitted in sequence across ticks.

## Future extensions (explicitly not milestones — write down, don't build yet)

- **Local demand override / reservation.** A colony's own operations can raise their local target for a
  compound above the empire baseline ahead of a *known* upcoming spend (e.g. a large boosted squad about
  to be spawned) — `localTarget = max(empireBaseline, colonyReservation)`. Without this, a colony that
  looks "fine" by the empire's snapshot-in-time measure can still get caught short the instant it spawns
  a big boosted wave, since the empire only sees stock levels, not colony-local intent. Raised and
  explicitly deferred during design — same anticipatory principle as decision 2, just at the colony/
  empire boundary instead of the creep/lab boundary.
- **Market buying.** M3's shortfall list (and M4's cross-colony gaps) is exactly the input a
  market-buying policy would want too — "short on K, no local source, not worth reacting, buy it." Not
  needed for the core loop to work (M5's reaction planner simply doesn't fire if raw minerals aren't in
  stock, same as M7's stock check failing), and buying is a genuinely separate capability (empire-level
  price/timing risk) worth its own plan later.
