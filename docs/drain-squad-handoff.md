# Handoff: Drain squad movement — ADR 0007 is implemented, but border-crossing surfaced 7 bugs

**Status: ADR 0007's squad redesign is implemented and live on the pserver.** This supersedes the
original version of this handoff (below the fold, kept for history), which described the
pre-redesign per-creep-Traveler squad as stuck and recommended the redesign that became
[ADR 0007](adr/0007-squad-movement.md). That redesign — `lib/squad.ts` (the generic `Squad` entity),
`lib/formation.ts` (formation-as-data), `lib/squadPath.ts` (footprint-fit route search) — is now built,
tested, and driving `operations/drain.ts` in production. **This session's work was watching that
implementation cross a real room border live and fixing what broke.**

## What's fixed (7 bugs, all shipped)

All confirmed via live pserver observation (`debug-local` skill, `debugColony("W5N3")` +
`pserver-console.mjs`), each with a regression test that fails without its fix. Full suite green except
2 pre-existing unrelated failures in `test/unit/interpreter.test.ts` (confirmed present before this
session — upgrader container-step assertions). **Nothing committed to git yet** — everything below is
uncommitted on branch `rewrite`.

1. **`moveToRoom` border oscillation** — [`interpreter.ts`](../src/behaviors/interpreter.ts)'s
   `moveToRoom` reported "arrived" the instant `creep.room.name === dest`, even while the creep was
   still standing exactly on the new room's border tile (x/y 0 or 49). A creep that doesn't explicitly
   move off an edge tile gets nudged back into the room it came from by the engine itself — so it
   never actually walked further in, got shoved back next tick, crossed again, forever. **Fix:**
   arrival now also requires `creep.pos.x/y` clear of 0/49. Regression test: "keeps traveling if
   standing in the target room but still on its border tile."

2. **`heal` step permanently locks out its own `moveToRoom`** — `heal`/`attack` are `STEP_KIND: "move"`
   ([interpreter.ts](../src/behaviors/interpreter.ts)), which per `isComplete` never self-completes
   except via `targetGone`. But `find:"squadMate"` always resolves to *something* (self included), so
   a `DrainHealer` that ever landed on its `heal` step (even healing itself at full HP) could never
   fall back to `moveToRoom` again — permanently parked. **Fix:** `healStep` now always calls
   `travelTo` toward its resolved target, in range or not (mirrors `attackStep`'s existing
   move-and-act-together kiting). Regression test: "melee-heals ... and still travels toward it."

3. **Room-name rally can't converge on a moving squad** — `DrainAttacker`/`DrainHealer` rallied via
   `moveToRoom` + `attackTargetRoom` (a room *name*). Two stragglers each independently converging on
   "whichever room the OTHER one currently stands in" chased each other back and forth across a border
   forever, since each one's destination flipped the instant its target crossed (confirmed live: two
   healers swapping `W5N3<->W6N3` every tick, one-tick out of phase). **Fix:** new `moveToPos` step
   (`behaviors/types.ts`) + `CreepMemory.drainRallyPos` (`memory/schema.ts`), a real live tile —
   `Drain.intents()` now computes it as the squad's actual anchor tile once one exists, else the
   staging room's center. `setDrainRallyPos` intent (`intents/types.ts`/`execute.ts`) writes it.
   **User-directed:** *"moveToPos should be the only way anything but a scout ever rallies — moveToRoom
   is soley usable by scouts."* Only Drain was converted this session (scope explicitly limited to
   Drain — see Open Issues). Regression tests: `test/unit/interpreter.test.ts`'s new `moveToPos`
   describe block; `drain.test.ts`'s "steers every unsquadded member toward the staging room's center."

