// The full squad lifecycle across THREE rooms, mirroring operations/drain.ts's real assembly model
// (Drain.squadState()'s doc: "assembling" members rally independently via their own step table; only once
// physically together does the generic Squad machinery take over) and ADR 0006's staging-room design:
//
//   Room A (home)  -- each member walks independently, no squad coordination --> Room B (staging/anchor)
//   Room B          -- once all 4 are physically together, the squad FORMS -->  (tight 2x2)
//   Room B -> Room C -- now squad-controlled, crosses the B/C border IN FORMATION -->  Room C
//
// This is the scenario the handoff's "assembling vs squadded" split exists for but nothing previously
// exercised end-to-end: squadFormation.test.ts starts creeps already inside the anchor room, and
// squadBorderCrossing.test.ts starts them already tight. Here the SAME 4 creeps walk in from a third room
// with zero squad coordination, assemble, and only THEN cross a second border under planSquadMove.

import { describe, expect, it } from "vitest";
import { slotTiles, type Formation } from "../../../../src/lib/formation";
import { inFormation } from "../../../../src/lib/squad";
import type { TerrainSource } from "../../../../src/lib/squadPath";
import { SquadWorld } from "./squadWorld";

const BLOCK_2X2: Formation = [
  { dx: 0, dy: 0, role: "drainAttacker" },
  { dx: 1, dy: 0, role: "drainHealer" },
  { dx: 0, dy: 1, role: "drainHealer" },
  { dx: 1, dy: 1, role: "drainHealer" }
];

// Three rooms in a row: A - B - B's east border touches C. All-plains, so the lifecycle's own logic is
// what's under test, not terrain incidentally blocking something.
const ROOM_A = "W3N1";
const ROOM_B = "W2N1"; // the staging/anchor room
const ROOM_C = "W1N1";

function threeOpenRooms(): TerrainSource {
  const plains = new Uint8Array(2500).fill(1);
  const set = new Set([ROOM_A, ROOM_B, ROOM_C]);
  return room => (set.has(room) ? plains : undefined);
}

describe("Squad staging lifecycle: independent rally -> formation -> squadded border crossing", () => {
  it("walks in independently from room A, assembles into a tight formation in room B, then crosses into room C in formation", () => {
    const world = new SquadWorld(BLOCK_2X2, threeOpenRooms());

    // Four members start scattered in room A — far enough apart that they are NOT remotely tight, and far
    // from the eventual anchor tile in room B, mirroring real spawned creeps trickling out one at a time.
    const attacker = world.addMember({ role: "drainAttacker", x: 10, y: 40, room: ROOM_A });
    const h1 = world.addMember({ role: "drainHealer", x: 30, y: 5, room: ROOM_A });
    const h2 = world.addMember({ role: "drainHealer", x: 45, y: 45, room: ROOM_A });
    const h3 = world.addMember({ role: "drainHealer", x: 5, y: 5, room: ROOM_A });
    const allIds = [attacker, h1, h2, h3];

    // Phase 1: rally to a chosen anchor tile in room B, ONE TILE PER TICK EACH, independently — no squad
    // coordination at all (walkIndependently has no notion of the other 3 members). Mirrors production's
    // moveToPos/drainRallyPos: every unsquadded member walks toward the SAME live rally point.
    const rallyAnchor = { x: 25, y: 25, room: ROOM_B };
    const rallySlots = slotTiles(rallyAnchor, TOP, BLOCK_2X2);
    const rallyTargetFor = new Map(
      [attacker, h1, h2, h3].map((id, i) => [id, { x: rallySlots[i].x, y: rallySlots[i].y, room: rallySlots[i].room }])
    );

    let assembled = false;
    let phase1Ticks = 0;
    const MAX_PHASE1_TICKS = 200;
    while (!assembled && phase1Ticks < MAX_PHASE1_TICKS) {
      for (const id of allIds) world.walkIndependently(id, rallyTargetFor.get(id)!);
      phase1Ticks++;
      assembled = allIds.every(id => {
        const m = world.members.find(mm => mm.id === id)!;
        const t = rallyTargetFor.get(id)!;
        return m.room === t.room && m.x === t.x && m.y === t.y;
      });
    }
    expect(assembled, `squad never assembled in room B within ${MAX_PHASE1_TICKS} ticks of independent walking`).toBe(true);

    // Confirm the squad is now genuinely tight in room B BEFORE any squad machinery has run even once —
    // this is the "assembling" -> "ready for first push" transition production gates on (squadState()'s
    // readyForFirstPush check).
    const preSquadState = world.state(rallyAnchor, TOP);
    expect(inFormation(preSquadState.members, rallySlots), `not actually tight after independent rally:\n${world.describeLog()}`).toBe(true);

    // Phase 2: NOW hand control to the generic Squad machinery (planSquadMove) — goal is deep in room C, on
    // the far side of the B/C border, so the squad must both stay tight AND cross the border in formation.
    // Facing must be derived from the LIVE positions first (mirrors operations/drain.ts's currentFacing) —
    // the block assembled at TOP (rallySlots above), and a westward goal's travel-direction facing (LEFT)
    // does NOT match that real shape, so asserting LEFT unconditionally would report "not tight" forever
    // even though the squad is genuinely welded (the exact bug class handoff bug #6 fixed in production).
    const goal = { x: 10, y: 25, room: ROOM_C };
    const axisFacings: DirectionConstant[] = [TOP, RIGHT, BOTTOM, LEFT];
    const log = world.run(40, w => {
      const liveAttacker = w.members.find(m => m.role === "drainAttacker")!;
      const anchor = { x: liveAttacker.x, y: liveAttacker.y, room: liveAttacker.room };
      const liveFacing = axisFacings.find(f => inFormation(w.state(anchor, f).members, slotTiles(anchor, f, BLOCK_2X2)));
      const dx = goal.x - anchor.x;
      const dy = goal.y - anchor.y;
      const goalFacing: DirectionConstant = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? RIGHT : LEFT) : dy > 0 ? BOTTOM : TOP;
      return { anchor, facing: liveFacing ?? goalFacing, goal };
    });

    // It must have actually crossed into room C by the end, and never thrown / produced an out-of-range
    // tile along the way (the same border-crossing contract squadBorderCrossing.test.ts checks).
    const final = log[log.length - 1];
    expect(final.positions.every(p => p.room === ROOM_C), `squad never reached room C:\n${world.describeLog()}`).toBe(true);
    for (const entry of log) {
      for (const p of entry.positions) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(49);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(49);
      }
    }
    // And it became tight again at least once under squad control in the new room (not just "technically
    // arrived" while scattered) — the full lifecycle's actual point.
    const tightInC = log.some(e => e.tight && e.positions.every(p => p.room === ROOM_C));
    expect(tightInC, `squad never reformed tight after crossing into room C:\n${world.describeLog()}`).toBe(true);
  });
});
