// Reproduces a real deadlock observed live on the pserver (2026-08-07, colony W8N3 draining W6N5): a
// drainHealer straggler rallying to a squad already parked in W7N3 never joined — its position oscillated
// between a handful of nearby tiles for 200+ ticks while the other 3 members held still forever. Found by
// tracing `debugColony("W8N3")`'s drain squadState/runSquads output live; the assigned reform destination
// never changed and terrain in the area is fully open, so the stall was pathing/assignment, not a wall.
//
// squadFormation.test.ts's straggler tests never caught this because SquadWorld's teleport-based `step`
// (see squadWorld.ts) instantly drops a member onto whatever tile reformAssignment picked, regardless of
// distance or whether the path there is physically clear — the exact failure mode this bug lives in never
// has a chance to manifest under a teleport. `stepReal`/`runReal` walk one real tile per tick instead,
// treating squadmate tiles as impassable obstacles (mirroring the actual engine's move-blocking), which
// exposes it.

import { describe, expect, it } from "vitest";
import type { Formation } from "../../../../src/lib/formation";
import { REACHABLE_SEARCH_BUDGET } from "../../../../src/lib/squad";
import { SquadWorld, type TerrainSource } from "./squadWorld";

const BLOCK_2X2: Formation = [
  { dx: 0, dy: 0, role: "drainAttacker" },
  { dx: 1, dy: 0, role: "drainHealer" },
  { dx: 0, dy: 1, role: "drainHealer" },
  { dx: 1, dy: 1, role: "drainHealer" }
];

const ROOM = "W7N3";

// The real terrain around the stall, dumped live via Game.map.getRoomTerrain('W7N3') for x=18..27,
// y=20..28 (see the investigation this test documents) — 0 walkable, 1 wall. Rows/cols outside this
// window are left fully open (irrelevant to the stall, and no test assertion depends on them).
const TERRAIN_ROWS: Record<number, string> = {
  20: "0000000001",
  21: "0000011000",
  22: "0000011000",
  23: "1110000000",
  24: "1111000000",
  25: "1111100011",
  26: "0111100111",
  27: "1111110111",
  28: "1000111100"
};

function liveLayoutTerrain(): TerrainSource {
  const grid = new Uint8Array(2500).fill(1); // default walkable outside the dumped window
  for (const [yStr, row] of Object.entries(TERRAIN_ROWS)) {
    const y = Number(yStr);
    for (let i = 0; i < row.length; i++) {
      const x = 18 + i;
      grid[x * 50 + y] = row[i] === "1" ? 0 : 1; // dump uses 1=wall; TerrainSource uses 1=walkable
    }
  }
  return room => (room === ROOM ? grid : undefined);
}

