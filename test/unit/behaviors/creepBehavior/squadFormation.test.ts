// Squad formation/creation: does a group of freshly-spawned (or scattered) creeps actually converge into a
// tight formation, and does the generic Squad entity correctly recognize a degraded/growing formation as it
// forms? Uses SquadWorld (squadWorld.ts) — a live, mutating multi-creep harness around the REAL
// planSquadMove, not a single hand-built SquadState call like squad.test.ts. Every test can dump
// `world.describeLog()` on failure for full tick-by-tick observability.

import { beforeEach, describe, expect, it } from "vitest";
import type { Formation } from "../../../../src/lib/formation";
import { clearSquadMatrixCache } from "../../../../src/lib/squadCostMatrix";
import { clearTiles, stubPathFinderSingleRoom } from "../../../constants";
import { openRooms, SquadWorld } from "./squadWorld";

// Drain's real 2x2 — reused here rather than inventing a new shape, since it's the formation this whole
// test suite exists to exercise (see docs/drain-squad-handoff.md).
const BLOCK_2X2: Formation = [
  { dx: 0, dy: 0, role: "drainAttacker" },
  { dx: 1, dy: 0, role: "drainHealer" },
  { dx: 0, dy: 1, role: "drainHealer" },
  { dx: 1, dy: 1, role: "drainHealer" }
];

const ROOM = "W2N1";

beforeEach(() => {
  clearTiles();
  clearSquadMatrixCache();
  stubPathFinderSingleRoom();
});

describe("Squad formation and creation", () => {
  it("four creeps spawned scattered near a rally point converge into a tight 2x2 within a bounded number of ticks", () => {
    const world = new SquadWorld(BLOCK_2X2, openRooms(ROOM));
    // Scattered within a few tiles of an intended anchor — like four members trickling out of a spawn one
    // at a time, not already welded (see handoff bug list: assembly always starts scattered, never tight).
    world.addMember({ role: "drainAttacker", x: 25, y: 25, room: ROOM });
    world.addMember({ role: "drainHealer", x: 22, y: 23, room: ROOM });
    world.addMember({ role: "drainHealer", x: 28, y: 27, room: ROOM });
    world.addMember({ role: "drainHealer", x: 20, y: 30, room: ROOM });

    const anchor = { x: 25, y: 25, room: ROOM };
    const goal = { x: 25, y: 20, room: ROOM }; // a goal beyond the rally, so the squad tries to advance once tight
    const log = world.run(40, () => ({ anchor, goal }));

    const becameTight = log.some(e => e.tight);
    expect(becameTight, `squad never became tight:\n${world.describeLog()}`).toBe(true);
    // Once tight, it must not immediately fall back out of formation — the last entry should be tight too,
    // since after reaching the fixed anchor there's nothing to disturb the block.
    expect(log[log.length - 1].tight, `squad did not stay tight:\n${world.describeLog()}`).toBe(true);
  });

  it("a straggler far from the rest is drawn in while the rest of the block holds still (no premature advance)", () => {
    const world = new SquadWorld(BLOCK_2X2, openRooms(ROOM));
    const attacker = world.addMember({ role: "drainAttacker", x: 25, y: 25, room: ROOM });
    world.addMember({ role: "drainHealer", x: 26, y: 25, room: ROOM });
    world.addMember({ role: "drainHealer", x: 25, y: 26, room: ROOM });
    const straggler = world.addMember({ role: "drainHealer", x: 35, y: 35, room: ROOM }); // far out

    const anchor = { x: 25, y: 25, room: ROOM };
    const goal = { x: 25, y: 20, room: ROOM };
    const first = world.step(anchor, goal);

    // The attacker (anchor slot, already on its own tile) must NOT have moved off its slot on the very
    // first tick — the block holds for the straggler rather than advancing without it (planSquadMove's
    // core contract).
    const attackerPos = first.positions.find(p => p.id === attacker)!;
    expect(attackerPos.x).toBe(25);
    expect(attackerPos.y).toBe(25);

    // Run it out — the straggler should eventually close the gap and the block become tight.
    const rest = world.run(60, () => ({ anchor, goal }));
    const allTight = rest.some(e => e.tight);
    expect(allTight, `straggler never joined the formation:\n${world.describeLog()}`).toBe(true);
    // Sanity: the straggler actually moved from its starting tile at some point (it wasn't just ignored).
    const stragglerMoved = rest.some(e => {
      const p = e.positions.find(pp => pp.id === straggler)!;
      return p.x !== 35 || p.y !== 35;
    });
    expect(stragglerMoved).toBe(true);
  });

  it("a degraded formation (one member dead) still recognizes itself as tight in its reduced shape", () => {
    const world = new SquadWorld(BLOCK_2X2, openRooms(ROOM));
    const attacker = world.addMember({ role: "drainAttacker", x: 25, y: 25, room: ROOM });
    world.addMember({ role: "drainHealer", x: 26, y: 25, room: ROOM });
    world.addMember({ role: "drainHealer", x: 25, y: 26, room: ROOM });
    world.addMember({ role: "drainHealer", x: 26, y: 26, room: ROOM });

    const anchor = { x: 25, y: 25, room: ROOM };
    // Goal == anchor so a tight block has nowhere to advance to — isolates the tight-check itself from
    // planSquadMove's separate advance-one-step behavior (which would move the anchor and invalidate the
    // fixed `anchor` this test keeps passing after killing a member).
    const goal = anchor;
    // Confirm fully tight first (sanity baseline).
    const baseline = world.step(anchor, goal);
    expect(baseline.tight).toBe(true);

    // Kill the attacker (the anchor slot) — the surviving 3 healers are still sitting on their own slot
    // tiles, so with only 3 live members the formation should STILL read as tight (a vacant slot needs
    // nobody — see lib/squad.ts's inFormation doc).
    world.kill(attacker);
    const afterLoss = world.step(anchor, goal);
    expect(afterLoss.tight, `degraded formation not recognized as tight:\n${world.describeLog()}`).toBe(true);
    expect(afterLoss.positions).toHaveLength(3);
  });

  it("a replacement spawned far away joins the formation without the rest ever breaking tightness unnecessarily", () => {
    const world = new SquadWorld(BLOCK_2X2, openRooms(ROOM));
    world.addMember({ role: "drainAttacker", x: 25, y: 25, room: ROOM });
    world.addMember({ role: "drainHealer", x: 26, y: 25, room: ROOM });
    world.addMember({ role: "drainHealer", x: 25, y: 26, room: ROOM });
    // Only 3 members at first — the 4th (a fresh spawn) joins mid-run.

    const anchor = { x: 25, y: 25, room: ROOM };
    // Goal == anchor so the tight 3-member block has nowhere to advance to — see the degraded-formation
    // test above for why a moving anchor would invalidate this test's later fixed-anchor assertions.
    const goal = anchor;
    const before = world.step(anchor, goal);
    expect(before.tight).toBe(true); // 3-member degraded formation, already tight

    world.addMember({ role: "drainHealer", x: 40, y: 40, room: ROOM }); // replacement, far from the block
    const afterJoin = world.step(anchor, goal);
    expect(afterJoin.tight).toBe(false); // now 4 members, one off-slot — correctly no longer tight

    const converged = world.run(60, () => ({ anchor, goal }));
    expect(converged.some(e => e.tight), `replacement never joined:\n${world.describeLog()}`).toBe(true);
  });
});
