// Squad border-crossing: the specific class of bug the drain-squad handoff session found by watching a
// live squad cross a real room border (docs/drain-squad-handoff.md) — cross-border slot placement, footprint
// fit spanning two rooms' terrain, and a squad correctly recognizing its own facing once it has crossed.
// Everything here drives the REAL planSquadMove/slotTiles/findSquadPath across a two-room SquadWorld with
// full per-tick position logging (world.describeLog()), so a regression shows exactly which tick and tile
// it happened at — not just "some assertion failed somewhere in a 500-tick pserver run" (how these bugs
// were originally found, per the handoff's opening paragraph).
//
// NOT covered here (deliberately, per the handoff): moveToRoom border-oscillation (bug #1), the heal-step
// movement lockout (bug #2), and room-name rally chasing (bug #3) — those live in behaviors/interpreter.ts
// and operations/drain.ts's per-creep step table BEFORE a creep ever comes under squad control, outside
// planSquadMove's pure boundary that SquadWorld exercises. See interpreter.test.ts for #1/#2 and
// drain.test.ts for #3's moveToPos/drainRallyPos coverage.

import { describe, expect, it } from "vitest";
import { inFormation } from "../../../../src/lib/squad";
import { slotTiles, type Formation } from "../../../../src/lib/formation";
import { worldOf } from "../../../../src/lib/geometry";
import type { TerrainSource } from "../../../../src/lib/squadPath";
import { SquadWorld } from "./squadWorld";

const BLOCK_2X2: Formation = [
  { dx: 0, dy: 0, role: "drainAttacker" },
  { dx: 1, dy: 0, role: "drainHealer" },
  { dx: 0, dy: 1, role: "drainHealer" },
  { dx: 1, dy: 1, role: "drainHealer" }
];

// Two adjacent rooms, W2N1 west of W1N1 (W2N1's east edge x=49 touches W1N1's west edge x=0) — all-plains
// on both sides, so any failure is purely about the border math, not terrain blocking.
function twoOpenRooms(): TerrainSource {
  const plains = new Uint8Array(2500).fill(1);
  return room => (room === "W2N1" || room === "W1N1" ? plains : undefined);
}

// Places a tight squad at TOP-facing slot tiles (BLOCK_2X2's offsets are defined at the canonical TOP
// facing — see formation.ts) so it starts genuinely welded; an eastward crossing then needs findSquadPath's
// own reform-edge search to turn it toward RIGHT, exactly like production (see currentFacing() in
// operations/drain.ts) rather than a test asserting a facing the block was never actually placed at.
function tightSquadAt(world: SquadWorld, anchor: { x: number; y: number; room: string }) {
  const off = [
    { dx: 0, dy: 0, role: "drainAttacker" },
    { dx: 1, dy: 0, role: "drainHealer" },
    { dx: 0, dy: 1, role: "drainHealer" },
    { dx: 1, dy: 1, role: "drainHealer" }
  ];
  return off.map(o => world.addMember({ role: o.role, x: anchor.x + o.dx, y: anchor.y + o.dy, room: anchor.room }));
}

// The AXIS-ALIGNED facing the squad's LIVE positions already sit tight at, if any (mirrors
// operations/drain.ts's currentFacing — a strict 2x2 only has 4 valid mutual-range-1 orientations), falling
// back to whichever axis-aligned facing best matches the travel direction toward `goal` when the block
// isn't currently tight at any of them (mirrors drainFacing). Used by every crossing test below so the
// plan never asserts a facing the live block doesn't actually match — the exact bug class #6 in the handoff.
function liveFacingToward(world: SquadWorld, anchor: { x: number; y: number; room: string }, goal: { x: number; y: number }): DirectionConstant {
  const axisFacings: DirectionConstant[] = [TOP, RIGHT, BOTTOM, LEFT];
  for (const f of axisFacings) {
    if (inFormation(world.state(anchor, f).members, slotTiles(anchor, f, BLOCK_2X2))) return f;
  }
  const dx = goal.x - anchor.x;
  const dy = goal.y - anchor.y;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? RIGHT : LEFT) : dy > 0 ? BOTTOM : TOP;
}

