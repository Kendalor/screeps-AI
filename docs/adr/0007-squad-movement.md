# Squad movement: a general entity, not per-operation formation math

Supersedes the formation-movement half of [ADR 0006](0006-drain-energy-operation.md)
("Leader-relative offsets for formation, built as a swappable unit"). ADR 0006's squad
membership rule (derived from `op`, no `squadId`) and its overall operation shape are
unaffected and remain in force. See [drain-squad-handoff.md](../drain-squad-handoff.md)
for the live-observed failure this replaces, and
[squad-movement-design.md](../squad-movement-design.md) for the full design discussion.

## Context

ADR 0006 shipped formation movement as per-creep independent Traveler calls converging on
operation-computed offsets (`squadTargetPos` + `followerOffsets`), gated by an
`inFormation` check that stalled the leader until stragglers caught up. Live on shard0
this produced "moving, but badly uncoordinated": roughly 1 tile per 10-15 ticks, healers
drifting ahead of the leader, formation oscillating every tick. Root cause: four creeps
each computing an independent path to an individually-offset target have nothing keeping
them in step tick-to-tick — different terrain, different Traveler internal state,
different congestion. `inFormation` discovers that divergence after the fact and waits;
it cannot prevent it. Patching this further was assessed as not viable — the underlying
movement primitive (independent per-creep pathing toward a shared destination) is wrong
for "stay physically welded to this formation," not merely buggy.

Separately, new requirements emerged beyond Drain's fixed 1-attacker+3-healer 2x2:
mixed-role formations, variable squad sizes/shapes, and turning — including a formation
rotating far enough that front and back members must exchange physical tiles.

## Decision

**A squad is its own entity, computing one route and one set of member intents, not a
per-creep destination for each member's own Traveler call to chase independently.** This
is the mechanism fix: nothing about formation cohesion is discovered after the fact and
corrected (as `inFormation` did); the squad's plan is what moves every member, so members
cannot diverge from each other by construction.

**Formation is data (slots with offsets and roles), not hardcoded per-squad geometry.**
`lib/formation.ts`'s fixed 2x2 `QUADRANT` table is replaced by an explicit
`FormationSlot[]` (`{dx, dy, role}` relative to an anchor at a canonical facing) — the
same shape now serves Drain's 2x2 and any future squad's different size/composition, with
rotation to any facing a pure geometric transform of the offsets.

**The anchor is a designated slot, not whichever creep currently leads.** Fixed at
formation-definition time (Drain: the attacker's slot). This replaces ADR 0006's
`leaderOf()` substitute-leader logic outright — there is no "who leads now" question,
only "is the anchor slot currently occupied," which the formation must tolerate being
false (see degraded formations, below).

**Two motions, one shared assignment mechanism.** *Travel*: the anchor advances along a
precomputed route; facing tracks direction of travel for free, no separate command — this
covers most of the "turning" requirement without any explicit maneuver. *Reform*: an
explicit, always-stationary facing change (never concurrent with travel — mutually
exclusive states), solved as a minimum-cost one-to-one assignment of current member
positions to the new facing's slot tiles. Rejected: a distinct fast "swap in place"
operation for symmetric formations (e.g. 2x2, where every rotation maps the tile-set onto
itself) versus a slower general "reshape" path for asymmetric ones (e.g. 2x3 turning 90°,
where the tile-sets only partially overlap) — these are the same algorithm with different
assignment costs, and duration doesn't matter tactically for squads this small (a 6-creep
squad is already considered large), so there is no reason to special-case the symmetric
case.

**Routes are precomputed for the whole footprint, not discovered reactively.** A
candidate tile is only valid if some orientation of the entire formation shape fits
there — generalizing ADR 0006's `blockIsWalkable`/`walkableOrientation` (checked one
committed step at a time) into a full route search before the squad commits to it. The
walkability check always uses the full formation shape regardless of how many slots are
currently occupied (see degraded formations, below, for why). Because reform is
stationary-only, a route needing a facing change mid-route is a hold-and-reform, not a
continuous move: the path search runs over an augmented `(x, y, room, facing)` state,
where an edge either advances the anchor one tile at the current facing or holds the
anchor and changes facing in place. This generalizes across room borders with no special
case — a footprint-fit check just needs terrain/cost-matrix data for whichever room the
candidate tile is in, cached vision-independently per room on the route (same pattern
`drainRoomTerrain` already uses for Drain specifically), available before the squad
commits to crossing, consistent with "precompute the whole route up front." Cost matrices
are cached per room, keyed by formation shape (a 2x2 and a 2x3 have different feasibility
maps), reused across ticks and squads.

**Squad membership is derived, not stored — extending ADR 0006's rule to every
squad-based operation, not just Drain.** A creep is in a squad exactly when
`Operation.owned()` (keyed by `memory.op`) resolves a live squad-bearing operation that
claims it — no `squadId`. This means one squad per `op`, by construction. Not treated as
a limitation to revisit: an operation wanting a second simultaneous target was never
going to be one operation instance's problem regardless of the movement system (Drain's
`colony.draining` is already a single scalar target, per ADR 0006) — a second concurrent
target is a second operation instance with its own `op` stamp, already isolated with no
new mechanism.

