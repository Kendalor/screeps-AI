// The Squad entity's pure planning seam (ADR 0007): reformAssignment (greedy nearest one-to-one), and
// planSquadMove (one shared plan that moves the whole formation in lockstep). Plain SquadState data in,
// per-member move intents out — no Game, no Colony. planSquadActions' generic signature is exercised
// here with a trivial planner; Drain's real content is tested in the drain suite.

import { describe, expect, it } from "vitest";
import { planSquadActions, planSquadMove, reformAssignment, type SquadState } from "../../../src/lib/squad";
import type { Formation } from "../../../src/lib/formation";
import { range } from "../../../src/lib/geometry";
import { colonySnap, snapCreep } from "../../fixtures";

const BLOCK_2X2: Formation = [
  { dx: 0, dy: 0, role: "drainAttacker" },
  { dx: 1, dy: 0, role: "drainHealer" },
  { dx: 0, dy: 1, role: "drainHealer" },
  { dx: 1, dy: 1, role: "drainHealer" }
];

function openTerrain(): Uint8Array {
  return new Uint8Array(2500).fill(1);
}

const terrain = (room: string) => (room === "W2N1" || room === "W1N1" ? openTerrain() : undefined);

// A 4-member squad, all in room, anchor at (attackerX, attackerY), facing TOP, in the given mode.
function drainSquad(over: {
  facing?: DirectionConstant;
  positions?: { x: number; y: number }[];
  room?: string;
  members?: number;
} = {}): SquadState {
  const room = over.room ?? "W2N1";
  const facing = over.facing ?? TOP;
  const n = over.members ?? 4;
  const roles = ["drainAttacker", "drainHealer", "drainHealer", "drainHealer"] as const;
  const defaults = [
    { x: 25, y: 25 },
    { x: 26, y: 25 },
    { x: 25, y: 26 },
    { x: 26, y: 26 }
  ];
  const members = Array.from({ length: n }, (_, i) => {
    const p = over.positions?.[i] ?? defaults[i];
    return snapCreep(roles[i], { room, x: p.x, y: p.y, memory: { op: "drain:W1N1" } });
  });
  return { members, formation: BLOCK_2X2, anchor: { x: 25, y: 25, room }, facing };
}

describe("reformAssignment", () => {
  it("assigns each member to the nearest available destination tile, one-to-one", () => {
    const members = [
      { id: "a" as Id<Creep>, pos: { x: 10, y: 10 } },
      { id: "b" as Id<Creep>, pos: { x: 12, y: 10 } }
    ];
    const dests = [
      { x: 10, y: 11 },
      { x: 12, y: 11 }
    ];
    const assign = reformAssignment(members, dests);
    expect(assign.get("a" as Id<Creep>)).toEqual({ x: 10, y: 11 }); // a is nearer the left dest
    expect(assign.get("b" as Id<Creep>)).toEqual({ x: 12, y: 11 });
  });

  it("never assigns two members to the same tile (one-to-one, destinations are consumed)", () => {
    const members = [
      { id: "a" as Id<Creep>, pos: { x: 10, y: 10 } },
      { id: "b" as Id<Creep>, pos: { x: 10, y: 10 } } // both start on the same tile
    ];
    const dests = [
      { x: 10, y: 11 },
      { x: 11, y: 11 }
    ];
    const assign = reformAssignment(members, dests);
    const chosen = [assign.get("a" as Id<Creep>), assign.get("b" as Id<Creep>)];
    expect(chosen[0]).not.toEqual(chosen[1]);
  });

  it("resolves the tile-set-unchanged case (2x2 turn) in a single assignment (every member already on a dest)", () => {
    // The 4 members already sit on the 4 destination tiles, just needing to swap roles — a symmetric
    // reform. Greedy assignment maps each to a dest it's already on (distance 0), so no member has to
    // travel: a one-tick resolution, same algorithm as the reshaping case.
    const tiles = [
      { x: 25, y: 25 },
      { x: 26, y: 25 },
      { x: 25, y: 26 },
      { x: 26, y: 26 }
    ];
    const members = tiles.map((t, i) => ({ id: `m${i}` as Id<Creep>, pos: t }));
    const assign = reformAssignment(members, tiles);
    // Every member is assigned to some tile in the set, and every tile is used exactly once.
    const used = [...assign.values()];
    expect(used).toHaveLength(4);
    expect(new Set(used.map(t => `${t.x},${t.y}`)).size).toBe(4);
    // Nobody is assigned a tile it isn't already on (all distance-0) — the symmetric fast case falls out.
    for (const m of members) expect(assign.get(m.id)).toEqual(m.pos);
  });

  it("resolves the partially-different tile-set case (reshape) via the same algorithm, no special-casing", () => {
    // Source tiles a vertical 1x2, destinations a horizontal 1x2 — the tile-sets overlap in one tile.
    const members = [
      { id: "a" as Id<Creep>, pos: { x: 20, y: 20 } },
      { id: "b" as Id<Creep>, pos: { x: 20, y: 21 } }
    ];
    const dests = [
      { x: 20, y: 20 }, // shared tile
      { x: 21, y: 20 }
    ];
    const assign = reformAssignment(members, dests);
    const used = [...assign.values()];
    expect(new Set(used.map(t => `${t.x},${t.y}`)).size).toBe(2); // still one-to-one
    expect(assign.get("a" as Id<Creep>)).toEqual({ x: 20, y: 20 }); // a is already on the shared tile
    expect(assign.get("b" as Id<Creep>)).toEqual({ x: 21, y: 20 }); // b takes the only other dest
  });
});