4. **Squad stuck reforming onto a position that can't fit** — `planSquadMove`'s not-tight branch
   always retargeted the squad's *current* anchor/facing slots, with no escape if that shape couldn't
   fit anywhere (a corridor too narrow for the 2x2 in any orientation). Confirmed live: a squad walked
   (via step-table bugs #1/#2, before ever coming under squad control) into a diagonal one-tile-wide
   staircase corridor where no 2x2 orientation fits — `inFormation` false forever, reform target
   unreachable forever. **User-directed:** *"the squad should be aware that its in a position the
   formation does not fit... the formation should move to make itself able to form."* **Fix:** new
   `nearestFittingAnchor` search in [`squadPath.ts`](../src/lib/squadPath.ts) (BFS outward by Chebyshev
   ring, trying all facings at each tile); `planSquadMove` uses it when the current anchor/facing
   doesn't fit. Regression test: "retargets the reform onto the nearest fitting anchor when the CURRENT
   anchor/facing fits nowhere."

5. **Fatigue never gated the advance** — a fatigued creep's `move()` silently no-ops that tick (no
   error, no other signal), but `SnapCreep`/`planSquadMove` had no notion of fatigue at all — a
   straight-advance could commit the whole formation to slide forward while a fatigued member
   physically couldn't, re-splitting the "welded" block under a new mechanism. **User-directed:** *"a
   squad must wait for fatigue of all members to be 0 to be able to move as a squad."* **Fix:**
   `SnapCreep.fatigue` added (`snapshot/types.ts` + populated in `snapshot/colony.ts`); `planSquadMove`
   holds at current slots (never advances) while any member's fatigue is nonzero. Regression tests:
   "holds at current slots... when the block is tight but a member is fatigued" /
   "advances normally once every member's fatigue clears."

6. **Stated facing didn't match the squad's real shape** — `Drain.squadState()` recomputed `facing`
   fresh every tick purely from goal *direction* (`drainFacing`), with zero regard for what facing the
   squad's actual live positions already corresponded to. A squad that settled into a tight TOP-facing
   2x2 (from wherever stragglers happened to converge) but whose goal lay roughly west would be
   stamped `facing=LEFT` every tick regardless — `inFormation` (checked against that *stated* facing)
   reported "not tight" forever, even though the block was genuinely welded, just at a different
   facing than claimed. Confirmed live: `runSquads` logging the identical reform-in-place move intent
   for 15+ consecutive ticks. **User-directed:** *"It should know its current facing, to be able to
   plan the steps necessary to get into the desired facing."* **Fix:** new `currentFacing()` in
   `operations/drain.ts` — tries the 4 axis-aligned facings against the squad's LIVE positions first;
   only falls back to the goal-directed `desiredFacing` if none fit. `findSquadPath`'s existing
   reform-edge search (built for exactly this) now gets a chance to actually run and plan the turn.
   Regression test: "reports the squad's REAL current facing, not the goal-directed one, when the two
   disagree."

7. **Cross-border slot placement crashed the whole tick** — [`formation.ts`](../src/lib/formation.ts)'s
   `slotTiles` computed each slot as `anchor.x + dx` in pure **local** room coordinates, always
   stamping the anchor's own room. With the anchor at `x=49` (the room's edge) and a trailing slot's
   `+1` offset, this produced `x=50` — `RoomPosition`'s constructor throws on out-of-range x/y, which
   crashed `runSquads` → `runCreepBehaviors` → the entire tick's creep loop, every tick, for every
   creep in the empire, not just the squad. **Fix:** moved the world-coordinate lattice
   (`worldOf`/`roomAndLocal`, previously squadPath.ts-only) to [`geometry.ts`](../src/lib/geometry.ts)
   as shared infrastructure; `slotTiles` now resolves through it, so a slot crossing a border lands in
   the neighboring room's real local coordinates instead of overflowing. Regression test: "resolves a
   slot that crosses a room border into the NEIGHBORING room's local coords, never x/y outside 0..49."

## Debug logging added (toggleable, silent by default)

Three new `log.debugRoom` call sites, gated the same way every other `debugColony` trace already is —
`debugColony("W5N3")` turns them on, `resetDebug()`/`clearDebug()` turns them off, silent otherwise:

