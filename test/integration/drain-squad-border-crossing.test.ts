// Real-engine replacement for three deleted unit-level squad tests (see
// docs/squad-movement-cached-pathfinder-plan.md's "hard constraint": no hand-rolled cross-room position
// math anywhere in squad movement, so cross-room routing can only be validated against a REAL engine
// PathFinder, not a single-room BFS test double). This drives the actual bundled bot (bundleBot(), same
// convention as scouting.test.ts) inside screeps-server-mockup, so `Drain`'s squad genuinely runs under
// production `planSquadMove`/`findSquadPath`/`Drain.squadState` — no test-only fixture bot, no internal
// function calls asserted on, only observable world state (colony.roomObjects()/memory()).
//
// Deleted originals (git show HEAD:<path> to read the old content in full):
//   - test/unit/behaviors/creepBehavior/squadBorderCrossing.test.ts
//   - test/unit/behaviors/creepBehavior/squadStagingLifecycle.test.ts
//   - test/unit/operations/drain.test.ts's "crosses a room border end to end without ever flickering
//     members in/out of the plan tick to tick"
//
// *** TWO genuine production limitations were found (and both FIXED) while building/extending this file.
// Kept here for history: ***
//
// 1. DRAIN_FORMATION (src/operations/drain.ts) is a strict 2x2 whose three healer slots trail the attacker
//    anchor at (+1,0)/(0,+1)/(+1,+1). squadCostMatrix.ts's moving-maximum transform (docs plan's Step 1)
//    USED TO mark a room's own x=49 column (or y=49 row) unconditionally IMPASSABLE for ANY facing whose
//    footprint trails in that direction, in EVERY facing DRAIN_FORMATION can take (rotateOffset in
//    formation.ts) — since the shape doesn't change mid-route, the SAME edge is blocked in both the room
//    being left and the room being entered, so a strict 2x2 with this trailing-corner shape could never
//    cross ANY room border, in ANY facing. Confirmed empirically here against the real engine PathFinder
//    before the fix (two independent directions), matching the plan doc's own "Investigation note"
//    prediction for a formation "with any trailing offset." FIXED in squadCostMatrix.ts: the room-edge-
//    overflow case now costs ROOM_EDGE_OVERFLOW_COST (a high-but-finite cost) instead of IMPASSABLE —
//    relying on the real Screeps engine guarantee that an exit tile always opens onto walkable ground at
//    least a tile or two into the neighboring room, so PathFinder only reaches for the edge as a last
//    resort but is no longer structurally forbidden from crossing.
// 2. Once (1) was fixed, the squad could approach a border but froze one tile short: a formation slot kept
//    landing on the STAGING room's own natural Source tile (a coincidence of this test's chosen seed
//    position), which is genuinely impassable in the real engine (Source is in OBSTACLE_OBJECT_TYPES) but
//    isn't a Structure — snapshot/colony.ts's drainOccupancyFor only scanned FIND_STRUCTURES for
//    OBSTACLE_OBJECT_TYPES members, so a natural Source/Mineral never got marked occupied, and
//    findSquadPath happily routed a slot onto it. The real engine then silently rejected JUST that one
//    member's move intent (@screeps/engine's movement.js, checkObstacleAtXY) while its squadmates' moves
//    succeeded, breaking mutual-range-1 for one tick even though planSquadMove's plan was objectively
//    correct given its (incomplete) occupancy input. FIXED in drainOccupancyFor: now also scans
//    FIND_SOURCES/FIND_MINERALS and marks their tiles occupied, same as any other obstacle.
//
// A third, DIFFERENT phenomenon was found once both fixes above let a squad actually complete a crossing —
// see CROSSING_SPLIT_TOLERANCE's doc below. It is NOT a bug: the real engine relocates any creep that lands
// on a room-edge tile into the neighboring room INSTANTLY (same tick), per creep, with no way for a bot
// script to make several independently-simulated creep objects cross atomically — so a footprint wider than
// 1 tile always straddles two rooms for a handful of ticks while actually crossing, self-healing via the
// squad's existing reform mechanism (ADR 0007). Fixing this at the planning level would mean either
// violating the hard constraint (peeking into the neighboring room to somehow synchronize the crossing) or
// adding fragile heuristics with no guarantee of eliminating every case — the assertions below instead
// tolerate a BOUNDED transient split, which still catches a genuine (indefinite/growing) regression.
//
// Rooms: stubWorld()'s standard 9-room grid puts W0N1, W1N1, W2N1 in a straight west-bound line (a real
// Game.map.findRoute chain, not fabricated adjacency — see the harness's own SCOUTABLE_NEIGHBOURS note for
// the same convention). All three get fully-open (all-plain) terrain, via a plain `new TerrainMatrix()` —
// the point under test is border-crossing/formation logic, not terrain obstacles (those are covered by
// squadCostMatrix.test.ts's own unit-level terrain-blocking cases).

import { afterEach, expect, test } from "vitest";
import { TerrainMatrix } from "screeps-server-mockup";
import { BootedColony, bundleBot } from "./harness";

const HOME = "W0N1";
const STAGING = "W1N1";
const TARGET = "W2N1";

const OPEN = (): TerrainMatrix => new TerrainMatrix();

// A room walled solid EXCEPT a narrow vertical corridor pinned against the WEST edge (x = 0..corridorMaxX),
// clear top to bottom. Reproduces the live geometry (colony W5N3's drain squad, 2026-08-08) that a fully-open
// test room never exercises: an interior wall block leaves the ONLY route to a room exit hugging the border,
// so a 2-tile-wide formation's trailing column is forced onto (or one tile shy of) the edge tiles as it
// travels toward the exit — the exact condition under which the persisted anchor and the engine's per-creep
// edge-relocation can fall out of phase (advance shoves the trailing column across, the block reads broken,
// reform yanks it back, repeat). The corridor is kept `corridorMaxX + 1` tiles wide so a 2x2 physically fits
// inside it (a 1-wide corridor could never hold the formation at all — a different, unrelated failure).
function westEdgeCorridor(corridorMaxX: number): TerrainMatrix {
  const terrain = new TerrainMatrix();
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      if (x > corridorMaxX) terrain.set(x, y, "wall");
    }
  }
  return terrain;
}

