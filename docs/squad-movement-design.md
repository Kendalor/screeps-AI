# Squad movement redesign (working design doc)

Follow-up to [drain-squad-handoff.md](drain-squad-handoff.md) and
[ADR 0006](adr/0006-drain-energy-operation.md). That handoff diagnosed why per-creep
independent Traveler calls can't hold a formation together over distance and recommended
a leader-relative model instead of the current geometric-offset-plus-independent-pathing
approach. This doc is the result of designing that replacement, generalized beyond Drain's
specific 1+3 squad to arbitrary formations/sizes per the requirements below.

**Status: not yet implemented, not all edges closed.** Sections marked "Open" are
unresolved. This is a working artifact, not an ADR — promote to one once the open
questions close and an implementation exists to validate the design against.

## Requirements driving this design

1. Creeps assigned to a squad act as one entity, not individually.
2. Creeps can move individually to the assembly/staging point (no formation discipline
   needed pre-assembly — this part of today's `drain.ts` rally logic is kept as-is).
3. Once assembled, creeps move as a squad via direct movement commands, not independent
   per-creep pathing.
4. Route is calculated for the whole squad (its footprint), not per-member.
5. Squad mode can be dissolved and creeps revert to acting individually.
6. Squads must be able to transition rooms safely.
7. Formations support mixed member types/roles (e.g. attacker in front, healers behind).
8. Squads can turn/reorient, including swapping which physical tiles front/back members
   occupy.
9. The system supports different formation shapes and squad sizes, not just Drain's
   fixed 2x2.

## Why the current model can't be patched (recap)

Every creep runs through `runOne` (`empire/creeps.ts`) independently once per tick, each
owning its own Traveler state (`Memory._trav`) — a real per-creep pathfind with its own
cache and repath-on-stuck behavior. `drain.ts` computes a `squadTargetPos` centrally per
member per tick (right instinct — squad decision-making belongs in the operation) but
then still hands each member off to *independent* Traveler calls to reach it. Nothing
keeps four independent paths in step tick-to-tick, so they drift, which is what the
`inFormation` gate exists to detect and stall on. That gate is a symptom, not a fix: it
discovers divergence after the fact and waits, rather than preventing divergence from
happening.

The fix has to remove independent per-member pathing entirely while squadded — the squad
computes one route for its own footprint and dictates every member's move, not just its
target.

## Core model

### Formation is data, not hardcoded geometry

`lib/formation.ts`'s hardcoded 2x2 `QUADRANT` table (3 followers at fixed relative
corners) is replaced by an explicit shape:

```ts
interface FormationSlot {
  dx: number;   // offset from anchor at canonical facing (TOP)
  dy: number;
  role: string; // e.g. "attacker" | "healer" — matched against creep role/memory
}
type Formation = FormationSlot[];
```

A formation is defined once at a canonical facing; rotating to any other facing is a pure
geometric transform of every slot's `(dx, dy)`. This generalizes today's `QUADRANT`
lookup from "4 fixed orientations of one fixed 2x2" to "N orientations of any shape."
`followerOffsets()` becomes `slotTiles(anchor, facing, formation)`.