- `Drain.squadState()` — `readyForFirstPush`/`underway`/`anchorRoom`/`anchor`/`facing`/`desiredFacing`/
  `goal`/full squad+members list.
- `Drain.goalTile()` — `fullyHealed`/`safe`/`nextStep`/tower count/which aim was picked.
- `empire/creeps.ts`'s `runSquads()` — per squad per tick: `anchor`/`facing`/`goal`/whether tight/which
  `planSquadMove` branch fired (`tight-advance-or-hold` / `reform@current` /
  `reform@nearestFit(...)` / `reform@current(NO-FIT-FOUND-within-radius)`)/every member's actual move
  intent.

These were essential for diagnosing bugs #4–#7 above — a raw position dump alone couldn't distinguish
"holding because not tight" from "holding because the plan is stale" from "holding because fatigued."
Worth keeping permanently, not just for this session.

## Open issues (not yet fixed)

1. **`anchorTile()` can combine mismatched room + local coordinates.** `Drain.anchorTile()`
   (`operations/drain.ts`) returns `{x: attacker.x, y: attacker.y, room}` where `room` is a *separately
   computed* `anchorRoom` (`mostCommonRoom(squad)` — a majority vote across all members, not derived
   from the attacker itself). If the attacker is the member that has just crossed a border alone
   (other members haven't followed yet), `attacker.x/y` are its real local coordinates in its *new*
   room, but `anchorRoom` still reflects the *old* room (still held by the other 3) — producing a
   nonsensical anchor like `{x:0, y:8, room:"W6N3"}` where `(0,8)` is actually the attacker's position
   in `W5N3`, not `W6N3`. Observed once live (attacker jumped `W6N3(49,8)` → `W5N3(0,8)` while the
   logged `anchorRoom` stayed `W6N3`); appeared to self-correct the following tick (the attacker
   rejoined `W6N3` on its own), but this was not a controlled reproduction — the failure mode (a
   permanently split squad with a garbled anchor) has not been ruled out. **Needs:** either derive
   `anchorRoom` from the attacker's own room when the attacker is alive (not a majority vote), or
   detect the mismatch and hold/reform rather than trusting a hybrid anchor.

2. **Squad-vs-bystander-creep tile occupancy is still unhandled** (this is a *known*, ADR-0007-scoped
   gap, not new — see the ADR's "Consequences" section, but re-confirmed live and worth flagging
   again given how directly it bit this session). `nearestFittingAnchor`/`planSquadMove` only check
   **terrain** — a fit that's terrain-valid but currently occupied by a non-squad creep is still
   treated as reachable. Confirmed live: a `defender` (unrelated `Defense` operation) sat parked on
   exactly the drain squad's 4th formation-slot tile — genuinely stuck itself, on the *same*
   never-completes-on-heal/attack step-table bug class (#2 above), just for `Defender`'s `attack` step
   this time (no hostile in the room, so `attack` never resolves a target, so it never advances past
   step 1) — and the drain squad walked up to it and parked forever, since Screeps only swaps two
   creeps' tiles when *both* explicitly `move()` this tick, and a permanently-frozen bystander never
   does. **Two independent gaps here, deliberately scoped out of this session:**
   - `Defender`'s step table has the exact same `attack`-never-completes-with-no-target defect
     `DrainHealer` had (bug #2) — needs the same fix, or a more general fix in `interpreter.ts`'s
     `isComplete` (a "no target resolved at all" completion case for move-kind steps), scoped to
     **every** role sharing this step-table shape, not just Drain's.
   - `planSquadMove`/`nearestFittingAnchor` have no occupancy awareness at all — a fix here needs to
     decide whether "occupied by a live, non-squad creep" should exclude a tile from fit-checking, and
     if so, whether that's cheap enough to check per-candidate during the BFS/A* searches without
     real Game access (both are pure functions today — occupancy would need to come in via the
     `TerrainSource`-shaped input, not a live `Game.rooms[...].lookForAt` call).

3. **`moveToPos`/`drainRallyPos` was scoped to Drain only.** The user's stated intent — *"moveToRoom
   is soley usable by scouts, nothing else"* — is broader than what shipped: `Defender`, `Attacker`
   (`operations/defense.ts`/`attack.ts`), and any other room-rallying role still use
   `moveToRoom`+`<x>TargetRoom`. Converting them to the same `moveToPos` pattern is a real follow-up,
   not done here (explicitly deferred — see the "Drain only, for now" scoping decision mid-session).

## Proposed: an integration test suite for squad border-crossing

The user's ask: build this out as an integration suite (not just the existing unit tests), covering
both the edge cases found this session and ones not yet found. The existing harness
(`test/integration/harness.ts`, `BootedColony` — boots the real bundled bot on
`screeps-server-mockup`, seeds a colony via `seed.ts`, runs real ticks) is the right foundation; see
`scouting.test.ts` for the pattern (seed a colony, place a creep directly via `addCreep` carrying the
right `op` stamp so the operation claims and drives it exactly like a spawned one, run ticks, assert on
`Memory`/positions). A `drain-squad.test.ts` in this style would:

- Seed a colony (RCL3+, so `Drain`'s spawn requests aren't competing with bootstrap) with `draining` set
  and a `drainRoute` crossing at least one border.
- Place a 4-creep squad (1 `drainAttacker` + 3 `drainHealer`, `op: "drain:<home>"`) via `addCreep`,
  positioned to force the specific edge case under test.
- Run N ticks, then assert convergence: squad ends up tight, in one room, past the border, advancing
  toward `draining` — not frozen, not oscillating, not split.

Concrete cases worth covering (bugs #1–#7 above, each as a would-have-failed-before-the-fix scenario):

- **Border oscillation**: seed a lone straggler standing exactly on a border tile with `attackTargetRoom`
  set to the far side; assert it's fully inside the new room (not on the edge) within a few ticks, not
  bouncing.
- **Heal-lock**: seed a straggler with a nearby squadmate (or itself, at full HP) as its only heal
  target, far from the rally point; assert it still closes distance instead of parking.
- **Formation-fit trap**: seed a tight squad in geometry (terrain) that can't fit any orientation of the
  2x2 (a narrow diagonal corridor, built via `harness.ts`'s `TerrainMatrix`); assert it walks clear of
  the trap rather than holding forever.
- **Fatigue**: seed one member on swamp terrain (or with a body whose MOVE ratio guarantees fatigue);
  assert the whole squad holds position while fatigued, then advances together once clear.
- **Facing mismatch**: seed a squad already tight at one facing with a goal implying a different one;
  assert it's recognized as tight (not held "not-in-formation" forever) and the reform-to-new-facing
  actually executes.
- **Cross-border slot overflow**: seed a tight squad with its anchor exactly on x=49 or y=49; assert no
  exception is thrown and every member ends up on a valid in-bounds tile.
- **Bystander occupancy** (open issue #2 above, once that gap is actually fixed): seed a stationary
  foreign creep on one of the squad's formation-slot tiles; assert the squad routes around it rather
  than parking indefinitely.
- **Mismatched anchor room** (open issue #1 above, once fixed): seed a squad split exactly one member
  into the new room, others still in the old one; assert `squadState`/the anchor stay coherent rather
  than producing a hybrid position.

Not yet found but worth deliberately fuzzing for, given how many of the 7 bugs above only surfaced from
watching a live, uncontrolled colony rather than from unit tests with hand-picked inputs: multi-hop
routes (3+ room borders in one drainRoute), a squad member dying mid-crossing (replacement re-entry
interacting with an in-progress border transition), and reform triggered while straddling a border (a
facing change whose slot tiles span two rooms).

---

## Original handoff (superseded — kept for history)

*Everything below this line is the pre-ADR-0007 handoff, written when the redesign was decided but not
yet implemented. It's stale — the redesign it describes is now built (see above) — but kept verbatim
since it documents the original diagnosis that led to ADR 0007's decisions and is still useful context
for why the generic `Squad` entity is shaped the way it is.*

**Redesign decided:** see [ADR 0007](adr/0007-squad-movement.md) (design discussion in
[squad-movement-design.md](squad-movement-design.md)) — a general `Squad` entity computing one
route/plan for the whole formation, replacing the per-creep independent Traveler convergence this
handoff diagnosed below. Not yet implemented.

### Current live state (pserver, tick ~122714)

`clearDrainTarget("W5N3")` was run in-console — `Memory.colonies["W5N3"].draining` is
cleared, so the `Drain` operation no longer attaches and no new drain creeps spawn.
3 leftover squad creeps (`drainAttacker_W5N3_122009`, `drainHealer_W5N3_122095`,
`drainHealer_W5N3_122520`) are still alive but orphaned (no operation drives them) —
left to die of old age, not killed. **The operation is stopped, not deleted.** All the
code below is still in the tree, uncommitted, on branch `rewrite`.

### Why it's stopped: the squad never reliably reached the target room

Across one debugging session I fixed five real, confirmed-live bugs (see "Fixed this
session" below) and the squad went from "frozen in place forever" to "moving, but
badly uncoordinated" — advancing roughly 1 tile per 10-15 ticks, healers drifting
ahead of the leader, formation oscillating in and out every tick. The user's read,
which matches what I was seeing: **the underlying movement model is wrong, not just
buggy** — patching it further is not going to converge. This handoff is for a
redesign, not another patch pass.

### Root design problem

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

**Note: this recommendation was superseded.** ADR 0007 chose a single-plan generic
`Squad` entity instead of the conga-line model floated here — see the ADR for why.

### Fixed in the original (pre-ADR-0007) session

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
   earlier step to fall behind on. (Superseded by ADR 0007's real `moveToPos` +
   `drainRallyPos` — see above; this old `squadTargetPos` field no longer exists.)

2. **No formation enforcement at all — leader advanced regardless of stragglers.**
   Added an `inFormation` gate in `drain.ts`: leader only takes its next
   advance/retreat step once every follower is confirmed within Chebyshev range 1 of
   it (same room). Otherwise it holds at its own current tile. (Superseded by the
   generic `Squad`'s own `inFormation` check, `lib/squad.ts`.)

3. **`advanceIsSafe` only ever checked one tile of *projected* damage, never
   accumulated damage already taken.** Added a `fullyHealed` gate: won't advance
   again until every squad member is back to full HP (retreat/hold are never gated,
   only advance). (Still live today — see `Drain.goalTile()`.)

4. **Formation offsets were purely geometric, no terrain awareness.** A follower could
   be assigned a wall tile it could never physically reach, freezing the squad forever
   against the (correctly working) `inFormation` gate. Added `ColonySnapshot.drainRoomTerrain`
   (vision-independent — `Game.map.getRoomTerrain` works for any room name) and
   `walkableOrientation()` in `drain.ts`, which validates the whole candidate 2×2 block
   against all 4 possible orientations before committing, falling back to holding if
   none work. (Superseded by `findSquadPath`'s full-footprint route search,
   `lib/squadPath.ts` — still uses the same `drainRoomTerrain` data source.)

5. **`heal`/`attack` steps could silently steal "primary step" status from `moveToPos`
   forever.** Added `Step.standStill` and an explicit preemption in `empire/creeps.ts`'s
   `runOne` (`creepAwayFromSquadTargetPos`/`runMoveToPos`). **Both were deleted outright
   by ADR 0007** — squadded movement no longer goes through the step table at all, so
   there's nothing left for them to referee. (This session's bug #2 above is the SAME
   underlying defect resurfacing in the *unsquadded* step table, which ADR 0007 didn't
   touch — `standStill` was never re-solved there, just assumed away.)
