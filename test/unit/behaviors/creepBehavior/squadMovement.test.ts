// Squad movement: does a tight formation actually advance toward a goal, stay welded while doing so, obey
// fatigue gating, and follow a MOVING goal (a flag being walked toward, or dragged) rather than only ever
// converging on one fixed point? The anchor here is recomputed from the squad's OWN live positions every
// tick via SquadWorld.run()'s plan callback — a test-harness convenience, NOT what production does anymore:
// Drain's real squadState() reads a PERSISTED anchor (ColonyMemory.drainAnchor) in steady state, only ever
// falling back to a live-position derivation at first assembly (see operations/drain.ts's squadState doc).
// Re-deriving from live positions every tick happens to track the SAME value the persisted anchor would
// (both mean "where the tight block's anchor slot ended up"), so this shortcut is a faithful enough
// stand-in for what this test needs — same reasoning squadLockstep.test.ts's advance test documents.
// There is no facing concept anywhere in this harness or in production anymore — the formation's box never
// rotates (see lib/formation.ts's module header), so nothing needs to be derived or tracked for it here.

import { beforeEach, describe, expect, it } from "vitest";
import type { Formation } from "../../../../src/lib/formation";
import { range, type XY } from "../../../../src/lib/geometry";
import { clearSquadMatrixCache } from "../../../../src/lib/squadCostMatrix";
import { clearTiles, stubPathFinderSingleRoom } from "../../../constants";
import { openRooms, SquadWorld } from "./squadWorld";

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

/** The full per-tick plan SquadWorld.run() needs: the live anchor slot's tile — the attacker's own position
 * when alive (mirrors Drain.anchorTile's attacker-is-the-anchor-slot rule), else the first surviving
 * member's tile. */
function livePlan(world: SquadWorld, goal: XY & { room: string }): { anchor: XY & { room: string }; goal: XY & { room: string } } {
  const attacker = world.members.find(m => m.role === "drainAttacker");
  const ref = attacker ?? world.members[0];
  const anchor = { x: ref.x, y: ref.y, room: ref.room };
  return { anchor, goal };
}

function tightSquad(world: SquadWorld, room = ROOM) {
  world.addMember({ role: "drainAttacker", x: 25, y: 25, room });
  world.addMember({ role: "drainHealer", x: 26, y: 25, room });
  world.addMember({ role: "drainHealer", x: 25, y: 26, room });
  world.addMember({ role: "drainHealer", x: 26, y: 26, room });
}