// A room whose LOWER portion (y >= openFromY) is walled solid except a 2-wide corridor pinned against the
// EAST edge (x = 48,49), while its UPPER portion (y < openFromY) is fully open. Reproduces the live W5N3
// off-route-dissolve WITHOUT the harder forced-corner-crossing: the squad's GOAL is a room to the NORTH, and
// the only route up through the lower room hugs the EAST border (x=49), so the 2-wide footprint's trailing
// column lands on x=49 and the engine teleports that member EAST into the off-route neighbour room — which
// tripped Drain.squadState's position-derived existence gate (readyForFirstPush/underway both false: the
// member is neither in staging nor a beyond-staging room), dissolving the whole already-joined squad every
// other tick (the odd/even flicker confirmed live on atomic data). The OPEN top band then lets a squad whose
// existence survives (the fix) slide off the edge and cross the north border through open ground — so this
// terrain fails ONLY on the dissolve bug, not the separate forced-corner-crossing residual (a corridor that
// stays 2-wide all the way to the border also strands a member ON the corner, a distinct bug tracked
// separately). A west-edge corridor toward a WEST goal never reproduces the dissolve at all: there the
// teleport lands in a beyond-staging room, so `underway` stays true.
function eastEdgeCorridorOpenTop(openFromY: number): TerrainMatrix {
  const terrain = new TerrainMatrix();
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      if (y >= openFromY && x < 48) terrain.set(x, y, "wall");
    }
  }
  return terrain;
}

// The real DRAIN_FORMATION shape (src/operations/drain.ts) — kept in sync by hand since it's not exported
// in a form a test-only file should import from src/ (this is a black-box integration test, no internal
// call sites). 1 drainAttacker anchor (0,0) + 3 drainHealer trailing right/down, canonical TOP facing.
const SLOT_OFFSETS: Array<{ dx: number; dy: number; role: "drainAttacker" | "drainHealer" }> = [
  { dx: 0, dy: 0, role: "drainAttacker" },
  { dx: 1, dy: 0, role: "drainHealer" },
  { dx: 0, dy: 1, role: "drainHealer" },
  { dx: 1, dy: 1, role: "drainHealer" }
];

// Real body compositions (matching drainAttacker.ts/drainHealer.ts's own MIN bodies) so the mockup engine's
// real move/attack/heal intents actually work — a squad with no real body parts can't act or move.
const ATTACKER_BODY = [
  { type: "attack", hits: 100 },
  { type: "move", hits: 100 }
];
const HEALER_BODY = [
  { type: "heal", hits: 100 },
  { type: "heal", hits: 100 },
  { type: "heal", hits: 100 },
  { type: "heal", hits: 100 },
  { type: "heal", hits: 100 },
  { type: "heal", hits: 100 },
  { type: "move", hits: 100 },
  { type: "move", hits: 100 },
  { type: "move", hits: 100 },
  { type: "move", hits: 100 },
  { type: "move", hits: 100 },
  { type: "move", hits: 100 }
];

interface SquadSeed {
  home: string;
  op: string;
  members: Array<{ name: string; role: "drainAttacker" | "drainHealer"; x: number; y: number; room: string }>;
}

// Places a tight 2x2 squad (canonical TOP facing) with its anchor (the drainAttacker slot) at
// (anchorX, anchorY) in `room`, and seeds both the real engine room objects and the CreepMemory the
// production Drain operation needs to claim them (role/home/op — see Operation.owned()'s `memory.op`
// filter). Does NOT set squadJoined — Drain.squadState()'s bootstrap path grants membership to the whole
// assembled squad unconditionally the first tick it runs (see drain.ts's squadState doc), so a fresh squad
// seeded pre-formed doesn't need it pre-seeded.
function tightSquadSeed(home: string, room: string, anchorX: number, anchorY: number, namePrefix: string): SquadSeed {
  const op = `drain:${home}`;
  const members = SLOT_OFFSETS.map((slot, i) => ({
    name: `${namePrefix}_${i}_${slot.role}`,
    role: slot.role,
    x: anchorX + slot.dx,
    y: anchorY + slot.dy,
    room
  }));
  return { home, op, members };
}

async function addSquad(colony: BootedColony, seed: SquadSeed): Promise<void> {
  const gameTime = await colony.server.world.gameTime;
  for (const m of seed.members) {
    const body = m.role === "drainAttacker" ? ATTACKER_BODY : HEALER_BODY;
    // addCreep on BootedColony always targets the HOME room; members seeded outside it (staging/target
    // rooms) go through the same server.world.addRoomObject call directly — BootedColony.addCreep is a
    // thin wrapper over exactly this (see harness.ts), just hardcoded to `this.room`.
    await colony.server.world.addRoomObject(m.room, "creep", m.x, m.y, {
      name: m.name,
      user: colony.bot.id,
      notifyWhenAttacked: true,
      body,
      store: { energy: 0 },
      storeCapacity: 0,
      hits: body.length * 100,
      hitsMax: body.length * 100,
      spawning: false,
      fatigue: 0,
      ageTime: gameTime + 1400
    });
  }
  await colony.patchMemory(mem => {
    const creeps = (mem.creeps ??= {}) as Record<string, CreepMemory>;
    for (const m of seed.members) creeps[m.name] = { role: m.role, home: seed.home, op: seed.op };
  });
}