**Execution seam: membership-gated diversion, squads iterated as their own pass — not a
role-level fork.** Squad-ness is per-tick runtime state, not baked into the role: the same
creep, same role, can be squadded this tick and not the next. `runCreepBehaviors`'s
per-creep loop skips any creep current squad membership claims (computed once per tick
into a shared set, reused by the squad pass — one source of truth, so no creep is ever
skipped by both passes or neither); a separate `runSquads()` pass iterates squads, not
creeps, computing each squad's plan once and dispatching every current member into
`runSquadMember`. Rejected: diverting by role permanently (`drainAttacker`/`drainHealer`
always bypass the step table) — this cannot support squad mode dissolving back to
individual behavior, which requires a real way back to the step table. Unsquadded
members (before joining, or after dissolution) keep an ordinary, simplified step table.

**Movement and action are independent intents, both issued every tick — not "act in range,
else move."** Screeps already permits a creep to move and act in the same tick (existing
kiting behavior in `interpreter.ts`); ADR 0006's `Step.standStill` and the
`creepAwayFromSquadTargetPos`/`runMoveToPos` preemption hack in `empire/creeps.ts` existed
only to referee movement and action steps contending for one shared "primary step" slot
inside the step-table dispatch. Removing squadded movement from the step table removes
the contention by construction — both `standStill` and the preemption hack are deleted,
not kept, since nothing exists anymore for them to referee.

**Action assignment is squad-level knowledge, computed once per squad, not resolved
per-creep.** The squad already holds every member's position/HP/role for movement
planning; the same state answers "who's most damaged" or "which tower is in range of the
attacker's slot" directly. `planSquadActions(state, colony)` returns one assignment map
per tick, supplied by the formation's own plugged-in content (Drain: attacker targets
tower-then-hostile, healer targets most-damaged) — `Squad` itself never interprets
"tower" or "heal." This is the same split `RoleDef`/`Step` already draw between a generic
step-table engine and each role's own content, one level up: `Squad` is generic
infrastructure — slots, members, anchors, facings, routing, reform — and a `Formation`
plus a `planSquadActions` function is what makes a squad "type" (Drain's, or any future
one).

**Degraded formations retreat as-is; no autonomous reshaping.** On member loss, the squad
retreats in its current formation shape with the lost slot vacant indefinitely — no
reform to a smaller shape. Some formations remain functional degraded (Drain's healers
can keep draining a tower with the attacker slot empty), which is why the anchor is a
slot rather than a creep, and why walkability always checks the full shape (a shrunk
fit-check could let the squad occupy ground a full-strength formation can't reach,
stranding a later replacement). Dissolution itself is operation-driven only — the squad
system has no autonomous dissolve condition, matching ADR 0006's existing op-driven
membership model.

**Replacement spawn re-entry: independent travel, no holding, gated by same-room
proximity.** A spawned replacement carries the right `op` stamp immediately, but
`op`-membership alone would pull it into squad planning while still walking from the
spawn — not sufficient on its own. The gate is same room as the squad's current anchor:
below that, the replacement runs its own step table (`moveToRoom`) to close the distance,
since the step table can only ever chase a room, never a moving formation slot — this is
the only point control can hand off. Once same-room, it's a full member and the squad's
existing nearest-available assignment slots it into whatever's vacant. The squad never
holds for a replacement; per the degraded-formation decision above, that would defeat the
purpose of staying functional with a slot empty.

## Consequences

- `lib/formation.ts` (hardcoded 2x2 offsets), `Step.standStill`,
  `creepAwayFromSquadTargetPos`, and `runMoveToPos` (`empire/creeps.ts`) are removed, not
  kept alongside the new system — they solved problems (fixed-shape geometry, step-table
  move/action contention) that don't exist under this design.
- `drainAttacker`/`drainHealer` keep real step tables for the first time in a meaningful
  sense — used only while unsquadded (pre-assembly, post-dissolution), simplified back to
  plain `moveToRoom`/`heal`/`attack` with no `standStill` needed.
- Squad-vs-squad and squad-vs-non-squad-creep tile collision is explicitly deferred — no
  operation built on this system yet runs two squads that could meet; Screeps' native
  move-conflict resolution is the fallback for a stray creep in a squad's path. Revisit
  if a second concurrent squad-capable operation is built.
- One squad per `op` is now a general property of every squad-based operation, not a
  Drain-specific note. A future operation needing multiple concurrent squads under one
  operation identity (as opposed to separate operation instances) requires introducing a
  real `squadId` — a bigger change than adding a field, since membership derivation, the
  `runSquads()` iteration, and the anchor/slot model all currently assume one squad per
  operation.
- Not addressed by this ADR, deliberately out of scope: an explicit trigger mechanism for
  requesting a reform (this ADR defines the mechanism, not when an operation chooses to
  invoke it), and any tactical logic beyond Drain's own attack/heal targeting rules.
