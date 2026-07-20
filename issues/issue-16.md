# P2: systems/building.ts — RCL-gated construction site placement

- **Issue:** [#16](https://github.com/Kendalor/screeps-AI/issues/16)
- **State:** OPEN
- **Author:** Patrick Rehn (Kendalor)
- **Created:** 2026-07-20T11:10:44Z

## What to build

The planner that turns the bunker goal layout (issue #14) into actual `placeSite` intents, deriving what's buildable at the colony's current RCL each tick. This is the piece that was missing from the old P2-only issue set: without it, no construction sites ever appear, so builder creeps have nothing to build and the colony can't scale past its bootstrap body caps.

**`systems/building.ts`** — `planBuilding(snap: EmpireSnapshot): Intent[]`:
- For each colony, resolve (or compute-and-cache in `ColonyMemory.anchor`, per the schema in the rewrite doc) the bunker anchor via `layouts/stamp.ts` (`findAnchorCandidates` + `pickAnchor`, which now weights the controller 2x over sources).
- Derive the buildable subset via `buildableAtRcl(goal, controllerLevel)` (`layouts/goal.ts`) and stamp it onto the anchor with `stampLayout`. The goal is the single RCL8 end-state (`src/layouts/Base_2.json`); `buildableAtRcl` already honours `CONTROLLER_STRUCTURES` per-RCL caps and prefers the lowest-`order` (cluster-nearest) instances.
- Diff the stamped buildable set against structures/sites already present in the room snapshot.
- Emit `placeSite` intents for the missing structures, respecting the per-room construction-site cap (`MAX_CONSTRUCTION_SITES`, currently 100).
- Re-runs are idempotent: a structure/site that already exists is never re-requested.

**`snapshot/types.ts`** — add whatever fields `planBuilding` needs to see existing structures/sites (extends the `constructionProgress` field also needed by the builder quota formula, issue #18).

### Road gating ("roads only where needed")

`buildableAtRcl` intentionally returns the **full** bunker road network from RCL2 onward, because `CONTROLLER_STRUCTURES.road` is 2500 at every level — "permitted" is not "wanted". Building the whole RCL8 road grid at RCL2 wastes energy and decay upkeep on tiles that have no structures yet. `building.ts` owns the gating policy: **place a bunker road only if it neighbours a structure that already exists or is being placed this RCL** (i.e. grow the road network alongside the structures it serves). This filter lives here, not in the pure derivation (noted in-code in `layouts/goal.ts`).

### Stale-structure migration + spawn safety

Bunker tiers under the new single-goal model share one fixed anchor, so structures no longer relocate between RCLs the way the retired per-tier layouts did. But a room can still contain a structure at a position the goal layout does **not** call for (manual builds, remnants of an old plan, a mis-imported layout). The diff must handle three cases, not two:
- **missing** → emit `placeSite` (covered above)
- **present and correct** → no-op (idempotency)
- **present but not in the goal layout** → a *stale* structure

Stale-structure teardown rules:
- Never auto-demolish a **spawn**. `building.ts` may build a *new* spawn at a new goal position once the RCL unlocks the slot, but destroying an existing spawn is never automatic — losing the only spawn mid-migration is colony-fatal. Any spawn teardown is a separate, explicitly-gated step (build the new spawn first, confirm it exists and is full HP, and only then consider the old one — and never the last remaining spawn).
- For non-spawn stale structures, teardown may be automated but should be conservative (e.g. don't churn roads every tick).

## Unit tests — `test/unit/building.test.ts` (placement half; quota half tracked in issue #18)

- fresh RCL2 room with a computed anchor emits placeSite intents for the RCL2 buildable subset (5 nearest extensions + spawn) but not RCL3+ structures
- a room where all RCL-appropriate structures already exist emits nothing (idempotency)
- a room already at the construction-site cap emits nothing further (no over-cap requests)
- RCL-up between ticks unlocks the next tier's intents without re-requesting already-built structures
- **road gating**: at RCL2, roads not adjacent to an existing/placed structure are not requested
- **stale non-spawn structure**: a structure at a position absent from the goal layout is flagged for teardown
- **spawn safety**: a spawn at a stale position is never auto-demolished (esp. when it's the room's only spawn)

## Acceptance criteria

- [ ] `planBuilding` covered by unit tests for fresh/idempotent/capped/RCL-up cases, fixture-only
- [ ] Anchor is computed once and persisted to `ColonyMemory.anchor`, not recomputed every tick
- [ ] `placeSite` intents respect `MAX_CONSTRUCTION_SITES` and per-RCL structure counts (the latter via `buildableAtRcl`)
- [ ] Road gating implemented: roads placed only where they serve an existing/placed structure
- [ ] Stale structures handled; spawns never auto-demolished (never the last spawn)
- [ ] No regressions in existing unit or integration tests

## Blocked by

- #14 (bunker goal layout + `buildableAtRcl`) — ✅ done
- #15 (road paths)