// Seeds ONE squad member (real engine object + CreepMemory), optionally already carrying squadJoined so
// Drain.squadState reads it as an existing member (its re-entry branch, not the all-or-nothing bootstrap —
// see drain.ts's squadState doc). Used to reproduce the live freeze: a set of already-joined survivors plus
// a NOT-yet-joined replacement seeded far away, the exact state a mid-drain respawn produces (and the exact
// state none of the pre-tight, all-present seeds above ever reach, so none of them exercised the re-entry
// path that was broken live).
async function addMember(
  colony: BootedColony,
  home: string,
  op: string,
  member: { name: string; role: "drainAttacker" | "drainHealer"; x: number; y: number; room: string; joined?: boolean }
): Promise<void> {
  const gameTime = await colony.server.world.gameTime;
  const body = member.role === "drainAttacker" ? ATTACKER_BODY : HEALER_BODY;
  await colony.server.world.addRoomObject(member.room, "creep", member.x, member.y, {
    name: member.name,
    user: colony.bot.id,
    notifyWhenAttacked: true,
    body,
    store: { energy: 0 },
    storeCapacity: 0,
    hits: body.length * 100,
    hitsMax: body.length * 100,
    spawning: false,
    fatigue: 0,
    ageTime: gameTime + 1400
  });
  await colony.patchMemory(mem => {
    const creeps = (mem.creeps ??= {}) as Record<string, CreepMemory>;
    creeps[member.name] = { role: member.role, home, op, ...(member.joined ? { squadJoined: op } : {}) };
  });
}

/** Every live creep belonging to the squad, across whichever room it's currently in — a squad mid-crossing
 * straddles two rooms, so this scans every candidate room rather than assuming one. */
async function squadRoomObjects(
  colony: BootedColony,
  seed: SquadSeed,
  candidateRooms: readonly string[]
): Promise<Array<{ name: string; x: number; y: number; room: string }>> {
  const names = new Set(seed.members.map(m => m.name));
  const out: Array<{ name: string; x: number; y: number; room: string }> = [];
  for (const room of candidateRooms) {
    const objs = (await colony.server.world.roomObjects(room)) as Array<{
      type: string;
      name?: string;
      x: number;
      y: number;
      room: string;
    }>;
    for (const o of objs) {
      if (o.type === "creep" && o.name && names.has(o.name)) out.push({ name: o.name, x: o.x, y: o.y, room });
    }
  }
  return out;
}

async function squadJoinedCount(colony: BootedColony, seed: SquadSeed): Promise<number> {
  const mem = (await colony.memory()) as { creeps?: Record<string, CreepMemory> };
  const names = new Set(seed.members.map(m => m.name));
  let n = 0;
  for (const [name, c] of Object.entries(mem.creeps ?? {})) {
    if (names.has(name) && c.squadJoined === seed.op) n++;
  }
  return n;
}

// Genuinely welded, in real world-coordinates (geometry.ts's own lattice: room borders tile edge-to-edge,
// so two members in DIFFERENT rooms can still be mutual range 1) — same check the deleted
// squadBorderCrossing.test.ts used, reimplemented locally since this is a black-box test with no src/
// imports of its own beyond the harness. W/E and N/S mirror around the origin, matching src/lib/geometry.ts.
function worldOf(x: number, y: number, room: string): { wx: number; wy: number } {
  const m = /^([WE])(\d+)([NS])(\d+)$/.exec(room);
  if (!m) throw new Error(`not a room name: ${room}`);
  const [, ew, rxStr, ns, ryStr] = m;
  const rx = Number(rxStr);
  const ry = Number(ryStr);
  const wx = ew === "E" ? rx * 50 + x : -(rx + 1) * 50 + x;
  const wy = ns === "S" ? ry * 50 + y : -(ry + 1) * 50 + y;
  return { wx, wy };
}

function mutualRangeAtMost1(positions: readonly { x: number; y: number; room: string }[]): boolean {
  const worldPositions = positions.map(p => worldOf(p.x, p.y, p.room));
  for (let i = 0; i < worldPositions.length; i++) {
    for (let j = 0; j < worldPositions.length; j++) {
      if (i === j) continue;
      const d = Math.max(Math.abs(worldPositions[i].wx - worldPositions[j].wx), Math.abs(worldPositions[i].wy - worldPositions[j].wy));
      if (d > 1) return false;
    }
  }
  return true;
}

// A real Screeps engine fact, not a bot-side bug (see the crossing test's own comment for the full
// write-up): a creep that lands on ANY room-edge tile (x/y 0 or 49) gets relocated into the neighboring
// room's opposite edge INSTANTLY, same tick (@screeps/engine's processor/intents/creeps/tick.js, `isAtEdge`
// check right after movement.execute) — unconditional, per-creep, with no way for a bot script to make
// several independently-simulated creep objects cross atomically. DRAIN_FORMATION's 2x2 is 2 tiles wide, so
// as its anchor advances tile by tile toward a border, there is exactly one anchor position per axis where
// the dx=0 column of the footprint sits exactly on the edge while the dx=1 column is still one tile short
// — those two columns then get moved into different rooms by the ENGINE on the same tick, breaking mutual
// range 1 for the members on the near-side column until the squad's existing reform mechanism (ADR 0007)
// notices and pulls the far-side column across too. No formation-level planning change can prevent this
// without either violating the hard constraint on cross-room arithmetic (a bot script has no way to make
// two separately-simulated creep objects change rooms as a single atomic op) or fragile heuristics that
// don't generalize — confirmed live via this exact scenario (see git history for a longer debug trace):
// the split lasts a handful of ticks (up to CROSSING_SPLIT_TOLERANCE below) and always self-heals via the
// same reform-onto-nearest-fit logic that already recovers a straggler or a shoved member, never leaving
// the squad permanently scattered, out of bounds, or short a member.
const CROSSING_SPLIT_TOLERANCE = 12;

