// Formation evasion: a tight squad routing around BOTH terrain obstacles and live bystander creeps, using
// the occupancy-aware planSquadMove/nearestFittingAnchor/findSquadPath wired up this session (OccupancySource,
// src/lib/squadPath.ts; drainRoomOccupancy, src/snapshot/types.ts; Drain.occupancy(), src/operations/drain.ts)
// — this closes the pathing half of docs/drain-squad-handoff.md's open issue #2 ("Squad-vs-bystander-creep
// tile occupancy is unhandled... a fit that's terrain-valid but currently occupied by a non-square creep is
// still treated as reachable"). SquadWorld's occupancy() (squadWorld.ts) mirrors Drain.occupancy()'s exact
// production contract: every bystander tile reads as occupied, but the squad's OWN member tiles are always
// excluded so a formation never reads itself as blocking its own current slots.

import { beforeEach, describe, expect, it } from "vitest";
import type { Formation } from "../../../../src/lib/formation";
import { range } from "../../../../src/lib/geometry";
import type { TerrainSource } from "../../../../src/lib/squadPath";
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

function tightSquad(world: SquadWorld, anchor: { x: number; y: number; room: string }) {
  const off = [
    { dx: 0, dy: 0, role: "drainAttacker" },
    { dx: 1, dy: 0, role: "drainHealer" },
    { dx: 0, dy: 1, role: "drainHealer" },
    { dx: 1, dy: 1, role: "drainHealer" }
  ];
  return off.map(o => world.addMember({ role: o.role, x: anchor.x + o.dx, y: anchor.y + o.dy, room: anchor.room }));
}