describe("Squad border crossing", () => {
  it("crosses a room border and ends up fully inside the new room, never on an out-of-range tile", () => {
    // Anchor starts a few tiles from the border (W2N1's x=49 edge), goal is deep inside the neighboring
    // room — mirrors bug #7's live scenario (a squad's anchor sitting at/near x=49 with a trailing slot).
    const world = new SquadWorld(BLOCK_2X2, twoOpenRooms());
    tightSquadAt(world, { x: 46, y: 25, room: "W2N1" });
    const goal = { x: 10, y: 25, room: "W1N1" };

    const log = world.run(40, w => {
      const attacker = w.members.find(m => m.role === "drainAttacker")!;
      const anchor = { x: attacker.x, y: attacker.y, room: attacker.room };
      return { anchor, facing: liveFacingToward(w, anchor, goal), goal };
    });

    // No position ever falls outside 0..49 — the exact crash mode bug #7 caused (RoomPosition's
    // constructor throwing on out-of-range x/y, killing the whole tick's creep loop).
    for (const entry of log) {
      for (const p of entry.positions) {
        expect(p.x, `out-of-range x at tick ${entry.tick}:\n${world.describeLog()}`).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(49);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(49);
      }
    }
    // And it actually made it across — every member ends up in the target room, not stuck straddling.
    const final = log[log.length - 1];
    expect(final.positions.every(p => p.room === "W1N1"), `squad never fully crossed:\n${world.describeLog()}`).toBe(true);
  });

  it("stays genuinely welded (world-coordinate mutual range 1) even while straddling two rooms mid-crossing", () => {
    // While the anchor is crossing, the block can legitimately straddle both rooms for a tile or two (two
    // members still in W2N1's x=49, two already in W1N1's x=0 — a REAL mutual-range-1 adjacency across the
    // border, not a bug). What must never happen is slotTiles/planSquadMove producing a mix of STALE-room
    // local coordinates that only LOOKS adjacent numerically (e.g. two members both reading x=0 but one
    // genuinely in W1N1 and the other mislabeled from W2N1) — so this checks real cross-room world distance
    // (geometry.ts's worldOf lattice), not same-room membership, which straddling can legitimately violate.
    const world = new SquadWorld(BLOCK_2X2, twoOpenRooms());
    tightSquadAt(world, { x: 47, y: 25, room: "W2N1" });
    const goal = { x: 5, y: 25, room: "W1N1" };

    const log = world.run(30, w => {
      const attacker = w.members.find(m => m.role === "drainAttacker")!;
      const anchor = { x: attacker.x, y: attacker.y, room: attacker.room };
      return { anchor, facing: liveFacingToward(w, anchor, goal), goal };
    });

    for (const entry of log) {
      if (!entry.tight) continue;
      const world_ = entry.positions.map(p => worldOf(p.x, p.y, p.room));
      for (let i = 0; i < world_.length; i++) {
        for (let j = 0; j < world_.length; j++) {
          if (i === j) continue;
          const d = Math.max(Math.abs(world_[i].wx - world_[j].wx), Math.abs(world_[i].wy - world_[j].wy));
          expect(d, `not genuinely welded across rooms at tick ${entry.tick}:\n${world.describeLog()}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("slotTiles resolves a border-straddling anchor into valid neighboring-room coordinates (no throw, no overflow)", () => {
    // Direct unit-level check (no SquadWorld ticking needed) that the border-adjacent anchor case from bug
    // #7 stays fixed: an anchor at the room's own edge with a trailing slot offset must land in the
    // NEIGHBORING room's local coords, never produce x/y outside 0..49. Uses the CANONICAL TOP facing —
    // BLOCK_2X2's offsets are defined at TOP with dx=+1 trailing slots (see formation.ts), so TOP is the
    // facing that actually pushes a slot east past x=49 into the next room; a rotated facing like RIGHT
    // turns those same offsets (a 90-degree clockwise rotation, not a translation — see rotateOffset) into
    // a shape that stays within the anchor's own room instead.
    const anchor = { x: 49, y: 25, room: "W2N1" };
    expect(() => slotTiles(anchor, TOP, BLOCK_2X2)).not.toThrow();
    const slots = slotTiles(anchor, TOP, BLOCK_2X2);
    for (const s of slots) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(49);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(49);
    }
    // At least one slot should have actually crossed into W1N1 (the +1 x-offset trailing slots push past
    // x=49) — confirming this exercises the border case at all, not accidentally staying put.
    expect(slots.some(s => s.room === "W1N1")).toBe(true);
  });

  it("a squad approaching the border from a diagonal keeps footprint-fit across BOTH rooms' terrain, not just its origin room's", () => {
    // A wall placed in the DESTINATION room right at the border crossing point — the footprint check must
    // consult the destination room's terrain even while the anchor is still in the origin room (findSquadPath
    // walks world coordinates and resolves per-tile terrain via roomAndLocal, not per-room in isolation).
    const plains = new Uint8Array(2500).fill(1);
    const wallNearBorder = new Uint8Array(2500).fill(1);
    wallNearBorder[0 * 50 + 25] = 0; // wall at W1N1 (0,25) — directly across the border from W2N1 (49,25)
    wallNearBorder[0 * 50 + 26] = 0;
    wallNearBorder[1 * 50 + 25] = 0;
    wallNearBorder[1 * 50 + 26] = 0;
    const terrain: TerrainSource = room => (room === "W2N1" ? plains : room === "W1N1" ? wallNearBorder : undefined);

    const world = new SquadWorld(BLOCK_2X2, terrain);
    tightSquadAt(world, { x: 46, y: 25, room: "W2N1" });
    const goal = { x: 5, y: 25, room: "W1N1" };

    const log = world.run(30, w => {
      const attacker = w.members.find(m => m.role === "drainAttacker")!;
      const anchor = { x: attacker.x, y: attacker.y, room: attacker.room };
      return { anchor, facing: liveFacingToward(w, anchor, goal), goal };
    });

    // The squad must never place a member on the walled tiles just across the border, regardless of
    // whether it finds a way around or holds — the destination room's terrain must be honored.
    for (const entry of log) {
      for (const p of entry.positions) {
        if (p.room !== "W1N1") continue;
        const blocked = (p.x === 0 || p.x === 1) && (p.y === 25 || p.y === 26);
        expect(blocked, `member placed on walled destination tile at tick ${entry.tick}:\n${world.describeLog()}`).toBe(false);
      }
    }
  });

  it("recognizes itself as tight in whichever axis-aligned facing its LIVE cross-border positions actually match", () => {
    // Mirrors operations/drain.ts's currentFacing(): a squad that ends up welded in a RIGHT-facing block
    // (having turned to face its crossing direction) must be recognized as tight when checked against
    // RIGHT, not just the canonical TOP — this is the generic inFormation/slotTiles machinery bug #6's fix
    // relies on, exercised here across an actual border rather than a single-room fixture.
    const anchor = { x: 48, y: 25, room: "W2N1" };
    const rightSlots = slotTiles(anchor, RIGHT, BLOCK_2X2);
    // Manually place members exactly on the RIGHT-facing slots (simulating a squad that already turned).
    const world = new SquadWorld(BLOCK_2X2, twoOpenRooms());
    const roleAt = new Map(rightSlots.map(s => [`${s.x},${s.y},${s.room}`, s.role]));
    for (const s of rightSlots) world.addMember({ role: roleAt.get(`${s.x},${s.y},${s.room}`)!, x: s.x, y: s.y, room: s.room });

    const state = world.state(anchor, RIGHT);
    expect(inFormation(state.members, rightSlots)).toBe(true);
    // And explicitly NOT tight against the canonical TOP facing's slots (a different, non-matching shape)
    // at the same anchor — confirms the check is genuinely facing-sensitive, not vacuously true.
    const topSlots = slotTiles(anchor, TOP, BLOCK_2X2);
    expect(inFormation(state.members, topSlots)).toBe(false);
  });
});