// Asserts the squad is welded EXCEPT for a bounded run of ticks (see CROSSING_SPLIT_TOLERANCE's doc) where
// the real engine's own edge-crossing mechanic can transiently split a footprint wider than 1 tile across a
// room border — never an indefinite/growing split, which would indicate a real regression rather than the
// expected one-time flicker while actually crossing.
function assertWeldedOrTransientCrossingSplit(
  members: readonly { x: number; y: number; room: string }[],
  tick: number,
  splitStreak: { count: number },
  positionsLog: readonly (readonly { x: number; y: number; room: string }[])[]
): void {
  if (mutualRangeAtMost1(members)) {
    splitStreak.count = 0;
    return;
  }
  splitStreak.count++;
  expect(
    splitStreak.count,
    `squad stayed broken for ${splitStreak.count} consecutive ticks (tolerance ${CROSSING_SPLIT_TOLERANCE}) ` +
      `ending at tick ${tick} — a real border-crossing flicker self-heals within a handful of ticks; this ` +
      `looks like a genuine scatter, not the expected transient split:\n${positionsLog
        .map((row, i) => `t${i}: ${row.map(m => `(${m.x},${m.y},${m.room})`).join(" ")}`)
        .join("\n")}`
  ).toBeLessThanOrEqual(CROSSING_SPLIT_TOLERANCE);
}

let colonies: BootedColony[] = [];

afterEach(() => {
  for (const c of colonies) c.stop();
  colonies = [];
});

// Turns on Drain for `target` against the colony's home room: places a real "drain:<target>" flag (so
// empire/drainFlags.ts's own live-flag-required watchdog doesn't clear the target back off the very next
// tick — see its file doc: a colony whose target has no matching flag gets clearedDrainTarget every tick,
// by design, so the player's flag can turn a drain off by disappearing) and directly sets
// ColonyMemory.draining, per the task's guidance to bypass pickDrainSponsor's spawn-affordability gate
// (a bare fresh colony can't afford a real drain squad — see drainSponsor.ts's DRAIN_SQUAD_MIN_COST, 1800
// energy, far above a fresh spawn's 300 capacity) and drive the crossing behaviour directly.
//
// Must run AFTER at least one real tick (`settleTicks`) so Memory.colonies[home] already exists with its
// full production shape (sources/remotes/danger/colonizing/attacking — see snapshot/colony.ts's own
// `Memory.colonies[room.name] ??= {...}` default). Patching `draining` onto a colony memory entry that
// doesn't exist yet would create a BARE {draining} object; every other operation's `??=` default then
// short-circuits on that already-existing (but under-specified) object and never backfills the missing
// fields, crashing the very next tick the first time e.g. Mining's recordSourceSpot intent runs (confirmed
// while building this test — TypeError reading a source id off `mem.sources`, undefined).
async function startDraining(colony: BootedColony, home: string, target: string): Promise<void> {
  await colony.placeFlag(`drain:${target}`, target, 25, 25);
  await colony.patchMemory(mem => {
    const colonies_ = (mem.colonies ??= {}) as Record<string, { draining?: string }>;
    const c = colonies_[home];
    if (!c) throw new Error("startDraining: Memory.colonies[home] doesn't exist yet — run a settling tick first");
    c.draining = target;
  });
}

test(
  "a tight 2x2 squad approaching a real room border stays safely welded and in-bounds under production squad movement",
  async () => {
    // DRAIN_FORMATION's trailing-corner 2x2 CAN complete a border crossing (see the crossing test below and
    // CROSSING_SPLIT_TOLERANCE's doc for why a brief, self-healing split during the crossing itself is
    // real-engine behavior, not a bug). What's checked here: the squad's production planSquadMove/
        // findSquadPath must behave SAFELY throughout — never throw (an out-of-range RoomPosition crashed the
    // whole tick's creep loop historically, docs/drain-squad-handoff.md bug #7), never lose a member, never
    // wander off to an invalid tile, and never stay broken longer than a transient border-crossing flicker.
    const colony = await BootedColony.boot({ botCode: bundleBot(), room: HOME, terrain: OPEN() });
    colonies.push(colony);
    await colony.server.world.setTerrain(STAGING, OPEN());
    await colony.server.world.setTerrain(TARGET, OPEN());

    // One settling tick so Memory.colonies[HOME] gets its full production shape before startDraining
    // patches `draining` onto it (see startDraining's doc).
    await colony.server.tick();

    // Seeded already fully in STAGING (W1N1), several tiles back from the W1N1/W2N1 border, so it's
    // immediately "ready for first push" (Drain.squadState: fully assembled + everyone physically in the
    // staging room) without needing a rally phase first (that lifecycle is exercised separately, below).
    const seed = tightSquadSeed(HOME, STAGING, 46, 25, "cross");
    await addSquad(colony, seed);
    // Draining TARGET (a room beyond staging), not STAGING itself — otherwise the squad's own goal (the
    // drain target's center) sits INSIDE the room it's already standing in and it never even attempts to
    // approach the border being tested here.
    await startDraining(colony, HOME, TARGET);

    const positionsLog: Array<Array<{ x: number; y: number; room: string }>> = [];
    const splitStreak = { count: 0 };
    for (let tick = 0; tick < 60; tick++) {
      await colony.server.tick();
      const members = await squadRoomObjects(colony, seed, [STAGING, TARGET]);
      positionsLog.push(members.map(m => ({ x: m.x, y: m.y, room: m.room })));

      // No position ever falls outside 0..49 — RoomPosition's constructor throws on out-of-range x/y,
      // which is exactly the crash mode a border-adjacent anchor caused historically (bug #7 above). The
      // mockup wouldn't let us seed an invalid tile in the first place, but a live crossing computing a bad
      // slot could still crash the tick — the whole loop completing without incident across every tick
      // here is itself part of what's being checked, in addition to the explicit range assertions below.
      for (const m of members) {
        expect(m.x, `out-of-range x at tick ${tick}`).toBeGreaterThanOrEqual(0);
        expect(m.x).toBeLessThanOrEqual(49);
        expect(m.y).toBeGreaterThanOrEqual(0);
        expect(m.y).toBeLessThanOrEqual(49);
      }
      // All 4 members present every single tick — never lost, degraded, or misjoined, even while transiently
      // split across a border (see assertWeldedOrTransientCrossingSplit's doc).
      expect(members.length, `squad member vanished at tick ${tick}`).toBe(4);
      assertWeldedOrTransientCrossingSplit(members, tick, splitStreak, positionsLog);
    }
  },
  120_000
);

