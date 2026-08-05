# Handoff: Drain squad movement needs a redesign

**Redesign decided:** see [ADR 0007](adr/0007-squad-movement.md) (design discussion in
[squad-movement-design.md](squad-movement-design.md)) — a general `Squad` entity
computing one route/plan for the whole formation, replacing the per-creep independent
Traveler convergence this handoff diagnosed below. Not yet implemented.

## Current live state (pserver, tick ~122714)

`clearDrainTarget("W5N3")` was run in-console — `Memory.colonies["W5N3"].draining` is
cleared, so the `Drain` operation no longer attaches and no new drain creeps spawn.
3 leftover squad creeps (`drainAttacker_W5N3_122009`, `drainHealer_W5N3_122095`,
`drainHealer_W5N3_122520`) are still alive but orphaned (no operation drives them) —
left to die of old age, not killed. **The operation is stopped, not deleted.** All the
code below is still in the tree, uncommitted, on branch `rewrite`.

## Why it's stopped: the squad never reliably reached the target room

Across one debugging session I fixed five real, confirmed-live bugs (see "Fixed this
session" below) and the squad went from "frozen in place forever" to "moving, but
badly uncoordinated" — advancing roughly 1 tile per 10-15 ticks, healers drifting
ahead of the leader, formation oscillating in and out every tick. The user's read,
which matches what I was seeing: **the underlying movement model is wrong, not just
buggy** — patching it further is not going to converge. This handoff is for a
redesign, not another patch pass.

## Root design problem

`operations/drain.ts`'s `intents()` computes one absolute target position
(`squadTargetPos`, `{x,y,room}`) per squad member, once per tick, and hands each
member's own Traveler (`moveToPos` step, `behaviors/interpreter.ts`) off to path there
independently. This works fine once everyone is already within a couple tiles of each
other (Traveler's per-creep paths agree closely over short distances). It falls apart
completely over any real distance:

- While crossing a room the squad isn't already tight in (e.g. mid-transit through the
  staging room, or the first push into the target room), each of the 4 creeps
  computes an **independent Traveler path** to its own individually-offset target tile.
  Nothing keeps those 4 paths in step tick-to-tick — different terrain, different
  Traveler internal state, different congestion — so they drift apart by several tiles,
  which flips the `inFormation` gate (added this session) to `false`, which holds the
  leader... but the followers are each still independently pathing toward wherever
  their own *last* offset was, not toward each other, so they don't actually converge
  quickly. Observed live: leader held in place for 10-15 ticks at a stretch while
  followers slowly wandered back into range, then it'd advance one step, then scatter
  again.
- `followerOffsets` (`lib/formation.ts`) computes offsets **relative to the leader's
  own future position**, but that's only a meaningful "formation" once the block is
  already tight — while spread out, "your offset is 2 tiles from the leader's NEXT
  tile" is not the same thing as "walk toward the leader," and Traveler doesn't know
  anything about the other 3 creeps at all.
- There is no leader-follows-a-path-followers-inherit-the-path-with-a-delay model
  (the way most Screeps squad-movement implementations actually do this) — every
  creep is independently globally-pathing to a point, which is fundamentally the wrong
  primitive for "stay physically welded to this other creep."

**Recommendation for the redesign:** look at a leader-relative *step-history* or
*conga-line* model instead — the leader paths normally (its own Traveler call,
unconstrained), and each follower's target each tick is simply "the tile the leader
(or the follower ahead of it) occupied N ticks ago" or "the tile directly behind
whichever squad member it's chained to," rather than an independently-computed
absolute offset that assumes everyone's already converged. That's the standard
solution to this problem in Screeps squad code generally. A full body-locked
"stay within range 1 of literally everyone, every tick, during transit" requirement
(as currently specified) may not be achievable with independent per-creep Traveler
calls at all — worth revisiting whether transit needs the full 2×2 rigidity, or only
once inside the hostile room where the heal-radius requirement actually matters.

## Fixed this session (real, confirmed-live bugs — keep these fixes regardless of redesign direction)

1. **Spawn-time `attackTargetRoom` gap → permanent step-latch.** `Drain`'s squad spawn
   requests never stamped `attackTargetRoom` (unlike `Attack`, which does). A creep's
   first live tick before `Drain.intents()` ran could see `moveToRoom`'s dest as unset,
   fall through same-tick into `moveToPos`, and latch there forever — nothing in the
   step-table model (`firstRunnableStep`/`nextStep` in `behaviors/interpreter.ts`) ever
   scans backward once `task.step` advances past `moveToRoom`, because every step in
   that table is `"move"`-kind and `isComplete` never returns true for a move step
   except via `targetGone`. **Fix:** collapsed `moveToRoom` + `moveToPos` into a single
   step (`moveToPos` alone) for `DrainHealer`/`DrainAttacker`, driven by a
   `squadTargetPos` that `Drain.intents()` now sets **every tick, unconditionally, for
   every squad member** (including stragglers) — no two-step handoff, so there's no
   earlier step to fall behind on. See `drainHealer.ts`/`drainAttacker.ts` headers.

2. **No formation enforcement at all — leader advanced regardless of stragglers.**
   Added an `inFormation` gate in `drain.ts`: leader only takes its next
   advance/retreat step once every follower is confirmed within Chebyshev range 1 of
   it (same room). Otherwise it holds at its own current tile. This is the mechanism
   that's now producing the "1 tile per 10-15 ticks" crawl — it's *working as
   specified*, the specification (independent-Traveler-convergence) is the problem.

3. **`advanceIsSafe` only ever checked one tile of *projected* damage, never
   accumulated damage already taken.** Added a `fullyHealed` gate: won't advance
   again until every squad member is back to full HP (retreat/hold are never gated,
   only advance).

4. **Formation offsets were purely geometric, no terrain awareness.** A follower could
   be assigned a wall tile it could never physically reach, freezing the squad forever
   against the (correctly working) `inFormation` gate. Added `ColonySnapshot.drainRoomTerrain`
   (vision-independent — `Game.map.getRoomTerrain` works for any room name) and
   `walkableOrientation()` in `drain.ts`, which validates the whole candidate 2×2 block
   against all 4 possible orientations before committing, falling back to holding if
   none work.

5. **`heal`/`attack` steps could silently steal "primary step" status from `moveToPos`
   forever.** `find:"squadMate"` always resolves to *something* (it includes the
   acting creep itself), so an undamaged healer sitting one tile short of its slot
   could trivially "heal" itself every tick and report `acted:true` — `moveToPos`
   never got a turn once `task.step` landed on `heal`. Added `Step.standStill` (a new
   flag in `behaviors/types.ts`) so `heal`/`attack` can act in range but never call
   `travelTo`, even as the primary step. Also added an explicit preemption in
   `empire/creeps.ts`'s `runOne`: whenever a role has a `moveToPos` step and the creep
   isn't exactly at its `squadTargetPos`, that step is forced to run as primary this
   tick regardless of the cached `task.step` (`creepAwayFromSquadTargetPos` /
   `runMoveToPos` in `empire/creeps.ts`).

All five are covered by unit tests (`test/unit/operations/drain.test.ts`,
`test/unit/roles/drainHealerFormationLatch.test.ts` — the latter has two tests that
were verified to actually fail without their respective fix, not just pass
trivially). Full suite is green except 2 pre-existing, unrelated failures in
`test/unit/interpreter.test.ts` (upgrader container-step assertions, confirmed
present on a clean `git stash` before this session started — not caused by any of
this work).

## What's still uncommitted in the tree

All on branch `rewrite`, nothing committed:

- `src/operations/drain.ts` — the 5 fixes above (formation gate, HP gate, terrain
  validation, rally-branch rewrite, `walkableOrientation`/`blockIsWalkable`/`walkable`
  helpers)
- `src/behaviors/roles/drainAttacker.ts`, `drainHealer.ts` — collapsed step tables,
  `standStill: true` on the acting steps
- `src/behaviors/types.ts` — new `Step.standStill?: boolean` flag
- `src/empire/creeps.ts` — `moveToPos` preemption (`creepAwayFromSquadTargetPos`,
  `runMoveToPos`)
- `src/empire/drainFlags.ts` — reworked flag semantics from a one-shot trigger into a
  live on/off switch: the drain flag now stays in place after handoff (not removed),
  and `runDrainFlags` clears any colony's `draining` the tick its flag disappears
  (fixed a real live bug: a removed flag used to leave the colony draining forever,
  only recoverable via the `clearDrainTarget` console command). **Important for
  whoever resumes this:** since a live flag now re-affirms/holds the drain every
  tick, `clearDrainTarget("W5N3")` (used to stop the squad for this handoff) only
  works because no drain flag currently exists on the server (verified via
  `Game.flags` — empty). If a flag named `drain`/`drain:W6N4` is ever placed on W5N3
  again, this logic will immediately re-hand the target off and the operation resumes
  on its own, no explicit re-trigger needed.
- `src/snapshot/colony.ts`, `src/snapshot/types.ts` — `SnapCreep.hits`/`hitsMax`
  (used by the HP gate), `ColonySnapshot.drainRoomTerrain` + `drainTerrainFor()`
- `test/fixtures.ts` — `hits`/`hitsMax` defaults on `snapCreep()`, `drainRoomTerrain: {}`
  default on `colonySnap()`
- `test/unit/operations/drain.test.ts` — new/updated tests for all 5 fixes
- `test/unit/roles/drainAttacker.test.ts`, `drainHealer.test.ts` — step-index updates
  (moveToRoom removed, everything shifted down by 1)
- `test/unit/roles/drainHealerFormationLatch.test.ts` — new file, 2 regression tests

**Not drain-related, pre-existing, do not touch as part of this work:**
`src/operations/logistics.ts`, `src/operations/upgrading.ts`, and their tests — a
link-network staleness fix unrelated to squad movement, already in the working tree
before this session.

## Suggested next steps for the redesign agent

1. Decide on the movement primitive first (conga-line/step-history vs. something
   else) before touching any code — this is the actual design question, not an
   implementation detail.
2. The 5 bug fixes above are orthogonal to the movement-model choice and are real
   fixes to real bugs (confirmed via `pserver-console.mjs` live observation each
   time) — keep them unless the redesign obsoletes the specific mechanism they patch
   (e.g. a conga-line model probably makes `standStill`/the `moveToPos` preemption
   moot, since there'd be no `heal` step racing `moveToPos` for primary-step status
   the same way).
3. Re-verify live on the pserver the same way this session did: `debug-local` skill,
   `pserver-console.mjs` to poll `Game.creeps` positions/`squadTargetPos`/`task.step`
   directly, watch convergence over multiple polls before declaring anything fixed.
   A single snapshot looking "tight" is not sufficient — this session had two false
   "looks fixed" moments that turned out to still be broken once watched over several
   ticks.
4. Once redesigned and verified, resume by placing a `drain` (or `drain:<room>`) flag
   in-game — `runDrainFlags` (`empire/drainFlags.ts`) picks it up automatically and
   hands the target off via `setDrainTarget`. No console command needed to start it;
   `clearDrainTarget("W5N3")` (used to stop it for this handoff) is the matching
   manual stop if a flag isn't in play. Re-check `Game.flags` before assuming the
   operation is idle — see the drainFlags.ts note above.
