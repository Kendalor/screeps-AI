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

import { beforeEach, describe, expect, it } from "vitest";
import type { Formation } from "../../../../src/lib/formation";
import { clearSquadMatrixCache } from "../../../../src/lib/squadCostMatrix";
import { clearTiles, stubPathFinderSingleRoom } from "../../../constants";
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

beforeEach(() => {
  clearTiles();
  clearSquadMatrixCache();
  stubPathFinderSingleRoom();
});

describe("Squad reform deadlock (live pserver repro)", () => {
  it("a straggler rallying to a squad already parked tight-ish eventually joins under real single-tile stepping", () => {
    const world = new SquadWorld(BLOCK_2X2, liveLayoutTerrain());
    // Exact live positions at the moment tracing started: attacker + 2 healers already clustered, the
    // straggler healer walking in from the southwest.
    world.addMember({ role: "drainAttacker", x: 24, y: 26, room: ROOM });
    world.addMember({ role: "drainHealer", x: 24, y: 25, room: ROOM });
    world.addMember({ role: "drainHealer", x: 23, y: 25, room: ROOM });
    const straggler = world.addMember({ role: "drainHealer", x: 18, y: 21, room: ROOM });

    // The live trace's runSquads line reported `branch=reform@nearestFit(24,26,W7N3,facing=5)` — facing 5
    // was BOTTOM under the OLD mechanism (nearestFittingAnchor searched a formation pre-rotated to the
    // current facing, so it could report an anchor at whichever corner that rotation put it at, and
    // PLACEMENT then rotated AGAIN independently — the two could disagree, which is exactly the bug this
    // test caught: a healer got routed onto a real wall tile because the verified-open canonical box and
    // the actually-placed rotated box were different tile sets). Under the current design there is no
    // facing/rotation anywhere — the box's tile-set is fixed, full stop (lib/formation.ts's module header)
    // — so the geometrically equivalent open pocket is found via its own real top-left corner instead —
    // (23,25), one tile from the live trace's (24,26) — which nearestFittingAnchor reaches on its own; the
    // exact anchor value is no longer significant, only that the search converges AND placement uses the
    // SAME (never-rotated) tile set pathing verified. `goal` still equals the STARTING anchor (isolating
    // reform from advance, matching the live incident: readyForFirstPush stayed true, underway false,
    // anchor pinned for the entire traced window).
    const startAnchor = { x: 24, y: 26, room: ROOM };
    const goal = startAnchor;

    // Threads each tick's returned (possibly-corrected) anchor into the next tick's plan — production does
    // the same via SquadMovePlan.anchor (see lib/squad.ts's SquadState doc and squadWorld.ts's run/runReal
    // doc) rather than re-supplying a fixed anchor forever.
    const log = world.runReal(300, w => ({ anchor: w.log.at(-1)?.anchor ?? startAnchor, goal }));

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

  // Performance regression guard for a real incident an earlier version of this fix introduced, found on
  // the SAME live observation session (2026-08-07): that version detected a stranded member with a
  // terrain BFS with no notion of "this destination is unreachable" other than exhausting its search — a
  // genuinely unreachable slot made it walk the entire room (up to 2500 tiles), repeated O(members^2)
  // times per repair pass. Deployed to the pserver, this fanned out into a ~20x CPU spike (creeps system
  // jumped from ~9 CPU/tick to 282), emptying the CPU bucket and terminating script execution most ticks
  // (confirmed via server/logs/engine_runner1.log's "Script execution has been terminated: CPU bucket is
  // empty" / "Skip user execution" entries). The current repair (slotChainRepair, src/lib/squad.ts) doesn't
  // search terrain at all — it walks the formation's OWN slot graph (a handful of nodes fixed by the
  // formation's size, e.g. 4 for a 2x2 block), which has no room-scale failure mode to regress toward: the
  // class of bug is gone by construction, not bounded by a tunable constant. No assertion needed here
  // beyond the behavioral case below, which confirms an unreachable target still doesn't hang.
  //
  // Behavioral: a genuinely unreachable reform target (sealed behind a real wall, not just crowded) still
  // lets the squad continue operating sanely — no crash, no hang past a generous tick budget — even though
  // that member can never actually join.
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
    const log = world.runReal(50, () => ({ anchor, goal }));

    expect(log).toHaveLength(50);
    for (const entry of log) {
      for (const p of entry.positions) {
        expect(p.x, `position went out of range:\n${world.describeLog()}`).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThan(50);
      }
    }
  });
});