test(
  "independent rally into a staging room, then formation into a tight 2x2 — the full pre-crossing lifecycle",
  async () => {
    // Three-room chain: HOME (independent rally, no squad coordination) -> STAGING (assembly point,
    // Game.map.findRoute's real middle hop between HOME and TARGET) -> TARGET (crossed in formation, see the
    // dedicated crossing test below). This test covers the two phases that happen BEFORE squad-controlled
    // movement takes over: scattered creeps walking in independently and converging into a tight,
    // production-recognized formation.
    const colony = await BootedColony.boot({ botCode: bundleBot(), room: HOME, terrain: OPEN() });
    colonies.push(colony);
    await colony.server.world.setTerrain(STAGING, OPEN());
    await colony.server.world.setTerrain(TARGET, OPEN());

    const op = `drain:${HOME}`;
    // Four members scattered across HOME, far from each other and far from the eventual staging rally
    // point — mirrors real spawned creeps trickling out one at a time, never placed pre-tight. Kept off the
    // room's own corners deliberately: a creep started right in a corner (e.g. (45,45)/(5,5)) sent
    // Traveler's PathFinder.search wandering into a neighbouring room outside stubWorld()'s 9-room grid
    // during its search (a diagonal step off the mapped area), throwing "Could not load terrain data" and
    // aborting that tick's ENTIRE creep loop (runGuarded wraps the whole runCreepBehaviors call, so one
    // creep's uncaught throw silently stops every creep later in Game.creeps' iteration order too) —
    // confirmed while building this test; a test-setup artifact of extreme starting positions, not a
    // production bug, and avoided here by simply not starting creeps in a room's literal corner tile.
    const scattered: Array<{ name: string; role: "drainAttacker" | "drainHealer"; x: number; y: number }> = [
      { name: "life_attacker", role: "drainAttacker", x: 10, y: 40 },
      { name: "life_healer_a", role: "drainHealer", x: 30, y: 5 },
      { name: "life_healer_b", role: "drainHealer", x: 40, y: 40 },
      { name: "life_healer_c", role: "drainHealer", x: 10, y: 10 }
    ];
    const gameTime = await colony.server.world.gameTime;
    for (const m of scattered) {
      const body = m.role === "drainAttacker" ? ATTACKER_BODY : HEALER_BODY;
      await colony.addCreep(m.name, m.x, m.y, {
        body,
        store: { energy: 0 },
        storeCapacity: 0,
        hits: body.length * 100,
        hitsMax: body.length * 100,
        spawning: false,
        fatigue: 0,
        ageTime: gameTime + 1400
      });
    }
    await colony.patchMemory(mem => {
      const creeps = (mem.creeps ??= {}) as Record<string, CreepMemory>;
      for (const m of scattered) creeps[m.name] = { role: m.role, home: HOME, op };
    });

    // One settling tick so Memory.colonies[HOME] gets its full production shape before startDraining
    // patches `draining` onto it (see startDraining's doc) — must happen before the drain target is set,
    // not just before the squad is seeded, since it's Memory.colonies[HOME] specifically at risk here.
    await colony.server.tick();
    await startDraining(colony, HOME, TARGET); // route home->TARGET via findRoute puts STAGING in the middle

    const seed: SquadSeed = { home: HOME, op, members: scattered.map(m => ({ ...m, room: HOME })) };

    // Phase 1: run real ticks until every member is physically together in STAGING (independent rally,
    // driven entirely by drainAttacker/drainHealer's own step table — moveToPos toward drainRallyPos, no
    // squad coordination at all until Drain.squadState reports readyForFirstPush).
    const assembledInStaging = async (): Promise<boolean> => {
      const members = await squadRoomObjects(colony, seed, [HOME, STAGING]);
      return members.length === 4 && members.every(m => m.room === STAGING);
    };
    let assembledTick: number | null = null;
    for (let tick = 0; tick < 1200 && assembledTick === null; tick++) {
      await colony.server.tick();
      if (await assembledInStaging()) assembledTick = tick;
    }
    expect(assembledTick, "squad never assembled together in the staging room via independent rally").not.toBeNull();

    // Phase 2: once assembled+co-located, Drain.squadState reports readyForFirstPush and runSquads/
    // planSquadMove takes over — the squad should settle into a tight, production-recognized 2x2 (mutual
    // range 1 in real world coordinates) within a handful of ticks of squad control taking over, not just
    // "technically present in the same room."
    let tightTick: number | null = null;
    const positionsLog: Array<Array<{ x: number; y: number; room: string }>> = [];
    for (let tick = 0; tick < 60 && tightTick === null; tick++) {
      await colony.server.tick();
      const members = await squadRoomObjects(colony, seed, [STAGING, TARGET]);
      positionsLog.push(members.map(m => ({ x: m.x, y: m.y, room: m.room })));
      for (const m of members) {
        expect(m.x).toBeGreaterThanOrEqual(0);
        expect(m.x).toBeLessThanOrEqual(49);
        expect(m.y).toBeGreaterThanOrEqual(0);
        expect(m.y).toBeLessThanOrEqual(49);
      }
      if (members.length === 4 && mutualRangeAtMost1(members)) tightTick = tick;
    }

    expect(
      tightTick,
      `squad assembled at staging but never reformed into a tight 2x2 under squad control:\n${positionsLog
        .map((row, i) => `t${i}: ${row.map(m => `(${m.x},${m.y},${m.room})`).join(" ")}`)
        .join("\n")}`
    ).not.toBeNull();

    // NOT asserted here: the squad going on to cross the STAGING/TARGET border — that's covered by the
    // dedicated crossing test below (and the approach test above), which also account for the real engine's
    // own transient border-split behavior (see CROSSING_SPLIT_TOLERANCE's doc). This test's own scope stays
    // the pre-crossing lifecycle (independent rally -> tight formation), deliberately not approaching the
    // border at all.
  },
  180_000
);

