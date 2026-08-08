// The Squad entity's pure planning seam (ADR 0007): reformAssignment (greedy nearest one-to-one), and
// planSquadMove (one shared plan that moves the whole formation in lockstep). Plain SquadState data in,
// per-member move intents out — no Game, no Colony. planSquadActions' generic signature is exercised
// here with a trivial planner; Drain's real content is tested in the drain suite.

import { beforeEach, describe, expect, it } from "vitest";
import { planSquadActions, planSquadMove, reformAssignment, threatFacing, type SquadState, type Threat } from "../../../src/lib/squad";
import type { Formation } from "../../../src/lib/formation";
import { range } from "../../../src/lib/geometry";
import { clearSquadMatrixCache } from "../../../src/lib/squadCostMatrix";
import { clearTiles, stubPathFinderSingleRoom } from "../../constants";
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
  fatigue?: number[]; // per-member fatigue override, indexed same as positions; default 0
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
    return snapCreep(roles[i], { room, x: p.x, y: p.y, fatigue: over.fatigue?.[i] ?? 0, memory: { op: "drain:W1N1" } });
  });
  return { members, formation: BLOCK_2X2, anchor: { x: 25, y: 25, room }, facing };
}

beforeEach(() => {
  clearTiles();
  clearSquadMatrixCache();
  stubPathFinderSingleRoom();
});

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

describe("threatFacing", () => {
  const from = { x: 25, y: 25 };

  it("returns undefined with no threats", () => {
    expect(threatFacing(from, [])).toBeUndefined();
  });

  it("faces the 4 cardinal directions correctly", () => {
    expect(threatFacing(from, [{ x: 25, y: 20, engageRange: 1 }])).toBe(TOP);
    expect(threatFacing(from, [{ x: 30, y: 25, engageRange: 1 }])).toBe(RIGHT);
    expect(threatFacing(from, [{ x: 25, y: 30, engageRange: 1 }])).toBe(BOTTOM);
    expect(threatFacing(from, [{ x: 20, y: 25, engageRange: 1 }])).toBe(LEFT);
  });

  it("faces the 4 diagonal directions correctly", () => {
    expect(threatFacing(from, [{ x: 30, y: 20, engageRange: 1 }])).toBe(TOP_RIGHT);
    expect(threatFacing(from, [{ x: 30, y: 30, engageRange: 1 }])).toBe(BOTTOM_RIGHT);
    expect(threatFacing(from, [{ x: 20, y: 30, engageRange: 1 }])).toBe(BOTTOM_LEFT);
    expect(threatFacing(from, [{ x: 20, y: 20, engageRange: 1 }])).toBe(TOP_LEFT);
  });

  it("prefers whichever threat is closer to ITS OWN engage range, not raw distance", () => {
    // A melee creep (engageRange 1) at range 4 to the north: urgency 4-1=3, not yet hitting.
    // A ranged creep (engageRange 3) at range 3 to the east: urgency 3-3=0, already hitting.
    // Despite the melee creep being nearer in raw tiles, the ranged creep is more urgent (already engaged).
    const melee: Threat = { x: 25, y: 21, engageRange: 1 };
    const ranged: Threat = { x: 28, y: 25, engageRange: 3 };
    expect(threatFacing(from, [melee, ranged])).toBe(RIGHT);
  });

  it("flips facing when the more urgent threat repositions to the other side", () => {
    const melee: Threat = { x: 25, y: 21, engageRange: 1 }; // north, urgency 3
    const rangedEast: Threat = { x: 28, y: 25, engageRange: 3 }; // east, urgency 0 (most urgent)
    expect(threatFacing(from, [melee, rangedEast])).toBe(RIGHT);
    // Once the ranged attacker also closes past its engage range, the melee attacker (now equally close to
    // ITS engage range, having also advanced) can retake priority once it's the more urgent of the two.
    const meleeAdjacent: Threat = { x: 25, y: 24, engageRange: 1 }; // north, urgency 1-1=0
    const rangedFar: Threat = { x: 29, y: 25, engageRange: 3 }; // east, urgency 4-3=1
    expect(threatFacing(from, [meleeAdjacent, rangedFar])).toBe(TOP);
  });

  it("a tower is always the most urgent threat present (Infinity engageRange)", () => {
    const meleeAdjacent: Threat = { x: 25, y: 24, engageRange: 1 }; // urgency 1-1=0
    const tower: Threat = { x: 25, y: 15, engageRange: Infinity }; // urgency -Infinity, far away in tiles
    expect(threatFacing(from, [meleeAdjacent, tower])).toBe(TOP); // faces the distant tower, not the adjacent melee
  });

  it("holds the canonical TOP facing when the sole threat is co-located (no meaningful direction)", () => {
    expect(threatFacing(from, [{ x: 25, y: 25, engageRange: 1 }])).toBe(TOP);
  });
});