describe("Squad evasion: terrain and live-creep obstacles", () => {
  it("routes around a WALL, never placing any member on it (terrain-only baseline, no bystanders involved)", () => {
    // A wall spanning the room's whole width just south of the squad's straight-line path, with a gap it
    // must route through — confirms the formation actually detours rather than just holding forever.
    const wallTerrain = new Uint8Array(2500).fill(1);
    for (let x = 0; x <= 49; x++) {
      if (x >= 20 && x <= 22) continue; // a gap in the wall
      wallTerrain[x * 50 + 15] = 0;
    }
    const terrain: TerrainSource = room => (room === ROOM ? wallTerrain : undefined);

    const world = new SquadWorld(BLOCK_2X2, terrain);
    tightSquad(world, { x: 25, y: 25, room: ROOM });
    const goal = { x: 25, y: 5, room: ROOM };

    const log = world.run(60, w => {
      const attacker = w.members.find(m => m.role === "drainAttacker")!;
      return { anchor: { x: attacker.x, y: attacker.y, room: attacker.room }, facing: TOP, goal };
    });

    for (const entry of log) {
      for (const p of entry.positions) {
        expect(wallTerrain[p.x * 50 + p.y], `member placed on a wall tile at tick ${entry.tick}:\n${world.describeLog()}`).not.toBe(0);
      }
    }
    const finalAttacker = world.members.find(m => m.role === "drainAttacker")!;
    expect(finalAttacker.y, `squad never made it past the wall:\n${world.describeLog()}`).toBeLessThan(15);
  });

  it("routes AROUND a stationary bystander creep blocking the direct path, rather than parking on it forever", () => {
    // Open terrain everywhere — the ONLY obstacle is a bystander sitting directly on the squad's straight-
    // line route to the goal. Before this session's occupancy wiring, planSquadMove/nearestFittingAnchor
    // were terrain-only and would have walked the squad up to the bystander's tile and held there
    // indefinitely (handoff open issue #2's confirmed-live failure mode).
    const world = new SquadWorld(BLOCK_2X2, openRooms(ROOM));
    tightSquad(world, { x: 25, y: 25, room: ROOM });
    const goal = { x: 25, y: 5, room: ROOM };
    // Squarely in the middle of the straight-line path, wide enough to actually block the 2x2 footprint at
    // every axis-aligned facing if the squad tried to walk straight through it.
    world.addBystander({ id: "frozenDefender", x: 25, y: 15, room: ROOM });
    world.addBystander({ id: "frozenDefender2", x: 26, y: 15, room: ROOM });

    const log = world.run(60, w => {
      const attacker = w.members.find(m => m.role === "drainAttacker")!;
      return { anchor: { x: attacker.x, y: attacker.y, room: attacker.room }, facing: TOP, goal };
    });

    // No member ever occupies the bystanders' own tiles.
    const blockedTiles = new Set(world.bystanders.map(b => `${b.x},${b.y}`));
    for (const entry of log) {
      for (const p of entry.positions) {
        expect(blockedTiles.has(`${p.x},${p.y}`), `member walked onto a bystander's tile at tick ${entry.tick}:\n${world.describeLog()}`).toBe(false);
      }
    }
    // And it actually got past the obstacle, not just held short of it forever.
    const finalAttacker = world.members.find(m => m.role === "drainAttacker")!;
    expect(finalAttacker.y, `squad never routed past the bystanders:\n${world.describeLog()}`).toBeLessThan(15);
  });

  it("stays welded (mutual range 1) while detouring around a bystander, never splaying apart mid-evasion", () => {
    const world = new SquadWorld(BLOCK_2X2, openRooms(ROOM));
    tightSquad(world, { x: 25, y: 25, room: ROOM });
    const goal = { x: 25, y: 5, room: ROOM };
    world.addBystander({ id: "hostile1", x: 25, y: 15, room: ROOM });
    world.addBystander({ id: "hostile2", x: 26, y: 15, room: ROOM });

    const log = world.run(60, w => {
      const attacker = w.members.find(m => m.role === "drainAttacker")!;
      return { anchor: { x: attacker.x, y: attacker.y, room: attacker.room }, facing: TOP, goal };
    });

    for (const entry of log) {
      for (let i = 0; i < entry.positions.length; i++) {
        for (let j = 0; j < entry.positions.length; j++) {
          if (i === j) continue;
          expect(range(entry.positions[i], entry.positions[j]), `not welded while evading at tick ${entry.tick}:\n${world.describeLog()}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("a squad's own members are never treated as blocking themselves (occupancy excludes the squad's own tiles)", () => {
    // Regression guard for occupancy()'s own exclusion rule (mirrors Drain.occupancy()'s production
    // wrapper): without it, EVERY tight squad would immediately read its own 4 occupied tiles as unfit and
    // nearestFittingAnchor would send it fleeing its own position on tick one.
    const world = new SquadWorld(BLOCK_2X2, openRooms(ROOM));
    tightSquad(world, { x: 25, y: 25, room: ROOM });
    // Goal == anchor (no advance incentive) — isolates whether the squad holds tight vs. spuriously flees.
    const anchor = { x: 25, y: 25, room: ROOM };
    const entry = world.step(anchor, TOP, anchor);
    expect(entry.tight, `squad treated its own tiles as occupied and broke formation:\n${world.describeLog()}`).toBe(true);
    // And it genuinely held at its own current slots rather than fleeing to some other fitting tile.
    const anchorMember = entry.positions.find(p => p.role === "drainAttacker")!;
    expect(anchorMember.x).toBe(25);
    expect(anchorMember.y).toBe(25);
  });

  it("evades BOTH a wall and a bystander creep together in the same route", () => {
    // A wall with a gap, PLUS a bystander sitting right in the gap — the squad must find an entirely
    // different route (or wait/reroute), never treating the gap as clear just because terrain alone allows it.
    const wallTerrain = new Uint8Array(2500).fill(1);
    for (let x = 0; x <= 49; x++) {
      if (x >= 20 && x <= 24) continue; // a wider gap this time, to leave room for a detour around the bystander
      wallTerrain[x * 50 + 15] = 0;
    }
    const terrain: TerrainSource = room => (room === ROOM ? wallTerrain : undefined);
    const world = new SquadWorld(BLOCK_2X2, terrain);
    tightSquad(world, { x: 25, y: 25, room: ROOM });
    const goal = { x: 22, y: 5, room: ROOM };
    // Sits right in the middle of the gap.
    world.addBystander({ id: "gateGuard", x: 22, y: 15, room: ROOM });

    const log = world.run(80, w => {
      const attacker = w.members.find(m => m.role === "drainAttacker")!;
      return { anchor: { x: attacker.x, y: attacker.y, room: attacker.room }, facing: TOP, goal };
    });

    for (const entry of log) {
      for (const p of entry.positions) {
        expect(wallTerrain[p.x * 50 + p.y], `on a wall at tick ${entry.tick}:\n${world.describeLog()}`).not.toBe(0);
        expect(p.x === 22 && p.y === 15, `on the bystander's tile at tick ${entry.tick}:\n${world.describeLog()}`).toBe(false);
      }
    }
    const finalAttacker = world.members.find(m => m.role === "drainAttacker")!;
    expect(finalAttacker.y, `squad never got past both obstacles:\n${world.describeLog()}`).toBeLessThan(15);
  });
});