test(
  "Memory.creeps[].squadJoined never drops from 4 while a tight squad holds near a room border",
  async () => {
    // Real-engine counterpart to drain.test.ts's deleted unit test: watches the STATEFUL squadJoined
    // membership field (src/memory/schema.ts, set/cleared via setSquadJoined/clearSquadJoined — see
    // Drain.squadState's doc) tick by tick, confirming production Drain.intents() actually persists
    // membership through execute.ts on the real engine every tick, not just in a hand-driven unit fixture.
    //
    // The deleted unit test drove this scenario through an ACTUAL border straddle (2 members physically in
    // each of two rooms at once) — this real-engine version reaches that same straddle for real now that the
    // formation can complete a crossing (see this file's header). It verifies the load-bearing regression
    // this mechanism protects: membership must be based on STATE (CreepMemory.squadJoined, granted once and
    // persisted) rather than re-derived from live position every tick, so it can never flicker — checked
    // here across many real ticks of a genuinely-running squad right at a border, including the ticks where
    // the real engine's own edge-crossing mechanic transiently splits the footprint across two rooms (see
    // CROSSING_SPLIT_TOLERANCE's doc) — exactly the condition where the old positional re-derivation was
    // most likely to misfire, and squadJoined must stay stable regardless.
    const colony = await BootedColony.boot({ botCode: bundleBot(), room: HOME, terrain: OPEN() });
    colonies.push(colony);
    await colony.server.world.setTerrain(STAGING, OPEN());
    await colony.server.world.setTerrain(TARGET, OPEN());

    // One settling tick so Memory.colonies[HOME] gets its full production shape before startDraining
    // patches `draining` onto it (see startDraining's doc).
    await colony.server.tick();

    // Seeded right at the STAGING/TARGET border so the squad is immediately under squad control and
    // immediately attempting to push across it.
    const seed = tightSquadSeed(HOME, STAGING, 47, 25, "flick");
    await addSquad(colony, seed);
    await startDraining(colony, HOME, TARGET);

    const joinedCountLog: number[] = [];
    const roomsLog: string[] = [];
    for (let tick = 0; tick < 50; tick++) {
      await colony.server.tick();
      const joined = await squadJoinedCount(colony, seed);
      joinedCountLog.push(joined);
      const members = await squadRoomObjects(colony, seed, [STAGING, TARGET]);
      roomsLog.push(members.map(m => `${m.name}@${m.room}(${m.x},${m.y})`).join(","));
    }

    for (let i = 0; i < joinedCountLog.length; i++) {
      expect(
        joinedCountLog[i],
        `squadJoined count dropped at tick ${i}: [${joinedCountLog.join(",")}]\nrooms:\n${roomsLog.join("\n")}`
      ).toBe(4);
    }
  },
  120_000
);

// FIXED: squadCostMatrix.ts's moving-maximum transform used to mark a room-edge overflow (a footprint tile
// that would need a tile past this room's own 50x50 grid) as IMPASSABLE, which — since a formation's shape
// doesn't change mid-route — blocked the SAME edge in both the room being left and the room being entered,
// for every one of DRAIN_FORMATION's 4 valid facings. Fixed by pricing that overflow at a high-but-finite
// cost (ROOM_EDGE_OVERFLOW_COST) instead: PathFinder now only reaches for the edge when nothing cheaper
// exists (a genuine border crossing), relying on the real Screeps engine guarantee that an exit tile always
// opens onto walkable ground at least a tile or two into the neighboring room (exits never open onto a dead
// end), so a small formation landing just past a border is safe in practice.
test(
  "a tight 2x2 squad crosses a real room border and ends up fully inside the new room",
  async () => {
    const colony = await BootedColony.boot({ botCode: bundleBot(), room: HOME, terrain: OPEN() });
    colonies.push(colony);
    await colony.server.world.setTerrain(STAGING, OPEN());
    await colony.server.world.setTerrain(TARGET, OPEN());

    await colony.server.tick();

    // Seeded already in STAGING, close to the STAGING/TARGET border, so it's immediately ready for the
    // first push without needing a rally phase first (that's covered separately above).
    const seed = tightSquadSeed(HOME, STAGING, 44, 25, "xing");
    await addSquad(colony, seed);
    await startDraining(colony, HOME, TARGET);

    const positionsLog: Array<Array<{ x: number; y: number; room: string }>> = [];
    const splitStreak = { count: 0 };
    const fullyAcross = async (): Promise<boolean> => {
      const members = await squadRoomObjects(colony, seed, [STAGING, TARGET]);
      return members.length === 4 && members.every(m => m.room === TARGET);
    };

    let crossedTick: number | null = null;
    for (let tick = 0; tick < 150 && crossedTick === null; tick++) {
      await colony.server.tick();
      const members = await squadRoomObjects(colony, seed, [STAGING, TARGET]);
      positionsLog.push(members.map(m => ({ x: m.x, y: m.y, room: m.room })));
      for (const m of members) {
        expect(m.x, `out-of-range x at tick ${tick}`).toBeGreaterThanOrEqual(0);
        expect(m.x).toBeLessThanOrEqual(49);
        expect(m.y).toBeGreaterThanOrEqual(0);
        expect(m.y).toBeLessThanOrEqual(49);
      }
      expect(members.length, `squad member vanished at tick ${tick}`).toBe(4);
      // See CROSSING_SPLIT_TOLERANCE's doc: the real engine relocates a creep into the neighboring room the
      // instant it lands on an edge tile, so DRAIN_FORMATION's 2-tile-wide footprint genuinely straddles two
      // rooms for a handful of ticks while it actually crosses — a real, self-healing engine consequence,
      // not a planning bug (confirmed live: membership never drops, positions never go out of bounds, and
      // the squad always reforms tight again within CROSSING_SPLIT_TOLERANCE ticks).
      assertWeldedOrTransientCrossingSplit(members, tick, splitStreak, positionsLog);
      if (await fullyAcross()) crossedTick = tick;
    }

    expect(
      crossedTick,
      `squad never fully crossed into ${TARGET}:\n${positionsLog.map((row, i) => `t${i}: ${row.map(m => `(${m.x},${m.y},${m.room})`).join(" ")}`).join("\n")}`
    ).not.toBeNull();
  },
  120_000
);

