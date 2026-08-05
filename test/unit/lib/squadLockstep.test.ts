// Regression coverage for the specific live-observed failure ADR 0007 replaces: four squad members
// pathing INDEPENDENTLY drifted apart over real distance (~1 tile per 10-15 ticks, healers out of heal
// range, formation oscillating every tick — see docs/drain-squad-handoff.md). The redesign's core claim
// is that planSquadMove produces ONE shared plan that keeps the whole formation welded by construction.
// This test drives planSquadMove over a real multi-tile advance, applying each tick's plan to move the
// creeps, and asserts the block stays a tight mutual-range-1 formation EVERY tick — not just that the
// individual mechanisms work in isolation.

import { describe, expect, it } from "vitest";
import { planSquadMove, type SquadState } from "../../../src/lib/squad";
import { slotTiles, type Formation } from "../../../src/lib/formation";
import { range, type XY } from "../../../src/lib/geometry";
import { snapCreep } from "../../fixtures";
import type { SnapCreep } from "../../../src/snapshot/types";

const BLOCK_2X2: Formation = [
  { dx: 0, dy: 0, role: "drainAttacker" },
  { dx: 1, dy: 0, role: "drainHealer" },
  { dx: 0, dy: 1, role: "drainHealer" },
  { dx: 1, dy: 1, role: "drainHealer" }
];

function openTerrain(): Uint8Array {
  return new Uint8Array(2500).fill(1);
}

// Move each creep one tile toward its plan destination (a MOVE-per-part squad body covers one tile/tick),
// clamped to a single step — the same physical constraint the live engine imposes.
function step(pos: XY, to: XY): XY {
  return { x: pos.x + Math.sign(to.x - pos.x), y: pos.y + Math.sign(to.y - pos.y) };
}

function mutualRangeOne(positions: readonly XY[]): boolean {
  for (let i = 0; i < positions.length; i++) {
    for (let j = 0; j < positions.length; j++) {
      if (i === j) continue;
      if (range(positions[i], positions[j]) > 1) return false;
    }
  }
  return true;
}

describe("planSquadMove keeps the formation welded over real distance (regression)", () => {
  it("advances a 2x2 across ~20 tiles without the block ever splaying past mutual range 1", () => {
    const room = "W2N1";
    const terrain = (r: string) => (r === room ? openTerrain() : undefined);

    // Start as a tight, in-formation 2x2 with the anchor at (25,40); advance toward (25,15) — a 25-tile
    // straight push, the exact scale the independent-pathing model fell apart over.
    let anchor: XY = { x: 25, y: 40 };
    const facing: DirectionConstant = TOP;
    const tiles = slotTiles({ ...anchor, room }, facing, BLOCK_2X2);
    let creeps: SnapCreep[] = tiles.map((t, i) =>
      snapCreep(i === 0 ? "drainAttacker" : "drainHealer", { room, x: t.x, y: t.y, memory: { op: "drain:W1N1" } })
    );

    const goal = { x: 25, y: 15, room };
    let advanced = 0;

    for (let tick = 0; tick < 80; tick++) {
      const state: SquadState = { members: creeps, formation: BLOCK_2X2, anchor: { ...anchor, room }, facing };
      const intents = planSquadMove(state, goal, terrain);

      // Apply the plan: every member steps one tile toward its assigned destination.
      creeps = creeps.map(c => {
        const intent = intents.find(i => i.creep === c.id)!;
        const p = step({ x: c.x, y: c.y }, intent.to);
        return { ...c, x: p.x, y: p.y };
      });

      // The invariant under test: after applying the shared plan, the four members are STILL a tight
      // mutual-range-1 block — never drifting apart the way independent pathing did.
      expect(mutualRangeOne(creeps.map(c => ({ x: c.x, y: c.y })))).toBe(true);

      // Re-derive the anchor slot's tile from the attacker (slot index 0) so the next tick's plan tracks
      // the formation as it actually moved — mirroring how Drain recomputes anchor from the live squad.
      const attacker = creeps[0];
      if (attacker.y < anchor.y) advanced++;
      anchor = { x: attacker.x, y: attacker.y };

      if (anchor.y <= goal.y) break;
    }

    // It actually made real progress toward the goal (not stalled crawling ~1 tile per 10-15 ticks).
    expect(advanced).toBeGreaterThanOrEqual(20);
    expect(anchor.y).toBeLessThanOrEqual(goal.y + 1);
  });

  it("recovers a member that starts displaced without the rest of the block scattering to chase it", () => {
    const room = "W2N1";
    const terrain = (r: string) => (r === room ? openTerrain() : undefined);

    // Three members tight, one healer displaced 4 tiles away — the "straggler" scenario. The plan must
    // hold the anchor and bring the straggler in, never send the tight members off to chase it.
    let creeps: SnapCreep[] = [
      snapCreep("drainAttacker", { room, x: 25, y: 25, memory: { op: "drain:W1N1" } }),
      snapCreep("drainHealer", { room, x: 26, y: 25, memory: { op: "drain:W1N1" } }),
      snapCreep("drainHealer", { room, x: 25, y: 26, memory: { op: "drain:W1N1" } }),
      snapCreep("drainHealer", { room, x: 29, y: 29, memory: { op: "drain:W1N1" } }) // displaced
    ];
    const anchor = { x: 25, y: 25, room };

    let converged = false;
    for (let tick = 0; tick < 15; tick++) {
      const state: SquadState = { members: creeps, formation: BLOCK_2X2, anchor, facing: TOP };
      const intents = planSquadMove(state, { x: 25, y: 15, room }, terrain);
      creeps = creeps.map(c => {
        const intent = intents.find(i => i.creep === c.id)!;
        const p = step({ x: c.x, y: c.y }, intent.to);
        return { ...c, x: p.x, y: p.y };
      });
      // The three already-tight members never wander off their block (anchor stays put) while reforming.
      expect(creeps[0].x).toBe(25);
      expect(creeps[0].y).toBe(25);
      if (mutualRangeOne(creeps.map(c => ({ x: c.x, y: c.y })))) {
        converged = true;
        break;
      }
    }
    expect(converged).toBe(true);
  });
});
