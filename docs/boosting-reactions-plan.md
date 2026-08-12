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
- No lab/boost/reaction code exists yet anywhere in `src/` — this is greenfield. Confirmed by grep
  before this doc was written.
- Read order for a fresh agent: this file top to bottom, then `src/operations/operation.ts` (the base
  class every milestone's colony-level piece extends — its `intents()` docstring already names "lab
  reactions" as expected tier-1 per-tick work), `src/logistics/links.ts` (the closest existing analogue:
  a pure per-tick function reading `ColonySnapshot` state and emitting intents for a structure-to-
  structure transfer — `worthSending`'s readiness-gate pattern is the template for lab-readiness checks
  throughout this plan), `src/empire/market.ts` (already has the reaction-recipe graph: `REACTIONS`
  reverse lookup via `buildReactionInputs`/`reactionInputsFor`, and `manufacturingCost`'s recursive
  component-cost traversal — reuse this instead of re-deriving a recipe walker), `src/snapshot/types.ts`
  (no lab fields exist yet; every milestone from M1 on needs them added, same shape as `SnapLink`),
  `src/operations/mining.ts` (the pattern M0 should follow for a new harvestable resource type).
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
Extractor placement + a mining role (or extension of the existing miner role) for `Mineral` deposits,
plus hauling mined minerals to storage. Colony-scoped, same shape as existing source-energy mining
(`operations/mining.ts`). Prerequisite for everything downstream: M1's empire assignment needs *real*
per-colony mineral surplus data to assign against, not a hypothetical.
- **Validates independently**: given a room with a mineral deposit and a built extractor, mined mineral
  accumulates in storage over time (same style as existing mining benchmarks).

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