// REGRESSION (reproduces a live oscillation, colony W5N3's drain squad, 2026-08-08 — NOT covered by any test
// above, all of which use fully-open terrain): when the ONLY route to a room exit hugs the border (an
// interior wall block leaves no interior detour — the live W6N3 pocket), a 2-tile-wide formation travelling
// that corridor keeps shoving its trailing column onto the edge tiles. The engine relocates any creep on an
// edge tile into the neighbouring room the same tick, per creep; if the persisted squad anchor doesn't
// advance ONTO/ACROSS the border in phase with those relocated members, the block reads as "broken" every
// other tick (members no longer on the slot tiles slotTiles computes from an anchor still one tile short of
// the border), so planSquadMove alternates advance -> (teleport breaks it) -> reform-pull-back -> advance
// forever, never crossing, and exposing a lone teleported member out of heal range (one died live). The
// cohesion machinery itself is already correct for a straddle (inFormation + slotTiles place and match
// across-border slot tiles fine, proven at the unit level) — the failure is purely the anchor advancement
// falling out of phase with the engine's edge relocation, which only manifests when terrain forces the
// formation to actually travel along a border rather than crossing it head-on from open ground.
//
// The assertions reuse assertWeldedOrTransientCrossingSplit (a BOUNDED transient split is real-engine
// behaviour, see CROSSING_SPLIT_TOLERANCE) — so this test does NOT forbid the brief straddle every crossing
// has; it fails specifically on the INDEFINITE oscillation (a split that never heals, i.e. the squad never
// crossing) that the phase bug produces, plus the concrete symptom that a member gets stranded/lost.
test(
  "a tight 2x2 in a border-pinned corridor crosses in ONE pass with only bounded oscillation (live W5N3 regression)",
  async () => {
    // Corridor 0..3 (4 tiles wide) so the 2x2 physically fits; everything x>3 is wall — the ONLY route to the
    // STAGING/TARGET border (W1N1's west edge, x=0) hugs the edge, no interior detour, exactly like the live
    // W6N3 pocket that a fully-open test room never exercises. This is the terrain class the pre-rework
    // indefinite oscillation lived on: a 2-tile-wide formation forced to travel touching a border, its
    // trailing column clipping the edge tiles the engine relocates on every step. If the anchor advancement
    // stays in phase with the engine's per-creep teleport, this is one pass with only a brief straddle; if it
    // falls out of phase, the squad ping-pongs in place and never crosses (assertWeldedOrTransientCrossingSplit
    // catches the never-healing split; the crossedTick assertion catches never crossing at all).
    const CORRIDOR_MAX_X = 3;
    const colony = await BootedColony.boot({ botCode: bundleBot(), room: HOME, terrain: OPEN() });
    colonies.push(colony);
    await colony.server.world.setTerrain(STAGING, westEdgeCorridor(CORRIDOR_MAX_X));
    await colony.server.world.setTerrain(TARGET, OPEN());

    await colony.server.tick();

    const seed = tightSquadSeed(HOME, STAGING, 2, 44, "corr");
    await addSquad(colony, seed);
    await startDraining(colony, HOME, TARGET);

    const positionsLog: Array<Array<{ x: number; y: number; room: string }>> = [];
    const splitStreak = { count: 0 };
    let maxSplitStreak = 0;
    const fullyAcross = async (): Promise<boolean> => {
      const members = await squadRoomObjects(colony, seed, [STAGING, TARGET]);
      return members.length === 4 && members.every(m => m.room === TARGET);
    };

    let crossedTick: number | null = null;
    for (let tick = 0; tick < 150 && crossedTick === null; tick++) {
      await colony.server.tick();
      const members = await squadRoomObjects(colony, seed, [STAGING, TARGET]);
      positionsLog.push(members.map(m => ({ x: m.x, y: m.y, room: m.room })));
      for (const m of members) {
        expect(m.x, `out-of-range x at tick ${tick}`).toBeGreaterThanOrEqual(0);
        expect(m.x).toBeLessThanOrEqual(49);
        expect(m.y).toBeGreaterThanOrEqual(0);
        expect(m.y).toBeLessThanOrEqual(49);
      }
      expect(members.length, `squad member vanished/stranded at tick ${tick}`).toBe(4);
      assertWeldedOrTransientCrossingSplit(members, tick, splitStreak, positionsLog);
      maxSplitStreak = Math.max(maxSplitStreak, splitStreak.count);
      if (await fullyAcross()) crossedTick = tick;
    }

    const trace = positionsLog.map((row, i) => `t${i}: ${row.map(m => `(${m.x},${m.y},${m.room})`).join(" ")}`).join("\n");
    expect(crossedTick, `squad never crossed the long border-hugging corridor into ${TARGET} (oscillated indefinitely):\n${trace}`).not.toBeNull();
    // The crossing must not just eventually happen, it must happen cleanly: the worst consecutive-split run
    // stays under the tolerance (the squad-movement rework — commit 4d7d708's fixed anchor placement, removed
    // rotation, and fixed cost matrices — turned the pre-rework INDEFINITE oscillation into a one-pass
    // crossing). NOTE: the true goal is a fully SMOOTH transition with NO oscillation at all — as of the
    // rework this crossing still shows a brief reform snap-back (a straddled block pulled back into the old
    // room for a tick before re-crossing), tolerated here because the engine's per-creep edge relocation makes
    // SOME transient straddle unavoidable, but a maxSplitStreak of 0–1 (never a snap-back) is the target this
    // guard should be tightened toward once the anchor advancement is fully in phase with the relocation. For
    // now it fails only on the never-healing regression, while recording that a smooth crossing is the aim.
    expect(maxSplitStreak, `max consecutive split streak too high for a one-pass crossing:\n${trace}`).toBeLessThanOrEqual(CROSSING_SPLIT_TOLERANCE);
  },
  120_000
);