**Anchor is a slot, not a creep.** The anchor is the formation's own geometric reference
point (e.g. Drain's attacker slot, at `dx:0, dy:0`), fixed at formation-definition time —
not "whichever creep is currently leading," and not reassigned when that slot's occupant
dies. This directly serves the retreat-in-current-formation decision below: a formation
must remain path-able and reform-able with slots vacant, including the anchor slot
itself. There is no more `leaderOf()`-style "pick a substitute leader" logic — the
formation has one designated anchor slot, permanently, whether or not anyone currently
stands there.

### Two things a squad does, one shared assignment mechanism

**Travel**: the anchor moves along a precomputed route; facing tracks direction of travel
tile-to-tile, for free — no separate command. Formation shape doesn't change, only which
way it's pointed. This is where requirement 8's "turning" is free 90% of the time: a
squad marching east just naturally reorients to face east.

**Reform**: an explicit facing change while the anchor holds still (decided: reform is
always stationary, never concurrent with travel — mutually exclusive states, matching
today's `inFormation`-gates-advance pattern, simpler and easier to test than concurrent
drift-while-catching-up). Solved as a minimum-cost one-to-one assignment from each
member's current tile to a destination slot tile at the new facing:

```ts
function reformAssignment(members: {id, pos}[], destinationTiles: XY[]): Map<CreepId, XY>
```

Squads here are small (decided: a 6-creep squad is already large), so a greedy
nearest-available assignment is sufficient — no need for a real Hungarian algorithm.
Every unsettled member steps one tile per tick toward its assigned destination; reform
completes when everyone (every *occupied* slot — vacant slots need nobody to arrive) is
at its assigned tile. Screeps' native move-conflict resolution (creeps can swap into each
other's tile in one tick) is assumed to handle the small amount of local shuffling this
produces; worth confirming live rather than building custom collision avoidance up front.

This single mechanism covers both the "swap in place" case (2x2, any rotation — the
rotated tile-set equals the original tile-set, so the assignment resolves in exactly 1
tick) and the general reshape case (e.g. a 2x3 rotating 90°, where the destination
tile-set only partially overlaps the source and the reform takes several ticks) — they're
the same algorithm, just different assignment costs. No separate "fast swap" path is
needed (decided: duration doesn't matter tactically, squads are small enough that this
was never worth special-casing).

### Footprint-aware route search

Single-creep Traveler pathing is insufficient — a candidate tile is only valid for the
squad if *some* orientation of its whole footprint fits there, generalizing today's
`blockIsWalkable`/`walkableOrientation` (which only checks the immediate next tile, one
committed orientation at a time) into a full route search.

Decided: routes are precomputed for the whole footprint up front (not discovered
reactively tile-by-tile) — the squad should know before departing whether a route is
even walkable for its shape, not walk into a dead end. Cost matrices are cached per room
(keyed by formation shape, since a 2x2 and a 2x3 have different feasibility maps) and
reused across ticks/squads, invalidated on the same triggers the existing room cost
matrix already uses.

Because reform is stationary-only, a route that requires a facing change partway through
has to represent that as a hold-and-reform, not a continuous move. Model the path search
over an augmented state `(x, y, room, facing)` rather than plain `(x, y, room)`: an edge
either moves the anchor one tile at the current facing, or holds the anchor and changes
facing (a same-tile "reform" edge). A* over this state space, with the reform edge's cost
priced as an estimate (e.g. flat N-tick penalty) rather than running the real assignment
algorithm just to price a path edge — the real cost gets paid when the reform actually
executes.

```ts
interface SquadPathStep { anchor: XY & { room: string }; facing: DirectionConstant }
function findSquadPath(
  start: { anchor: XY & { room: string }; facing: DirectionConstant },
  goal: XY & { room: string },
  formation: Formation,
  costMatrixCache: RoomCostMatrixCache
): SquadPathStep[] | undefined
```

### The `Squad` entity

The thing the requirements call "acting as one" — owns per-tick movement decisions for
every member, recomputed fresh each tick (mirroring how `squadTargetPos` is already
recomputed every tick rather than trusted stale, per `drain.ts`'s existing comments on
why that mattered for avoiding stuck states).

```ts
interface SquadState {
  members: SnapCreep[];          // creeps currently filling formation slots (may be fewer than formation.length)
  formation: Formation;
  anchor: XY & { room: string }; // the anchor SLOT's tile, not a creep's position
  facing: DirectionConstant;
  mode: "assembling" | "traveling" | "reforming" | "holding";
}

function planSquadMove(state: SquadState, goal: XY & { room: string }, cache: RoomCostMatrixCache): SquadIntent[];
```

Emits direct per-member move intents (resolved tile or direction), not a
`squadTargetPos` for a `moveToPos` step to independently chase. This is the actual
mechanism fix — no independent Traveler call ever runs for a squadded member's movement.

Assembly (rally to staging room) is unchanged: independent movement, no formation
discipline, exactly as `drain.ts` does today. The new machinery only engages once
assembled and formation-keeping actually matters.

### Execution seam: full role diversion

Decided (over a hybrid "squad claims movement, step table still runs actions" option):
squad member roles get a full diversion in `runCreepBehaviors`, the same pattern
`transport`/`supply`/`steward` already use:

```ts
if (creep.memory.role === "drainAttacker" || creep.memory.role === "drainHealer") {
  runSquadMember(creep); // movement AND action (heal/attack), no step table at all
  continue;
}
```

This removes the move-vs-action race the current step table has to referee with
`Step.standStill` and the `creepAwayFromSquadTargetPos`/`runMoveToPos` preemption hack in
`empire/creeps.ts` — those exist purely because `heal`/`attack` and `moveToPos` were
competing for "primary step" status inside one shared step-table dispatch. Full diversion
removes the race by construction: movement is dictated externally by the squad, action
selection (attack tower vs. hostile; heal most-damaged) becomes a small direct function
per role, not a step-table entry contending for the same slot. `Step.standStill`,
`creepAwayFromSquadTargetPos`, and `runMoveToPos` should all be deleted as part of this
work, not kept around — they have no purpose once movement isn't step-table-driven.

### Dissolution and degraded formations

Decided: dissolution is operation-driven only, no autonomous squad-side dissolve logic
(matches requirement 5 and today's op-based membership model — the operation decides,
the squad system just executes).

Decided: on member loss, retreat **in the current formation**, not a reshaped smaller
one. A vacant slot is tolerated indefinitely — no automatic reform-to-fewer-slots. This
is why the anchor-as-slot decision above matters: some formations remain functional with
a slot vacant (Drain's healers can keep draining a tower with the attacker slot empty),
so the squad must stay path-able and reform-able with any subset of slots occupied,
including the anchor slot itself having nobody in it.

## Open questions (not yet resolved)

- **Vacant-slot walkability/footprint-fit.** Does an unoccupied slot's tile still need to
  be walkable for the footprint-fit check, or can the route search relax the constraint
  for slots nobody currently occupies (e.g. squad missing its attacker could thread a
  gap the full formation couldn't)? Leaning toward "always check the full formation's
  footprint regardless of current occupancy" for stability (a spawned replacement must be
  able to catch up to wherever the squad already is), but not decided.
- **Action target selection replacing the step table.** `drainAttacker`/`drainHealer`'s
  current steps (`attack` tower-then-hostile, `heal` most-damaged squadmate) need a
  direct-function equivalent under full role diversion. Likely straightforward — same
  target-selection logic, just called directly from `runSquadMember` instead of resolved
  via `TargetSpec`/step dispatch — but not designed yet.
- **Replacement spawn re-entry.** When a new creep spawns to fill a long-vacant slot, how
  does it join a squad that's already mid-route/mid-formation? Does it path independently
  to the squad's current anchor (like today's rally-to-staging) and get folded in once
  adjacent, or does the squad have to pause/hold for it the way full assembly is gated
  today?
- **Cross-room transitions (requirement 6).** Footprint-aware pathing across a room
  border needs the destination room's cost matrix/terrain cached before the squad
  commits to crossing, similar to how `drainRoomTerrain` is already snapshotted
  vision-independently for Drain. Not yet worked through for the general squad case.
- **Squad-vs-squad or squad-vs-non-squad-creep collision.** Two squads (or a squad and an
  unrelated creep) contending for the same tile isn't addressed — today's single-squad
  Drain case never faced this.
