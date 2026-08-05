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

**`Squad` is generic infrastructure; behavior is supplied by the caller.** Decided:
`Squad`/`runSquads()` itself knows nothing about towers, healing, or attackers — only
slots, members, anchors, facings, and formation geometry, the same split `RoleDef`/`Step`
already draw between the generic step-table engine and each role's own step content. A
squad "type" (Drain's, and whatever comes later) is defined entirely by what's plugged
in: a `Formation` (slots + roles + anchor), and a `planSquadActions` function (below) —
`Squad` calls out to both without interpreting them.

### Movement and action are independent, both fire every tick

Decided: unlike the old step table's single "primary step per tick" model, a squadded
creep's movement and action are two unrelated intents, both issued unconditionally every
tick — not "act if in range, else move" (the old `standStill` gating). This isn't a new
engine capability to design around: Screeps already allows a creep to call e.g.
`rangedAttack()` and `move()` in the same tick (see `attackStep`/`fleeThreat`'s existing
kiting behavior in `interpreter.ts`) — it was only the step table's shared "one step wins
primary status" bookkeeping that serialized them for Drain specifically. Removing
squadded movement from the step table removes that constraint by construction; this
section just makes explicit that both must actually be *called*, not merely that doing so
is now legal.

**Action assignment is squad-level knowledge, not per-creep target resolution.**
`SquadState.members` already holds every member's position/HP/role for `planSquadMove` —
the same state answers "who's most damaged" or "is a tower in range of the attacker's
slot" directly, without each creep independently re-deriving it the way
`TargetSpec`'s `find: "squadMate", prefer: "mostDamaged"` does today. So instead of a
per-creep target-selection function, the squad computes one assignment map per tick,
supplied by the formation's own plugged-in planner (Drain's rule — attacker targets
tower-then-hostile, healer targets most-damaged — is Drain-specific content, not generic
squad logic; a future squad type supplies its own):

```ts
function planSquadActions(state: SquadState, colony: ColonySnapshot): Map<CreepId, ActionIntent>;
// e.g. { drainAttacker_id: {do:"attack", target: towerId}, drainHealer_id: {do:"heal", target: mostDamagedId}, ... }
```

`runSquads()` per tick, per squad: `planSquadMove(state, goal)` and
`planSquadActions(state, colony)` are computed independently, both maps handed to
`runSquadMember(creep, moveAssignment, actionAssignment)`, which issues both intents
unconditionally — no gating, no primary/co-fired distinction, no shared per-tick resource
to contend over the way the step table had. This is simpler than the mechanism it
replaces, not more complex.

### Execution seam: membership-based diversion, squads iterated separately

Revised from an earlier draft that diverted by *role* (`drainAttacker`/`drainHealer`
always skip the step table). Diverting by role can't support requirement 5 (squad mode
dissolves, creeps fall back to individual behavior) — a role-level fork has no way back
to the step table once a creep's role says "squad member," permanently.

Decided instead: squad-ness is a **per-tick runtime state**, checked by membership, not
baked into the role. The same creep, same role, same body can be squadded this tick and
not the next; when it's not squadded, it runs the ordinary step table exactly like any
other creep of that role would. This also means `drainAttacker`/`drainHealer` keep real
step tables (used whenever NOT currently squadded — e.g. before the squad has formed, or
after it dissolves) rather than losing them entirely.

`runCreepBehaviors`'s per-creep loop gets a membership check ahead of its existing
diversions, and squads are iterated as their own top-level pass afterward — not folded
into the per-creep loop:

```ts
for (const name in Game.creeps) {
  const creep = Game.creeps[name];
  if (creep.spawning) continue;
  if (isSquadMember(creep)) continue; // handled by runSquads() instead, below
  if (creep.memory.role === "transport" || creep.memory.role === "supply") { ... }
  if (creep.memory.role === "steward") { ... }
  runOne(creep); // ordinary step table — now includes drainAttacker/drainHealer when NOT squadded
}

runSquads(); // separate pass, iterates squads (not creeps) — computes the squad-wide plan once,
             // then dispatches each current member into runSquadMember(creep, assignment)
```

**Membership is derived, not stored** — no separate squad flag, no `squadId`. A creep is
"in a squad" exactly when `Operation.owned()` (keyed by `memory.op`, ADR 0006's existing
pattern) resolves a live squad-bearing operation that claims it. Computed once per tick
into a shared `Set<Id<Creep>>`, checked by the main loop above and reused by `runSquads()`
itself, so there's exactly one source of truth — no risk of a creep falling into neither
pass (frozen) or both (double move intent) from two membership computations disagreeing.