describe("planSquadMove", () => {
  it("moves every member by (at most) one tile in lockstep when advancing toward the goal", () => {
    // A tight, in-formation 2x2 advancing toward a goal several tiles away. Every member gets exactly one
    // move intent, and each intent is within range 1 of the member's current tile (a single step) — the
    // whole formation advances together, never one member racing ahead.
    const state = drainSquad();
    const intents = planSquadMove(state, { x: 25, y: 20, room: "W2N1" }, terrain, 0);
    expect(intents).toHaveLength(4);
    for (const member of state.members) {
      const intent = intents.find(i => i.creep === member.id);
      expect(intent).toBeDefined();
      expect(range({ x: member.x, y: member.y }, intent!.to)).toBeLessThanOrEqual(1);
      expect(intent!.to.room).toBe("W2N1");
    }
  });

  it("holds at current slots (never advances) when the block is tight but a member is fatigued", () => {
    // A fatigued creep's move() silently no-ops this tick — advancing anyway would leave that member
    // behind while unfatigued squadmates still slid forward, reintroducing per-member drift under a
    // different mechanism than the independent-Traveler convergence ADR 0007 replaced.
    const state = drainSquad({ fatigue: [0, 0, 3, 0] });
    const intents = planSquadMove(state, { x: 25, y: 20, room: "W2N1" }, terrain, 0);
    expect(intents).toHaveLength(4);
    for (const member of state.members) {
      const intent = intents.find(i => i.creep === member.id);
      // Held at the SAME tile it already occupies (the current slot) — no advance toward the goal.
      expect(intent!.to).toEqual({ x: member.x, y: member.y, room: "W2N1" });
    }
  });

  it("advances normally once every member's fatigue clears", () => {
    const state = drainSquad({ fatigue: [0, 0, 0, 0] });
    const intents = planSquadMove(state, { x: 25, y: 20, room: "W2N1" }, terrain, 0);
    // At least one member actually moves toward the goal (y decreases) — confirms fatigue:0 doesn't
    // spuriously hold the squad the way the fatigued case above does.
    const advanced = intents.some(i => {
      const member = state.members.find(m => m.id === i.creep)!;
      return i.to.y < member.y;
    });
    expect(advanced).toBe(true);
  });

  it("keeps the destination tiles a valid mutual-range-1 block (the whole squad stays welded)", () => {
    const state = drainSquad();
    const intents = planSquadMove(state, { x: 25, y: 20, room: "W2N1" }, terrain, 0);
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
    const intents = planSquadMove(state, { x: 25, y: 20, room: "W2N1" }, terrain, 0);
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
    const intents = planSquadMove(state, { x: 25, y: 20, room: "W2N1" }, terrain, 0);
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
    const intents = planSquadMove(state, { x: 25, y: 20, room: "W2N1" }, src, 0);
    for (const i of intents) {
      expect(wallTerrain[i.to.x * 50 + i.to.y]).not.toBe(0);
    }
  });

  it("retargets the reform onto the nearest fitting anchor when the CURRENT anchor/facing fits nowhere", () => {
    // A diagonal one-tile-wide staircase corridor — no 2x2 block fits anywhere along it at any facing
    // (each step only opens 2 diagonally-adjacent tiles, never a full square). The squad's live anchor sits
    // mid-staircase (not tight — members scattered by prior independent movement, mirroring the live bug:
    // a squad reaching this position via step-table pathing before ever coming under squad control). A
    // 3x3 open pocket a few tiles away DOES fit a 2x2 at some facing. Without the escape hatch, reforming
    // onto the (unfittable) current-anchor slots would hold every member here forever; with it, the plan
    // must send members toward the pocket instead.
    const staircase = new Uint8Array(2500).fill(0);
    const open = (x: number, y: number) => {
      staircase[x * 50 + y] = 1;
    };
    for (let i = 0; i < 10; i++) {
      open(10 + i, 10 + i);
      open(11 + i, 10 + i);
    }
    // A 3x3 pocket well clear of the staircase — fits a 2x2 at the canonical TOP facing.
    for (let x = 30; x <= 32; x++) for (let y = 30; y <= 32; y++) open(x, y);
    const src = (room: string) => (room === "W2N1" ? staircase : undefined);

    const state = drainSquad({
      positions: [
        { x: 15, y: 15 }, // anchor, mid-staircase
        { x: 16, y: 15 },
        { x: 15, y: 16 },
        { x: 16, y: 16 } // this tile is NOT open in the staircase — the block was never actually tight
      ]
    });
    const intents = planSquadMove(state, { x: 25, y: 20, room: "W2N1" }, src, 0);
    expect(intents).toHaveLength(4);
    // Every member is steered toward the fitting pocket, not held at the unfittable staircase position —
    // each intent should move at least one member closer to the pocket (30-32,30-32) than its current tile.
    const movedTowardPocket = intents.some(i => {
      const member = state.members.find(m => m.id === i.creep)!;
      const distBefore = Math.max(Math.abs(member.x - 31), Math.abs(member.y - 31));
      const distAfter = Math.max(Math.abs(i.to.x - 31), Math.abs(i.to.y - 31));
      return distAfter < distBefore;
    });
    expect(movedTowardPocket).toBe(true);
    // No intent targets a walled tile — the reform destination itself must be real, walkable ground.
    for (const i of intents) expect(staircase[i.to.x * 50 + i.to.y]).toBe(1);
  });

  // Pins the SHIFT (not swap) semantics of the doorway-blocker repair (see slotChainRepair, src/lib/
  // squad.ts) against the exact live incident geometry (2026-08-07, colony W8N3): attacker + 2 healers
  // already tight on 3 of the 4 BLOCK_2X2 slots, a 4th healer (the straggler) approaching from outside the
  // formation whose naive nearest-slot assignment is the one vacant slot. In a 2x2, the vacant corner is
  // adjacent to BOTH filled same-role neighbors, so either could be picked as "the blocker" (this test
  // doesn't pin which one — slotChainRepair's own array-order tie-break is an implementation detail, not a
  // contract) — what's pinned is the SHIFT invariant that must hold for whichever one is picked.
  //
  // A SWAP would send the blocking healer straight to the straggler's far vacant slot and the straggler to
  // the blocker's old slot — correct positions eventually, but for one tick the blocker is stranded OUTSIDE
  // the formation's own slot set, needing a second repair pass next tick to get back in. A SHIFT sends the
  // blocker to the vacant slot (still inside the formation, one hop from where it started) and redirects the
  // straggler onto the blocker's now-vacated slot (a slot immediately reachable from where the straggler
  // currently stands, unlike the original far slot) — both members land on real formation slots in the SAME
  // repair pass, nobody bounces outside the block, and the OTHER healer (never involved) doesn't move at all.
  it("reform repair SHIFTS a doorway blocker into the vacant slot, not swaps it out to the straggler's far slot", () => {
    const room = "W2N1";
    const anchor = { x: 24, y: 26, room };
    // With fully open terrain, nearestFittingAnchor's radius-0 search returns the CURRENT anchor at the
    // first facing that fits (TOP, its search order's first entry) regardless of what facing the state
    // itself claims — so the formation actually in effect is the TOP-facing slot set: attacker (24,26),
    // healers (25,26)/(24,27)/(25,27) (verified directly against slotTiles(anchor, TOP, BLOCK_2X2), not
    // hand-derived, since nearestFittingAnchor's facing choice is otherwise easy to get wrong by assumption
    // — see squadReformDeadlock.test.ts's comment on the same gotcha).
    const healerASlot = { x: 25, y: 26 };
    const healerBSlot = { x: 24, y: 27 };
    const vacantSlot = { x: 25, y: 27 };
    const members = [
      snapCreep("drainAttacker", { room, x: 24, y: 26, memory: { op: "drain:W1N1" } }),
      snapCreep("drainHealer", { room, ...healerASlot, memory: { op: "drain:W1N1" } }),
      snapCreep("drainHealer", { room, ...healerBSlot, memory: { op: "drain:W1N1" } }),
      // The straggler: far outside the formation, so its naive nearest-slot assignment is the vacant
      // slot — not directly adjacent to it, so a real single-tile walk must go through an occupied slot.
      snapCreep("drainHealer", { room, x: 5, y: 5, memory: { op: "drain:W1N1" } })
    ];
    const [, healerA, healerB, straggler] = members;
    const state: SquadState = { members, formation: BLOCK_2X2, anchor, facing: TOP };

    const intents = planSquadMove(state, anchor, terrain, 0); // goal === anchor: isolate reform from advance
    const healerAIntent = intents.find(i => i.creep === healerA.id)!;
    const healerBIntent = intents.find(i => i.creep === healerB.id)!;
    const stragglerIntent = intents.find(i => i.creep === straggler.id)!;

    // Exactly one of the two already-arrived healers is the blocker (moves into the vacant slot); the
    // other, uninvolved in this repair, holds its own slot unchanged.
    const blockerMovedToVacant = { x: healerAIntent.to.x, y: healerAIntent.to.y };
    const blockerIsA = blockerMovedToVacant.x === vacantSlot.x && blockerMovedToVacant.y === vacantSlot.y;
    const blockerOldSlot = blockerIsA ? healerASlot : healerBSlot;
    const stationaryIntent = blockerIsA ? healerBIntent : healerAIntent;
    const stationarySlot = blockerIsA ? healerBSlot : healerASlot;

    expect({ x: (blockerIsA ? healerAIntent : healerBIntent).to.x, y: (blockerIsA ? healerAIntent : healerBIntent).to.y }).toEqual(vacantSlot);
    expect({ x: stationaryIntent.to.x, y: stationaryIntent.to.y }).toEqual(stationarySlot);
    // The straggler is redirected onto the BLOCKER'S old slot — the tile it can actually approach this
    // tick — NOT the original far vacant slot, which a plain swap would have left it aimed at while the
    // blocker was still standing there.
    expect({ x: stragglerIntent.to.x, y: stragglerIntent.to.y }).toEqual(blockerOldSlot);
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