// REGRESSION — the confirmed live W5N3 freeze (2026-08-10), reproduced on the EXACT geometry that produced
// it and that no other test here reaches: goal to the NORTH, but the only northward route hugs the EAST
// border, so the 2-wide footprint's trailing column keeps landing on x=49 and the engine teleports that
// member EAST into an OFF-ROUTE room. Confirmed root cause (atomic single-tick pserver data): Drain.squadState
// dissolves the whole ALREADY-JOINED squad on any tick a member is off-route — its position-derived existence
// gate (readyForFirstPush && every member in staging, OR underway && a member in a beyond-staging room) runs
// BEFORE the stateful squadJoined membership check, so an off-route teleport makes both false and the function
// returns undefined. With no squad that tick, every member reverts to its own rally step table; next tick the
// member walks back, the squad re-forms, the member is put back on the edge and teleports off-route again —
// a perfect odd/even flicker (verified by tick parity: runSquads on even ticks, step-table moveToPos on odd).
// The squad thrashes between two conflicting targets forever and never crosses. This test seeds a fully
// squadJoined squad and asserts it stays a squad and actually crosses north; RED until squad EXISTENCE comes
// from squadJoined (memory) once joined, with the position gate governing only the never-joined first push.
const HOME_N = "W2N1"; // west of STAGING_N, so the off-route EAST room (W0N1) is neutral, not the colony room
const STAGING_N = "W1N1";
const TARGET_N = "W1N2"; // directly NORTH of STAGING_N — route goes north, NOT east
const OFFROUTE_E = "W0N1"; // east neighbour of STAGING_N — where an x=49 straddle teleports a member, OFF-route

test(
  "an already-joined squad forced against the EAST border while heading NORTH does not dissolve off-route and crosses (live W5N3 freeze)",
  async () => {
    // Lower 2/3 of STAGING_N is a 2-wide east-edge corridor (forces the footprint onto x=49 → off-route
    // teleport → the dissolve bug); the top band (y < 15) is open so a squad that SURVIVES the dissolve (the
    // fix) can slide west off the edge and cross the north border through open ground, isolating the dissolve
    // bug from the separate forced-corner-crossing residual.
    const OPEN_FROM_Y = 15;
    const colony = await BootedColony.boot({ botCode: bundleBot(), room: HOME_N, terrain: OPEN() });
    colonies.push(colony);
    await colony.server.world.setTerrain(STAGING_N, eastEdgeCorridorOpenTop(OPEN_FROM_Y));
    await colony.server.world.setTerrain(TARGET_N, OPEN());

    await colony.server.tick();

    const op = `drain:${HOME_N}`;
    // Seed a fully-assembled, already-squadJoined squad DOWN in the 2-wide east corridor (anchor (48,25),
    // footprint (48,25),(49,25),(48,26),(49,26)). Travelling north toward the goal it keeps its trailing
    // column on x=49, so a member is teleported EAST into the off-route room W0N1 (neither staging nor a
    // beyond-staging room) — the condition that dissolved the squad every other tick pre-fix. squadJoined is
    // pre-set so this exercises squad EXISTENCE persistence, not the first-assembly bootstrap. Once it reaches
    // the open top band it slides off the edge and crosses north (only possible if the squad survived the
    // off-route ticks — i.e. with the fix).
    const members = [
      { name: "eastxing_attacker", role: "drainAttacker" as const, x: 48, y: 25, room: STAGING_N },
      { name: "eastxing_healer_a", role: "drainHealer" as const, x: 49, y: 25, room: STAGING_N },
      { name: "eastxing_healer_b", role: "drainHealer" as const, x: 48, y: 26, room: STAGING_N },
      { name: "eastxing_healer_c", role: "drainHealer" as const, x: 49, y: 26, room: STAGING_N }
    ];
    for (const m of members) await addMember(colony, HOME_N, op, { ...m, joined: true });
    const seed: SquadSeed = { home: HOME_N, op, members };
    await startDraining(colony, HOME_N, TARGET_N);

    // The load-bearing observable is simply: does the already-joined squad make progress north and cross,
    // or does it freeze/scatter on the east border? squadJoinedCount is NOT a useful probe here — the memory
    // flag persists even while squadState returns undefined (the dissolve is a squad-EXISTENCE flip, not a
    // membership-flag clear), so the bug shows as "never crosses", the squad reverting to rally step tables
    // every off-route tick and thrashing in place, never completing the northward crossing.
    const positionsLog: Array<Array<{ x: number; y: number; room: string }>> = [];
    let crossedTick: number | null = null;
    for (let tick = 0; tick < 120 && crossedTick === null; tick++) {
      await colony.server.tick();
      const found = await squadRoomObjects(colony, seed, [STAGING_N, TARGET_N, OFFROUTE_E, "W0N2", "W2N1", "W2N2"]);
      positionsLog.push(found.map(m => ({ x: m.x, y: m.y, room: m.room })));
      for (const m of found) {
        expect(m.x, `out-of-range x at tick ${tick}`).toBeGreaterThanOrEqual(0);
        expect(m.x).toBeLessThanOrEqual(49);
        expect(m.y).toBeGreaterThanOrEqual(0);
        expect(m.y).toBeLessThanOrEqual(49);
      }
      expect(found.length, `squad member vanished at tick ${tick}`).toBe(4);
      if (found.length === 4 && found.every(m => m.room === TARGET_N)) crossedTick = tick;
    }

    const trace = positionsLog.map((row, i) => `t${i}: ${row.map(m => `(${m.x},${m.y},${m.room})`).join(" ")}`).join("\n");
    expect(crossedTick, `squad never crossed NORTH into ${TARGET_N} (froze/scattered on the east border):\n${trace}`).not.toBeNull();
  },
  180_000
);