describe("Squad reform deadlock (live pserver repro)", () => {
  it("a straggler rallying to a squad already parked tight-ish eventually joins under real single-tile stepping", () => {
    const world = new SquadWorld(BLOCK_2X2, liveLayoutTerrain());
    // Exact live positions at the moment tracing started: attacker + 2 healers already clustered, the
    // straggler healer walking in from the southwest.
    world.addMember({ role: "drainAttacker", x: 24, y: 26, room: ROOM });
    world.addMember({ role: "drainHealer", x: 24, y: 25, room: ROOM });
    world.addMember({ role: "drainHealer", x: 23, y: 25, room: ROOM });
    const straggler = world.addMember({ role: "drainHealer", x: 18, y: 21, room: ROOM });

    const anchor = { x: 24, y: 26, room: ROOM };
    // The live trace's runSquads line reported `branch=reform@nearestFit(24,26,W7N3,facing=5)` — facing 5 is
    // BOTTOM (Screeps' TOP=1..TOP_LEFT=8 clockwise numbering), NOT the separately-reported squadState
    // `facing=1` (that's Drain's own desiredFacing/currentFacing, a different value planSquadMove never
    // receives directly — nearestFittingAnchor independently searches for whichever facing the CURRENT
    // anchor/live shape actually fits at). Slot tiles at (24,26) facing BOTTOM are exactly
    // (24,26)/(23,26)/(24,25)/(23,25) — matching the live moves=[...] targets byte for byte, confirming
    // this is the facing actually in effect (verified directly against the real slotTiles(), not by
    // hand-deriving rotateOffset — see git history if this ever needs re-deriving).
    const facing = BOTTOM;
    const goal = anchor; // isolate reform from advance — the live case also never advanced (readyForFirstPush
    // stayed true, underway false, anchor pinned) for the entire window this was traced

    const log = world.runReal(300, () => ({ anchor, facing, goal }));

    const becameTight = log.some(e => e.tight);
    expect(
      becameTight,
      `straggler never joined under real stepping (this reproduces the live pserver deadlock):\n${world.describeLog()}`
    ).toBe(true);

    // The straggler must have made monotonic-ish progress, not oscillated in a small tile cluster forever —
    // the live symptom was 200+ ticks bouncing between (22,24)/(23,24)/(21,23)/(24,24) with zero net progress.
    const stragglerPositions = log.map(e => e.positions.find(p => p.id === straggler)!);
    const uniqueTiles = new Set(stragglerPositions.map(p => `${p.x},${p.y}`));
    expect(
      uniqueTiles.size,
      `straggler visited only a tiny cluster of tiles over 300 ticks — looks like the live oscillation:\n${world.describeLog()}`
    ).toBeGreaterThan(3);
  });

  // Performance regression guard for a real incident this fix introduced, found on the SAME live
  // observation session (2026-08-07): the reachability BFS backing the repair pass above has no notion
  // of "this destination is unreachable" other than exhausting its search — and a genuinely unreachable
  // slot (the case the repair pass exists to detect) is exactly the input that makes an UNBOUNDED BFS
  // walk the entire room (up to 2500 tiles), repeated O(members^2) times per repair pass across up to
  // `members.length` passes. Deployed to the pserver, this fanned out into a ~20x CPU spike (creeps
  // system jumped from ~9 CPU/tick to 282), emptying the CPU bucket and terminating script execution most
  // ticks (confirmed via server/logs/engine_runner1.log's "Script execution has been terminated: CPU
  // bucket is empty" / "Skip user execution" entries). Fixed with REACHABLE_SEARCH_BUDGET (src/lib/squad.ts)
  // capping the BFS at a small constant instead of the room's full 2500 tiles. A wall-clock timing
  // assertion turned out NOT to reliably distinguish bounded from unbounded at this test's scale (a single
  // room split in half is only ~1250 tiles either side — fast in absolute terms even unbounded, unlike the
  // real live colony's much larger aggregate cost across multiple squads/ticks) — so this asserts directly
  // on the exported constant staying a small, fixed bound instead, which is what actually failed live.
  it("the reachability BFS is bounded to a small constant, not the room's full 2500 tiles", () => {
    expect(REACHABLE_SEARCH_BUDGET, "the BFS cap regressed to (or past) room-scale — this is what caused the live CPU bucket exhaustion").toBeLessThan(500);
  });

  // Behavioral companion to the above: a genuinely unreachable reform target (sealed behind a real wall,
  // not just crowded) still lets the squad continue operating sanely — no crash, no hang past a generous
  // tick budget — even though that member can never actually join. Also serves as a smoke test that the
  // budget cap doesn't corrupt an otherwise-normal run's positions.
  it("an unreachable reform target does not hang or crash the squad", () => {
    // A large open room with a single unbroken wall splitting it in half at x=25 — the formation lives on
    // the west side (x<25); the straggler's own current tile sits east of the wall (x>25), so its assigned
    // slot on the west side is PERMANENTLY unreachable to it.
    const grid = new Uint8Array(2500).fill(1);
    for (let y = 0; y < 50; y++) grid[25 * 50 + y] = 0; // wall column at x=25
    const terrain: TerrainSource = room => (room === ROOM ? grid : undefined);

    const world = new SquadWorld(BLOCK_2X2, terrain);
    world.addMember({ role: "drainAttacker", x: 10, y: 25, room: ROOM });
    world.addMember({ role: "drainHealer", x: 11, y: 25, room: ROOM });
    world.addMember({ role: "drainHealer", x: 10, y: 26, room: ROOM });
    world.addMember({ role: "drainHealer", x: 40, y: 25, room: ROOM }); // sealed on the far side

    const anchor = { x: 10, y: 25, room: ROOM };
    const goal = anchor;
    const log = world.runReal(50, () => ({ anchor, facing: TOP, goal }));

    expect(log).toHaveLength(50);
    for (const entry of log) {
      for (const p of entry.positions) {
        expect(p.x, `position went out of range:\n${world.describeLog()}`).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThan(50);
      }
    }
  });
});