describe("Squad movement", () => {
  it("a tight formation advances toward a fixed goal, staying welded (mutual range 1) every tick", () => {
    const world = new SquadWorld(BLOCK_2X2, openRooms(ROOM));
    tightSquad(world);
    const goal = { x: 25, y: 5, room: ROOM };

    const log = world.run(30, w => livePlan(w, goal));

    // Every tick, every pair of members must stay within range 1 of each other — the "never lets the
    // formation splay apart during transit" contract the whole ADR 0007 redesign exists to guarantee.
    for (const entry of log) {
      for (let i = 0; i < entry.positions.length; i++) {
        for (let j = 0; j < entry.positions.length; j++) {
          if (i === j) continue;
          expect(range(entry.positions[i], entry.positions[j]), `not welded at tick ${entry.tick}:\n${world.describeLog()}`).toBeLessThanOrEqual(1);
        }
      }
    }
    // And it must have made real progress toward the goal (not just held in place for 30 ticks).
    const attackerStart = { x: 25, y: 25 };
    const attackerEnd = world.members.find(m => m.role === "drainAttacker")!;
    expect(attackerEnd.y, `no progress toward goal:\n${world.describeLog()}`).toBeLessThan(attackerStart.y);
  });

  it("follows a moving goal (a flag being walked toward) rather than converging on the goal's original position", () => {
    const world = new SquadWorld(BLOCK_2X2, openRooms(ROOM));
    tightSquad(world);
    // The "flag" starts far south and walks steadily north-west, one tile per tick — the squad must chase
    // its CURRENT position each tick, not path toward wherever it started.
    let flag = { x: 40, y: 40, room: ROOM };
    const flagHistory: XY[] = [];

    world.run(25, w => {
      flag = { x: Math.max(5, flag.x - 1), y: Math.max(5, flag.y - 1), room: ROOM };
      flagHistory.push({ ...flag });
      return livePlan(w, flag);
    });

    // The attacker's final distance to the flag's FINAL position must be small — it actually chased the
    // moving target, not the flag's tick-1 starting point (25 tiles away from where the squad started).
    const attackerEnd = world.members.find(m => m.role === "drainAttacker")!;
    const finalDistToFlag = range(attackerEnd, flag);
    expect(finalDistToFlag, `squad did not track the moving flag:\n${world.describeLog()}\nflag path: ${JSON.stringify(flagHistory)}`).toBeLessThan(10);
    // Sanity: it got measurably closer to the flag's terminal position than it started.
    const startDistToFinalFlag = range({ x: 25, y: 25 }, flag);
    expect(finalDistToFlag).toBeLessThan(startDistToFinalFlag);
  });

  it("holds every member's position while any one member is fatigued, even mid-advance", () => {
    const world = new SquadWorld(BLOCK_2X2, openRooms(ROOM));
    tightSquad(world);
    const goal = { x: 25, y: 5, room: ROOM };

    // Advance a few ticks normally first.
    world.run(5, w => livePlan(w, goal));
    const beforeFatigue = world.members.map(m => ({ id: m.id, x: m.x, y: m.y }));

    // Fatigue one healer, then run several more ticks — the WHOLE block (not just the fatigued member)
    // must hold in place, per planSquadMove's fatigue-gates-the-whole-advance rule.
    const someHealer = world.members.find(m => m.role === "drainHealer")!.id;
    world.setFatigue(someHealer, 2);
    const fatiguedLog = world.run(4, w => livePlan(w, goal));

    for (const m of beforeFatigue) {
      const now = world.members.find(mm => mm.id === m.id)!;
      expect([now.x, now.y], `member ${m.id} moved while squad was fatigued:\n${world.describeLog()}`).toEqual([m.x, m.y]);
    }
    expect(fatiguedLog.every(e => e.tight)).toBe(true); // held, not scattered — still a tight (stationary) block

    // Clear the fatigue and confirm it resumes advancing.
    world.setFatigue(someHealer, 0);
    world.run(10, w => livePlan(w, goal));
    const attackerNow = world.members.find(m => m.role === "drainAttacker")!;
    const attackerBefore = beforeFatigue.find(m => m.id === attackerNow.id)!;
    expect(attackerNow.y, `squad never resumed advancing after fatigue cleared:\n${world.describeLog()}`).toBeLessThan(attackerBefore.y);
  });

  it("a degraded (3-member) squad still advances toward the goal in lockstep after losing the attacker", () => {
    const world = new SquadWorld(BLOCK_2X2, openRooms(ROOM));
    tightSquad(world);
    const goal = { x: 25, y: 5, room: ROOM };
    world.run(5, w => livePlan(w, goal));

    const attacker = world.members.find(m => m.role === "drainAttacker")!;
    const beforeLoss = world.members.filter(m => m.id !== attacker.id).map(m => ({ id: m.id, y: m.y }));
    world.kill(attacker.id);

    const log = world.run(20, w => livePlan(w, goal));
    expect(log.some(e => e.tight), `degraded squad never reformed tight:\n${world.describeLog()}`).toBe(true);
    for (const before of beforeLoss) {
      const now = world.members.find(m => m.id === before.id)!;
      expect(now.y, `survivor ${before.id} made no progress after losing the attacker:\n${world.describeLog()}`).toBeLessThan(before.y);
    }
  });
});