describe("planSquadMove", () => {
  it("moves every member by (at most) one tile in lockstep when advancing toward the goal", () => {
    // A tight, in-formation 2x2 advancing toward a goal several tiles away. Every member gets exactly one
    // move intent, and each intent is within range 1 of the member's current tile (a single step) — the
    // whole formation advances together, never one member racing ahead.
    const state = drainSquad();
    const intents = planSquadMove(state, { x: 25, y: 20, room: "W2N1" }, terrain);
    expect(intents).toHaveLength(4);
    for (const member of state.members) {
      const intent = intents.find(i => i.creep === member.id);
      expect(intent).toBeDefined();
      expect(range({ x: member.x, y: member.y }, intent!.to)).toBeLessThanOrEqual(1);
      expect(intent!.to.room).toBe("W2N1");
    }
  });

  it("keeps the destination tiles a valid mutual-range-1 block (the whole squad stays welded)", () => {
    const state = drainSquad();
    const intents = planSquadMove(state, { x: 25, y: 20, room: "W2N1" }, terrain);
    const dests = intents.map(i => i.to);
    for (let i = 0; i < dests.length; i++) {
      for (let j = 0; j < dests.length; j++) {
        if (i === j) continue;
        expect(range(dests[i], dests[j])).toBeLessThanOrEqual(1);
      }
    }
  });

  it("holds the formation (assigns members onto slot tiles, does not advance) when a member is out of formation", () => {
    // One healer has drifted far from its slot — the squad is not a tight block. planSquadMove must NOT
    // advance the anchor; instead it assigns each member to its current-facing slot tile so the stragglers
    // close the gap. The anchor slot's member stays on the anchor tile (already there).
    const state = drainSquad({
      positions: [
        { x: 25, y: 25 }, // anchor, in place
        { x: 26, y: 25 },
        { x: 25, y: 26 },
        { x: 40, y: 40 } // straggler, far out of formation
      ]
    });
    const intents = planSquadMove(state, { x: 25, y: 20, room: "W2N1" }, terrain);
    const anchorIntent = intents.find(i => i.creep === state.members[0].id);
    // Anchor holds at its own slot tile — it does not step toward the goal while the block is broken.
    expect(anchorIntent!.to).toEqual({ x: 25, y: 25, room: "W2N1" });
    // The straggler is directed onto a slot tile of the (stationary) formation — a real convergence target.
    const stragglerIntent = intents.find(i => i.creep === state.members[3].id);
    const slotTilesOccupied = [
      { x: 25, y: 25 },
      { x: 26, y: 25 },
      { x: 25, y: 26 },
      { x: 26, y: 26 }
    ];
    expect(slotTilesOccupied.some(t => t.x === stragglerIntent!.to.x && t.y === stragglerIntent!.to.y)).toBe(true);
  });

  it("advances a degraded formation (vacant anchor slot) in its current shape, checking the FULL footprint", () => {
    // Only 3 healers alive, the attacker (anchor slot) dead. The squad still advances, retreating/moving in
    // the full formation shape with the anchor slot vacant — every surviving member still gets a lockstep
    // move, and no member is placed where the FULL 2x2 footprint wouldn't fit.
    const state: SquadState = {
      members: [
        snapCreep("drainHealer", { room: "W2N1", x: 26, y: 25, memory: { op: "drain:W1N1" } }),
        snapCreep("drainHealer", { room: "W2N1", x: 25, y: 26, memory: { op: "drain:W1N1" } }),
        snapCreep("drainHealer", { room: "W2N1", x: 26, y: 26, memory: { op: "drain:W1N1" } })
      ],
      formation: BLOCK_2X2,
      anchor: { x: 25, y: 25, room: "W2N1" },
      facing: TOP
    };
    const intents = planSquadMove(state, { x: 25, y: 20, room: "W2N1" }, terrain);
    expect(intents).toHaveLength(3); // only the 3 survivors get intents; the vacant slot needs nobody
    for (const member of state.members) {
      const intent = intents.find(i => i.creep === member.id);
      expect(intent).toBeDefined();
      expect(range({ x: member.x, y: member.y }, intent!.to)).toBeLessThanOrEqual(1);
    }
  });

  it("never advances the footprint onto a wall — the whole shape must fit at the next anchor tile", () => {
    // Wall directly ahead of the block's advance so the naive next tile fails the full-footprint check;
    // the plan must route around it (or hold), never place any member on the wall.
    const wallTerrain = openTerrain();
    wallTerrain[25 * 50 + 24] = 0; // wall at (25,24), directly "ahead" (toward the goal at y<25)
    wallTerrain[26 * 50 + 24] = 0; // and its neighbour, so the straight-ahead block truly can't fit
    const src = (room: string) => (room === "W2N1" ? wallTerrain : undefined);
    const state = drainSquad();
    const intents = planSquadMove(state, { x: 25, y: 20, room: "W2N1" }, src);
    for (const i of intents) {
      expect(wallTerrain[i.to.x * 50 + i.to.y]).not.toBe(0);
    }
  });
});

describe("planSquadActions (generic signature)", () => {
  it("delegates to the supplied per-formation planner and returns its assignment map unchanged", () => {
    // The generic planSquadActions knows nothing about towers/healing — it just calls the plugged-in
    // planner. Here a trivial planner assigns every member a fixed action; planSquadActions returns it.
    const state = drainSquad();
    const colony = colonySnap({ name: "W1N1" });
    const trivialPlanner = (s: SquadState) =>
      new Map(s.members.map(m => [m.id, { do: "heal" as const, target: m.id }]));
    const actions = planSquadActions(state, colony, trivialPlanner);
    expect(actions.size).toBe(4);
    for (const m of state.members) {
      expect(actions.get(m.id)).toEqual({ do: "heal", target: m.id });
    }
  });
});