**One squad per `op`, by construction — not a limitation.** Because membership is
`op`-derived with no `squadId` (ADR 0006's existing pattern, now generalized to every
squad-based operation, not just Drain), every creep sharing an `op` value is treated as
one squad. This isn't a scope cut to revisit later: an operation that wanted a second
simultaneous target (e.g. draining two rooms at once) was never going to be one operation
instance's problem regardless of the movement system, since `colony.draining` is already
a single scalar target and "exactly one drain target per colony" is load-bearing for
Drain's own design (ADR 0006). A second concurrent drain is a second operation instance
with its own `op` stamp — already naturally isolated, no new mechanism required. Any
future squad operation that legitimately needs multiple concurrent squads under one
operation identity (as opposed to just running two instances) would need a real
`squadId` — but nothing here is designed assuming that's coming.

This removes the move-vs-action race the current step table has to referee with
`Step.standStill` and the `creepAwayFromSquadTargetPos`/`runMoveToPos` preemption hack in
`empire/creeps.ts` — those exist purely because `heal`/`attack` and `moveToPos` were
competing for "primary step" status inside one shared step-table dispatch. While
squadded, movement is dictated externally by the squad and action selection (attack tower
vs. hostile; heal most-damaged) becomes a small direct function called from
`runSquadMember`, not a step-table entry contending for the same slot — so the race can't
occur for a squadded creep. `Step.standStill`, `creepAwayFromSquadTargetPos`, and
`runMoveToPos` should all be deleted: their entire purpose was refereeing that race inside
the step table, which no longer applies now that squadded movement never touches the step
table at all. The role's own step table (used only while unsquadded) goes back to a plain
`moveToRoom`/`heal`/`attack` shape with no `standStill` needed, since there's no
externally-dictated movement to race against in that state.

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

## Resolved in the follow-up grilling session

- **Vacant-slot walkability/footprint-fit: always check the full formation shape**,
  regardless of current occupancy. Rejected: shrinking the fit-check to only occupied
  slots — the squad could then occupy a position the full formation can't fit into, and a
  later replacement (which must independently catch up, never gets a hold — see below)
  would have no reachable path to a slot that's geometrically invalid wherever the squad
  currently stands. Full-shape-always guarantees "wherever the squad is, a full-strength
  formation could stand there," which replacement re-entry depends on.
- **Replacement spawn re-entry: independent approach, no holding, gated by same-room
  proximity.** A freshly-spawned replacement already carries the right `op` stamp (same
  as any squad member, `fillSquadRole` in `drain.ts`), but `op`-membership alone is
  necessary, not sufficient — otherwise a creep still sitting at the home spawn would be
  yanked into `planSquadMove`/`planSquadActions` immediately. The gate is **same room as
  the squad's current anchor**: below that, the creep is treated as not-yet-squadded and
  runs its own ordinary step table (`moveToRoom` toward the target room) to get there —
  the step table can only ever chase a room, never a moving formation slot, so this is
  the natural (and only) point control can hand off. Once same-room, it's a full member;
  `runSquads()`'s per-member assignment (the same nearest-available greedy logic reform
  already uses) naturally slots it into whatever's vacant. The squad never pauses for a
  replacement — per the degraded-formation decision above, holding for one would defeat
  the entire point of staying functional with a slot empty.
- **Action assignment**: see "Movement and action are independent" above —
  `planSquadActions` is squad-level, supplied per formation type, not a per-creep
  `TargetSpec` port.

- **Cross-room transitions (requirement 6): same mechanism as in-room, no special case.**
  `findSquadPath`'s `(x, y, room, facing)` state space already generalizes across room
  borders the same way single-creep Traveler already does — a footprint-fit check just
  needs terrain/cost-matrix data for whichever room the candidate tile is in. The one real
  requirement is that data must be available *before* the squad commits to a crossing, not
  discovered on arrival (consistent with "precompute the whole route up front," decided
  above) — vision-independent, mirroring `drainRoomTerrain`'s existing pattern of caching
  `Game.map.getRoomTerrain` per room regardless of current visibility. So the room cost
  matrix cache (keyed by formation shape) needs a vision-independent terrain source per
  room on the route, same as Drain already builds for its own target/route rooms today,
  generalized to whatever rooms a given squad's route crosses. No new mechanism — this
  was already implied by the existing cache design, just not spelled out.
- **Squad-vs-squad or squad-vs-non-squad-creep collision: deferred, confirmed with the
  user.** Two squads (or a squad and an unrelated creep) contending for the same tile
  isn't addressed — today's single-squad Drain case never faced this, and no operation
  built on this system yet runs two squads that could meet. Screeps' native
  move-conflict resolution is the fallback for a stray non-squad creep in a squad's path.
  Revisit if/when a second concurrent squad-capable operation is built.
