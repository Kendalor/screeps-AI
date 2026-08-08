# Squad movement: cached CostMatrix + real PathFinder, decoupled facing, single-source anchor

**Status: DONE, uncommitted, branch `rewrite`.** All 4 steps implemented, plus the cross-room integration
suite. Independently verified 2026-08-08: unit suite 94 files / 1510 tests green (`npx vitest run`),
integration suite 4/4 green (`npx vitest run --config vitest.integration.config.ts
test/integration/drain-squad-border-crossing.test.ts`). Nothing outstanding on this plan.

## Context

Drain's squad (ADR 0007, `src/lib/squad.ts` + `src/lib/squadPath.ts` + `src/lib/formation.ts`) still loses
cohesion crossing room borders even after the prior session's stateful-membership fix (`CreepMemory.squadJoined`,
already coded uncommitted on this branch). Two root causes remain, both documented in
`docs/drain-squad-handoff.md`'s open issues:

1. **No caching, bespoke pathfinder.** `findSquadPath` ran a hand-rolled A* over an augmented
   `(x, y, room, facing)` state space from scratch every tick, per squad — never using Screeps'
   `PathFinder`, never caching anything. Expensive and, per the user, "solved elsewhere" — Overmind
   (a mature public Screeps bot, source read during planning) solves the identical problem with a **cached,
   per-room CostMatrix transformed by a moving-maximum filter**: rewrite every cell's cost to the max cost
   in the footprint-sized window anchored there, then run one ordinary `PathFinder.search` over it. A cell
   is only cheap if the *whole* footprint fits there — no separate footprint-fit search needed at all.
2. **Anchor room is still a majority vote, recomputed from scratch every tick** (`mostCommonRoom(joined)` in
   `operations/drain.ts`). Mid-crossing on a 2-2 split this can flip tick to tick, producing a garbled anchor
   (room from one member, x/y from another) — this is the actual "loses the squad at the border" symptom,
   independent of the pathing engine. Open issue #1 in the handoff. **Not yet fixed — see Step 4, not started.**

## Hard constraint, established after two rejected detours — READ THIS BEFORE CHANGING PATHING CODE

**No world-coordinate arithmetic anywhere in the squad movement system. Room-border transitions are
`PathFinder.search`'s job alone — never hand-rolled cross-room position math.**

Two earlier drafts of this plan violated this and were explicitly rejected by the user:

1. **First attempt**: fixing the anchor-room-vote bug (root cause #2 above) by making `SquadState.anchor` a
   bare world-coordinate pair (`{wx, wy}`, via `geometry.ts`'s `worldOf`/`roomAndLocal`). Rejected: world
   coordinates make two tiles that are numerically distance-1 apart (e.g. room A's x=49 and its real
   neighbor room B's x=0) *look* identical, in the arithmetic, to two tiles that are NOT real walkable
   neighbors (Screeps' room graph is not a uniform infinite grid — some rooms lack an exit on a given side,
   sector/highway boundaries break uniform adjacency). A uniform per-member world-space delta slide (which
   `planSquadMove`'s old straight-advance branch did, the deleted `anchorDelta` block) trusts the lattice to
   always mean "walkable neighbor," which the game does not actually guarantee everywhere.
2. **Second attempt**: after finding the moving-maximum matrix blocks EVERY border crossing (not just one
   direction — see "Investigation note" below) for a formation with any trailing offset, tried extending
   `squadCostMatrix.ts`'s `applyMovingMaximum` to peek across a room border via `worldOf`/`roomAndLocal` so a
   border-margin cell could see the neighboring room's terrain. Also rejected, same reason: no hand-rolled
   cross-room position math, full stop. **The fix is real integration tests against a real booted
   `PathFinder` (see Step 2/3's "Test strategy" below), not matrix engineering to route around the
   constraint.**

Re-reading Overmind's `Pathing.ts` source directly confirms this is also how the reference implementation
does it: `findSwarmPath` **never does cross-room arithmetic at all** — it builds a `CostMatrix` per room in
isolation and hands multi-room routing entirely to `PathFinder.search`'s own native per-room-exit stitching,
operating exclusively on real `RoomPosition` objects (`{x, y, roomName}`, Screeps' own type). There is no
"squad-level current room" computed anywhere in their code, because their anchor is always simply one
designated creep's own live `.pos` — nothing to vote on, nothing to slide with a delta, nothing to peek
across a border with.

**Investigation note (for context, not an open problem to re-solve):** `applyMovingMaximum` builds each
room's matrix using only that room's own terrain — a cell within the footprint's own width/height of the room
edge, where the footprint would need a tile in the neighboring room, is unconditionally marked impassable
(`0xff`). Traced concretely: for `BLOCK_2X2` (offsets trailing right/down from the anchor — Drain's actual
shape), the entire x=49 column is impassable in every room, for every y, in EITHER crossing direction (the
entry tile just past a border is itself within the same margin of the NEW room's edge). Checked directly
against Overmind's real `applyMovingMaximum` source: they have the identical gap (`x <= 50-width, y <=
50-height` loop bounds) — not a solved case being ported from, an unaddressed limitation in the technique
itself. **Given the hard constraint above, this is NOT fixed by matrix engineering** — it's addressed by
verifying real border-crossing behavior against a real `PathFinder` in integration tests, and by simplification
of the formation/anchor design if it turns out to matter in practice. Revisit only if real integration tests
show it's a genuine live blocker, and only via non-world-coordinate means (e.g. formation/anchor placement
choices) if so.

**Anchor bug fix (open issue #2), once reached**: `SquadState.anchor` stays a plain `{x, y, room}` — no type
change, no world-coordinate field. The fix is derive it from exactly ONE live creep's own reported position
every tick, never a cross-member aggregate/vote — a single creep's `{x, y, room}` can never internally
disagree with itself, closing the bug the same way Overmind's model does (their anchor is always one
designated creep's own `.pos`), without any cross-room arithmetic. See Step 4 below — not started yet.

User's explicit direction: adopt Overmind's proven pattern rather than continuing to patch the bespoke A*
bug-by-bug; drop **facing from pathing** for now (2x2/1x2 formations only for the foreseeable future — facing
is not a pathing concern at this size) but **keep facing as an independent concept** for a later feature
(retreat-while-facing-forward); fix the anchor bug **at its root** — "derive from one real creep, never vote
across several," never via world coordinates.

This is a graft onto a working, well-tested system (6+ squad test files drive the real production code against
`test/unit/behaviors/creepBehavior/squadWorld.ts`), not a rewrite. Each step should land independently,
matching this codebase's established one-fix-one-regression-test pattern (see the handoff's numbered bug list).

## Existing conventions to reuse (do not reinvent)

- **Per-room CostMatrix caching already exists**: `src/lib/traveler.ts:450` `Traveler.getStructureMatrix(room,
  freshMatrix?)` — a static `{[roomName]: CostMatrix}` cache, busted via a `freshMatrix` flag + tick check.
  `getCreepMatrix` (`traveler.ts:460`) layers a 1-tick creep cache on top by cloning the structure matrix.
  The new squad-shape cache (`squadCostMatrix.ts`) is modeled on this shape, not on Overmind's `$.costMatrix`
  helper (which doesn't exist in this codebase) or a new abstraction.
- **Real `PathFinder.search` with a custom `roomCallback`**: `src/lib/remotePath.ts`'s `findRemotePath` is
  this codebase's existing convention (plain function, `PathFinder.CostMatrix`, explicit `plainCost`/
  `swampCost`/`maxRooms` options). `squadPath.ts`'s rewritten `findSquadPath` matches this style, not a new
  PathFinder wrapper class. `traveler.ts:469` `addStructuresToMatrix`/`addCreepsToMatrix` show the
  structure-cost convention (walls/impassable structures = `0xff`, roads cheaper, containers = 5).
- **Vision-independent terrain, vision-gated occupancy**: `src/snapshot/colony.ts`'s `drainRoomTerrain`
  (`Game.map.getRoomTerrain`, no vision needed) / `drainRoomOccupancy` (vision-gated, live creeps +
  `OBSTACLE_OBJECT_TYPES`) — the squad CostMatrix cache folds these two into ONE matrix per room per
  formation-shape (they stay as the snapshot-level data source feeding the matrix builder, not removed).

---

## Current state — what's actually implemented on disk right now

### DONE — Step 1: cached, moving-maximum squad CostMatrix

New file `src/lib/squadCostMatrix.ts`, room-local only (no cross-room lookups, per the hard constraint
above):

- `footprintSize(formation)` — pure bounding-box geometry over a `Formation`'s slot offsets.
- `getSquadMatrix(room, formation, terrain, occupancy, now)` — the cached, moving-maximum-transformed
  `CostMatrix`. Cache key is `${room}:${width}x${height}` (a plain module-level `Map`, TTL 20 ticks, mirrors
  `Traveler.getStructureMatrix`'s cache shape). `applyMovingMaximum` treats any window that overflows the
  room's own 50x50 grid as impassable — deliberately room-local, matching Overmind's actual behavior exactly
  (see the hard constraint above for why this is correct, not a shortcut).
- `clearSquadMatrixCache()` — test-only cache reset.

Tests: `test/unit/lib/squadCostMatrix.test.ts`, 10 tests, **all green**: footprint-size geometry, wall/occupancy
blocking, room-edge fail-closed behavior (room-local only, confirmed no cross-room peeking), TTL cache
hit/rebuild, cache-key isolation by shape and room. Confirmed via `npx vitest run
test/unit/lib/squadCostMatrix.test.ts` — 10/10 passing, and confirmed additive (full suite was 1513/1513
passing immediately after this step, before Steps 2/3 touched anything else).

### DONE — Step 2+3 (merged): PathFinder.search + facing decoupled

Steps 2 ("swap `findSquadPath`'s internals to `PathFinder.search`") and 3 ("decouple facing from pathing")
turned out to be inseparable at the type level once actually implemented: once the moving-maximum matrix has
a single fixed orientation (no facing search), `nearestFittingAnchor`'s old `preferredFacing` parameter and
`{anchor, facing}` return value have nothing left to mean. Merged into one change.

**What's changed so far:**

- `src/lib/squadPath.ts` — REWRITTEN. `findSquadPath`/`nearestFittingAnchor` now call real `PathFinder.search`
  over `getSquadMatrix` via a `roomCallback` (matching `remotePath.ts`'s convention), not the old bespoke A*.
  `nearestFittingAnchor`'s signature changed: drops `preferredFacing`, returns a plain `SquadAnchor` (not
  `{anchor, facing}`) — facing is a pass-through-only concept now, never searched. Both functions take a new
  `now: number` parameter (threaded to `getSquadMatrix`'s cache), matching `remotePath.ts`'s
  no-direct-Game.time-read convention.
- `src/lib/squad.ts` — `planSquadMove` updated to call the new signatures and pass `now`. The old
  `anchorDelta`/`worldOf`-based rigid-body slide (the straight-advance branch's per-member uniform
  world-coordinate delta — exactly the mechanism the hard constraint above forbids) is DELETED, replaced by
  re-deriving every slot fresh via `slotTiles(nextAnchor, state.facing, formation)` — a single-shot per-slot
  placement from the new anchor, not an aggregate delta applied across members. The now-dead
  `assignMembersToSlotIndices` helper (only existed to support the deleted delta-slide) was removed.
- `src/empire/creeps.ts` — `runSquads`/`logSquadDecision` updated to pass `Game.time` (the real Game-coupled
  boundary, appropriate direct read) and to match `nearestFittingAnchor`'s new return shape.

**Two additional real bugs found and fixed while making the test suite green** (neither was anticipated by
the original plan — both are genuine defects the switch to real `PathFinder.search` exposed, not test
artifacts):

1. **Advance branch reassigned members by nearest-distance, not formation-slot index.** `planSquadMove`'s
   straight-advance branch (`src/lib/squad.ts`) re-derived `nextSlots` from the new anchor and handed them to
   `reformOnto`'s greedy nearest-distance match — correct for reform (role-blind on purpose, see its own
   doc), but wrong for advance: a **diagonal** step (real `PathFinder.search` routes diagonally with no cost
   penalty, unlike the old bespoke A*) shifts a 2x2's slot set by one tile on BOTH axes, so a trailing
   member's OLD tile can coincide with a DIFFERENT (nearer, but wrong) NEW slot — nearest-distance then
   awards it that slot, leaving the attacker in place and mirroring the rest of the formation instead of
   actually advancing. Confirmed via `squadEvasion.test.ts`'s wall/bystander detours, which route diagonally
   and never made progress under the old match. **Fix:** new `advanceOnto` (`squad.ts`) matches each member
   to `nextSlots[i]` at the SAME index it currently occupies in `currentSlots` — unambiguous once
   `inFormation` has already confirmed every member sits on some `currentSlots[i]`.
2. **`applyMovingMaximum` ignored the formation's anchor-slot offset within its own bounding box.**
   `squadCostMatrix.ts`'s moving-maximum window always treated cell `(x,y)` as the box's TOP-LEFT corner —
   correct for `DRAIN_FORMATION`'s canonical shape (`dx,dy ∈ {0,1}`, anchor already at the top-left), but
   WRONG for any ROTATED formation whose anchor sits at a different corner (e.g. BOTTOM-facing negates
   dx/dy, putting the anchor at the box's bottom-right) — the fit-check silently checked the wrong region of
   the grid entirely, once even reporting a tile as "fitting" that was actually a wall. Confirmed live via
   `squadReformDeadlock.test.ts`'s BOTTOM-facing repro (the exact live pserver incident this test encodes).
   **Fix:** `applyMovingMaximum` now takes `anchorDx`/`anchorDy` (`footprintSize`'s own, previously-unused
   fields) and shifts the window accordingly; `getSquadMatrix`'s cache key now includes them (two formations
   with the same bounding box but a different anchor offset — i.e. different facings — need different
   matrices, so sharing a cache entry by `(width,height)` alone was also wrong). New `rotateFormation`
   (`formation.ts`) lets callers (`squad.ts`, `empire/creeps.ts`'s debug log) hand `nearestFittingAnchor`/
   `findSquadPath` a formation already expressed at the CURRENT facing, rather than the raw canonical-TOP
   shape those functions were previously silently checking regardless of the caller's actual facing.

Test-file updates (all landed, unit suite green — 93 files / 1505 tests): `squadPath.test.ts` rewritten
facing-free at the unit level, using a NEW real single-room Dijkstra `PathFinder.search` stub
(`stubPathFinderSingleRoom`, `test/constants.ts`) — a genuine engine-behavior shim in the same spirit as that
file's existing `RoomPositionStub`, not a production-logic stand-in: it walks whatever `CostMatrix` the code
under test already builds, exactly like the real engine would within one room, but NEVER stitches across a
room border itself (throws loudly if asked to). `squad.test.ts`, `squadLockstep.test.ts`,
`drain.test.ts`/`drainThreatFacing.test.ts`/`drainHealerFormationLatch.test.ts`, and the single-room
`creepBehavior` suite (`squadFormation`, `squadMovement`, `squadEvasion`, `squadReformDeadlock`) all updated
to the new signatures (`now` param) and this stub.

### DONE — Step 4: anchor derived from one real creep, never a cross-member vote

Fixes root cause #2 (open issue #1 in the handoff) — the actual "loses the squad at the border" bug.
`operations/drain.ts`:

- `anchorTile()` no longer takes a `room` parameter — it derives `x`, `y`, AND `room` from the SAME reference
  creep's SAME snapshot read (the attacker when alive; a deterministically-chosen surviving healer, minus its
  slot offset, in the degraded case), so the three fields can never internally disagree. The no-squad
  fallback that used to silently return `{25,25,room}` now throws instead — `squadState` already guards
  against calling this on an empty squad, so a silent fabricated default would only mask a caller bug.
- `squadState()` reordered: a `threatLookupRoom` (still `mostCommonRoom`-derived — see below) is computed
  ONLY to pick which room's threat list to consult for facing selection, never fed into the anchor itself.
  `anchor` is computed once, from `anchorTile()` alone, and every downstream reader (`planDrainActions`'s
  `hostileRoomTowers` lookup, the debug log line) reads `state.anchor.room`/`anchor.room` directly rather
  than a separately-threaded variable.
- `mostCommonRoom` is NOT deleted (its two remaining callers — the threat-lookup room above, and the
  re-entry join-radius gate's reference room — are genuinely lower-stakes reads that tolerate an occasional
  wrong guess without corrupting anything, unlike the anchor itself) — its doc comment now explains why it's
  no longer anchor-deriving and what its remaining scope actually is.

Regression test (`test/unit/operations/drain.test.ts`, "Drain.squadState border-straddle stability" describe
block): the EXACT handoff scenario — an attacker that has crossed a border alone (`x/y` genuinely in the new
room) while the other 3 members are still in the old room. Confirmed would-have-failed before the fix
(temporarily reverted `anchorTile`'s call site in isolation to a `mostCommonRoom`-voted room and reran —
failed with the exact nonsensical hybrid anchor the handoff describes, `{x:0,y:25,room:'W2N1'}` where `(0,25)`
is actually the attacker's real position in the OTHER room). A second test extends the existing array-order
2-2-split case to also assert the anchor itself (not just member count) is byte-identical across orderings.

### DONE — cross-room integration test suite, plus two more real bugs it found

The unit-level `squadBorderCrossing.test.ts`/`squadStagingLifecycle.test.ts` (drove `planSquadMove` across a
REAL room border via the `SquadWorld` harness) and `drain.test.ts`'s "crosses a room border end to end..."
test were DELETED rather than updated to the new signatures — `stubPathFinderSingleRoom` deliberately cannot
validate real cross-room `PathFinder` stitching (it throws if origin/goal land in different rooms), and
faking that stitching by hand in test code would be exactly the "hand-rolled cross-room position math" the
hard constraint bans, just relocated into test infrastructure instead of production code. Per explicit user
decision, these were rewritten as real integration tests: `test/integration/drain-squad-border-crossing.test.ts`,
driving the actual bundled bot inside `screeps-server-mockup` (a genuine engine `PathFinder`), 4 tests, all
green.

Building/extending this suite found two more real, structural bugs — both fixed, full write-up in the test
file's own header comment:

1. **The moving-maximum matrix made every border crossing structurally impossible, in every facing.**
   `applyMovingMaximum`'s room-edge-overflow case (a footprint window needing a tile past the room's own
   50x50 grid) was priced `IMPASSABLE` — and since `DRAIN_FORMATION`'s shape doesn't rotate mid-route, this
   blocks the SAME edge on both sides of every crossing, for all 4 of the formation's valid facings. Confirmed
   live against the real engine before the fix. **User's explicit direction, after pushing back on treating
   this as an accepted correctness gap ("What does blocked mean? Cost infinite? It should only be expensive
   50+"):** price the overflow at a high-but-finite `ROOM_EDGE_OVERFLOW_COST = 50` instead of `IMPASSABLE`,
   justified by the real Screeps engine guarantee that an exit tile always opens onto walkable ground at least
   a tile or two into the neighboring room — PathFinder only reaches for the edge as a last resort, but is no
   longer structurally forbidden from crossing. `src/lib/squadCostMatrix.ts`; a real wall sharing the same
   window still wins the max over any overflow cell (`squadCostMatrix.test.ts`'s dedicated test for this).
2. **Natural Source/Mineral tiles weren't marked occupied.** `snapshot/colony.ts`'s `drainOccupancyFor` only
   scanned `FIND_STRUCTURES` for `OBSTACLE_OBJECT_TYPES` members — Source/Mineral are obstacle-type in the
   real engine but are NOT Structures, so a source sitting in the formation's advance path read as free
   ground to the pathfinder. The real engine then silently rejected just the one member routed onto it
   (`checkObstacleAtXY`) while its squadmates' moves succeeded, breaking mutual-range-1 for a tick even though
   `planSquadMove`'s plan was objectively correct given its (incomplete) input. Fixed by also scanning
   `FIND_SOURCES`/`FIND_MINERALS`; function exported for direct unit testing
   (`test/unit/snapshot/colony.test.ts`, 4 tests, confirmed fail-before/pass-after via git-stash).

A third, separate phenomenon surfaced once both fixes above let a squad actually complete a crossing: the
real engine relocates any creep landing on a room-edge tile into the neighboring room INSTANTLY, per creep,
same tick — with no way for a bot script to move several independently-simulated creep objects across a
border atomically. A 2-tile-wide footprint therefore always straddles two rooms for a handful of ticks while
genuinely crossing, self-healing via the existing reform mechanism. This is **not a bug** (fixing it would
require either violating the hard constraint or fragile heuristics with no generality) — the integration
suite's assertions tolerate this as a bounded (≤12-tick) transient split rather than requiring zero-tolerance
tightness every tick, while still failing on a genuine indefinite/growing split. See
`CROSSING_SPLIT_TOLERANCE` in the test file for the full mechanism write-up.

## Verification — done, 2026-08-08

- `npx vitest run` (unit): **94 files / 1510 tests, all green.**
- `npx vitest run --config vitest.integration.config.ts test/integration/drain-squad-border-crossing.test.ts`:
  **4/4 green.**
- Diffs to `src/snapshot/colony.ts` and the new `test/unit/snapshot/colony.test.ts` reviewed directly (not
  just taken on a background agent's word) — both sound, minimal, consistent with existing conventions.

Not done (optional follow-up, not required by the plan itself):
- Live `debug-local`/`debug-main` pserver observation of an actual border crossing — the original handoff bug
  was found by live observation, not unit tests alone, so this would close that loop, but the integration
  suite now provides equivalent real-engine coverage.
- CPU sanity check comparing `findSquadPath`'s profiled cost before/after versus the deleted bespoke A*.
