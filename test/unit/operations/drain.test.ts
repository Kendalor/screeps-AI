// Drain sends a fixed 4-creep squad (1 drainAttacker + 3 drainHealer) at a single target room
// (ColonyMemory.draining, snapshot.draining) — see docs/adr/0006-drain-energy-operation.md and (for the
// movement redesign) docs/adr/0007-squad-movement.md. Constructed directly here (new Drain("W1N1")), same
// as Attack/Defense's test convention: no Game mock, no Colony. Movement/action are now the Squad entity's
// pure seam (squadState -> planSquadMove, actionPlanner -> planSquadActions), NOT per-creep
// setSquadTargetPos intents — so the movement tests assert on squadState/squadGoal/planDrainActions.

import { describe, expect, it } from "vitest";
import { Drain, pickStagingRoom, planDrainActions } from "../../../src/operations/drain";
import { planSquadActions, planSquadMove } from "../../../src/lib/squad";
import { DRAIN_ATTACKER_MIN_COST } from "../../../src/behaviors/roles/drainAttacker";
import { DRAIN_HEALER_MIN_COST } from "../../../src/behaviors/roles/drainHealer";
import { range } from "../../../src/lib/geometry";
import { colonySnap, snapCreep, towerAt, visibleRoom } from "../../fixtures";

const drain = new Drain("W1N1");

const DRAIN_AFFORDABLE = { energyCapacity: DRAIN_ATTACKER_MIN_COST + 3 * DRAIN_HEALER_MIN_COST };
const requestsByRole = (requests: { memory: { role: string } }[], role: string) => requests.filter(r => r.memory.role === role);

const STAGING_ROUTE = [
  { room: "W1N3", hostile: true },
  { room: "W1N5", hostile: false }, // staging room
  { room: "W2N1", hostile: true }
];

function openTerrain(): Uint8Array {
  return new Uint8Array(2500).fill(1);
}
// drainRoomTerrain covering the target + staging room, all walkable.
const OPEN_TERRAIN = { W2N1: openTerrain(), W1N5: openTerrain() };

// A full squad fixture: 1 drainAttacker + 3 drainHealer sharing drain.name, positioned in `room`.
function squad(over: { room?: string; x?: number; y?: number; attacker?: Partial<Parameters<typeof snapCreep>[1]>; healers?: Partial<Parameters<typeof snapCreep>[1]>[] } = {}) {
  const room = over.room ?? "W2N1";
  // Default to a tight 2x2 block at (25,25) so squadState reports assembled+in-formation.
  const tiles = [
    { x: 25, y: 25 },
    { x: 26, y: 25 },
    { x: 25, y: 26 },
    { x: 26, y: 26 }
  ];
  const attacker = snapCreep("drainAttacker", { room, x: tiles[0].x, y: tiles[0].y, memory: { op: drain.name }, ...over.attacker });
  const healers = [0, 1, 2].map(i =>
    snapCreep("drainHealer", { room, x: tiles[i + 1].x, y: tiles[i + 1].y, memory: { op: drain.name }, ...(over.healers?.[i] ?? {}) })
  );
  return [attacker, ...healers];
}

describe("Drain.desiredCreeps", () => {
  it("requests 1 attacker and 3 healers when draining is set and nothing is owned yet", () => {
    const snap = colonySnap({ ...DRAIN_AFFORDABLE, draining: "W2N1" });
    const requests = drain.desiredCreeps(snap);
    expect(requestsByRole(requests, "drainAttacker")).toHaveLength(1);
    expect(requestsByRole(requests, "drainHealer")).toHaveLength(3);
    for (const r of requests) expect(r.memory.op).toBe("drain:W1N1");
  });

  it("requests nothing when draining is unset", () => {
    const snap = colonySnap({ ...DRAIN_AFFORDABLE, draining: undefined });
    expect(drain.desiredCreeps(snap)).toEqual([]);
  });

  it("tops up only the missing healers once the attacker and some healers are already owned", () => {
    const snap = colonySnap({
      ...DRAIN_AFFORDABLE,
      draining: "W2N1",
      creeps: [
        snapCreep("drainAttacker", { memory: { op: "drain:W1N1" } }),
        snapCreep("drainHealer", { memory: { op: "drain:W1N1" } })
      ]
    });
    const requests = drain.desiredCreeps(snap);
    expect(requestsByRole(requests, "drainAttacker")).toHaveLength(0);
    expect(requestsByRole(requests, "drainHealer")).toHaveLength(2);
  });

  it("requests nothing once the full 1 attacker + 3 healer composition is already owned", () => {
    const snap = colonySnap({
      ...DRAIN_AFFORDABLE,
      draining: "W2N1",
      creeps: [
        snapCreep("drainAttacker", { memory: { op: "drain:W1N1" } }),
        snapCreep("drainHealer", { memory: { op: "drain:W1N1" } }),
        snapCreep("drainHealer", { memory: { op: "drain:W1N1" } }),
        snapCreep("drainHealer", { memory: { op: "drain:W1N1" } })
      ]
    });
    expect(drain.desiredCreeps(snap)).toEqual([]);
  });

  // #39: a squad short by exactly 1 requests exactly that 1 back (death and expiry share one path).
  it("requests exactly the 1 missing healer when the squad is short by one (below full strength, not zero)", () => {
    const snap = colonySnap({
      ...DRAIN_AFFORDABLE,
      draining: "W2N1",
      creeps: [
        snapCreep("drainAttacker", { memory: { op: "drain:W1N1" } }),
        snapCreep("drainHealer", { memory: { op: "drain:W1N1" } }),
        snapCreep("drainHealer", { memory: { op: "drain:W1N1" } })
      ]
    });
    const requests = drain.desiredCreeps(snap);
    expect(requestsByRole(requests, "drainAttacker")).toHaveLength(0);
    expect(requestsByRole(requests, "drainHealer")).toHaveLength(1);
  });
});

describe("Drain.squadState assembly gate (ADR 0007 requirement 2: rally is independent, no squad yet)", () => {
  it("reports no squad (undefined) while the squad isn't fully assembled — members rally via their own step tables", () => {
    // Only the attacker and one healer are alive, both still travelling from home (not in staging).
    const snap = colonySnap({
      draining: "W2N1",
      drainRoute: STAGING_ROUTE,
      drainRoomTerrain: OPEN_TERRAIN,
      creeps: [
        snapCreep("drainAttacker", { room: "W1N1", memory: { op: "drain:W1N1" } }),
        snapCreep("drainHealer", { room: "W1N1", memory: { op: "drain:W1N1" } })
      ]
    });
    expect(drain.squadState(snap)).toBeUndefined();
  });

  it("steers every unsquadded member toward the staging room's center via drainRallyPos (the rally)", () => {
    // A concrete TILE, not a room name (moveToPos + drainRallyPos, not moveToRoom + attackTargetRoom) — a
    // room-membership-only destination let two stragglers each converging on "whichever room the OTHER one
    // currently stands in" chase each other back and forth across a border forever (confirmed live).
    const snap = colonySnap({
      draining: "W2N1",
      drainRoute: STAGING_ROUTE,
      drainRoomTerrain: OPEN_TERRAIN,
      creeps: [
        snapCreep("drainAttacker", { room: "W1N1", memory: { op: "drain:W1N1" } }),
        snapCreep("drainHealer", { room: "W1N1", memory: { op: "drain:W1N1" } })
      ]
    });
    const intents = drain.intents(snap);
    const rallyIntents = intents.filter(i => i.kind === "setDrainRallyPos");
    expect(rallyIntents).toHaveLength(2);
    for (const i of rallyIntents) expect((i as { pos: { x: number; y: number; room: string } }).pos).toEqual({ x: 25, y: 25, room: "W1N5" });
  });

  it("reports no squad while a fully-alive squad is still gathering in staging (not yet physically together)", () => {
    const members = squad({ room: "W1N5" });
    members[3] = { ...members[3], room: "W1N3" }; // one healer not yet in staging
    const snap = colonySnap({ draining: "W2N1", drainRoute: STAGING_ROUTE, drainRoomTerrain: OPEN_TERRAIN, creeps: members });
    expect(drain.squadState(snap)).toBeUndefined();
  });
});

describe("Drain.squadState + squadGoal advance/retreat", () => {
  it("reports an assembled squad (with the attacker as anchor) once all 4 are together in staging", () => {
    const members = squad({ room: "W1N5" });
    const snap = colonySnap({ draining: "W2N1", drainRoute: STAGING_ROUTE, drainRoomTerrain: OPEN_TERRAIN, creeps: members });
    const state = drain.squadState(snap);
    expect(state).toBeDefined();
    expect(state!.members).toHaveLength(4);
    // The anchor slot is the attacker's tile.
    expect(state!.anchor).toEqual({ x: 25, y: 25, room: "W1N5" });
  });

  it("aims the squad goal into the target room when no towers threaten it", () => {
    const members = squad({ room: "W2N1" });
    const snap = colonySnap({ draining: "W2N1", drainRoute: STAGING_ROUTE, drainRoomTerrain: OPEN_TERRAIN, creeps: members });
    const goal = drain.squadGoal(snap);
    expect(goal!.room).toBe("W2N1"); // advancing into the target room
  });

  it("aims the squad goal back at the staging room when projected tower damage exceeds heal output", () => {
    // A tower at (25,25); healers with the fixture default body (0 HEAL parts) heal for 0 — outgunned.
    const members = squad({ room: "W2N1" });
    // Move the block off-center so the next advance tile is a real step toward the tower.
    const shifted = members.map(m => ({ ...m, x: m.x, y: m.y + 5 }));
    const snap = colonySnap({
      draining: "W2N1",
      drainRoute: STAGING_ROUTE,
      drainRoomTerrain: OPEN_TERRAIN,
      hostileRoomTowers: { W2N1: [towerAt(25, 25)] },
      creeps: shifted
    });
    const goal = drain.squadGoal(snap);
    expect(goal!.room).toBe("W1N5"); // retreating toward staging
  });

  it("aims into the target room when the squad's heal output covers the projected tower damage", () => {
    const HEAL_BODY = Array(20).fill(HEAL).concat(Array(20).fill(MOVE));
    const members = squad({ room: "W2N1", healers: [{ body: HEAL_BODY }, { body: HEAL_BODY }, { body: HEAL_BODY }] });
    const snap = colonySnap({
      draining: "W2N1",
      drainRoute: STAGING_ROUTE,
      drainRoomTerrain: OPEN_TERRAIN,
      hostileRoomTowers: { W2N1: [towerAt(25, 25)] },
      creeps: members
    });
    const goal = drain.squadGoal(snap);
    expect(goal!.room).toBe("W2N1"); // advancing — heal covers the damage
  });

  it("aims back at staging while any squad member is below full HP, even with zero towers visible", () => {
    const members = squad({ room: "W2N1" });
    members[0] = { ...members[0], hits: 500, hitsMax: 1000 }; // attacker hurt
    const snap = colonySnap({ draining: "W2N1", drainRoute: STAGING_ROUTE, drainRoomTerrain: OPEN_TERRAIN, creeps: members });
    const goal = drain.squadGoal(snap);
    expect(goal!.room).toBe("W1N5"); // retreat to heal up
  });

  it("reports the squad's REAL current facing, not the goal-directed one, when the two disagree", () => {
    // The squad's LIVE positions form a tight TOP-facing 2x2 at anchor (27,26) — attacker(27,26),
    // healers(28,26)/(27,27)/(28,27) — but the goal (25,25 in the SAME room) lies to the upper-LEFT of
    // that anchor, so drainFacing's travel-direction heuristic alone would say LEFT. Before the fix,
    // squadState stamped facing=LEFT unconditionally, so inFormation (checked against slotTiles at LEFT,
    // which do NOT match these live positions) reported the squad "not tight" forever — a squad that is
    // genuinely welded, frozen "reforming" onto tiles it already occupies, tick after tick (confirmed live
    // on the pserver). The fix: detect that the live positions already fit TOP and report that.
    const members = squad({
      room: "W2N1",
      attacker: { x: 27, y: 26 },
      healers: [{ x: 28, y: 26 }, { x: 27, y: 27 }, { x: 28, y: 27 }]
    });
    const snap = colonySnap({ draining: "W2N1", drainRoute: STAGING_ROUTE, drainRoomTerrain: OPEN_TERRAIN, creeps: members });
    const state = drain.squadState(snap);
    expect(state).toBeDefined();
    expect(state!.facing).toBe(TOP);
  });
});

describe("Drain squad movement keeps the whole formation in lockstep (planSquadMove)", () => {
  it("moves every member at most one tile toward the goal, staying a mutual-range-1 block", () => {
    const members = squad({ room: "W2N1" });
    const snap = colonySnap({ draining: "W2N1", drainRoute: STAGING_ROUTE, drainRoomTerrain: OPEN_TERRAIN, creeps: members });
    const state = drain.squadState(snap)!;
    const goal = drain.squadGoal(snap)!;
    const moves = planSquadMove(state, goal, drain.terrain(snap));
    expect(moves).toHaveLength(4);
    // every member steps at most one tile...
    for (const m of state.members) {
      const move = moves.find(mv => mv.creep === m.id)!;
      expect(range({ x: m.x, y: m.y }, move.to)).toBeLessThanOrEqual(1);
    }
    // ...and the destinations remain a tight block.
    const dests = moves.map(mv => mv.to);
    for (let i = 0; i < dests.length; i++)
      for (let j = 0; j < dests.length; j++) if (i !== j) expect(range(dests[i], dests[j])).toBeLessThanOrEqual(1);
  });

  it("holds and reforms (does not advance) when a follower has fallen out of formation", () => {
    const members = squad({ room: "W2N1" });
    members[3] = { ...members[3], x: 35, y: 35 }; // a healer far out of formation
    const snap = colonySnap({ draining: "W2N1", drainRoute: STAGING_ROUTE, drainRoomTerrain: OPEN_TERRAIN, creeps: members });
    const state = drain.squadState(snap)!;
    const goal = drain.squadGoal(snap)!;
    const moves = planSquadMove(state, goal, drain.terrain(snap));
    // The anchor (attacker) holds on its own slot tile — the block reforms before advancing.
    const anchorMove = moves.find(m => m.creep === members[0].id)!;
    expect({ x: anchorMove.to.x, y: anchorMove.to.y }).toEqual({ x: 25, y: 25 });
  });
});

describe("Drain loss handling (#39): degraded formation, no attacker", () => {
  it("still forms a squad and moves the survivors when the attacker (anchor slot) is dead", () => {
    // 3 healers, no attacker — a degraded formation. squadState still reports a squad (anchor slot vacant),
    // and planSquadMove still produces a lockstep move per survivor (ADR 0007: retreat as-is, vacant slot).
    const healers = [
      snapCreep("drainHealer", { room: "W2N1", x: 26, y: 25, memory: { op: "drain:W1N1" } }),
      snapCreep("drainHealer", { room: "W2N1", x: 25, y: 26, memory: { op: "drain:W1N1" } }),
      snapCreep("drainHealer", { room: "W2N1", x: 26, y: 26, memory: { op: "drain:W1N1" } })
    ];
    // Underway (in the target room, not staging) so the squad machinery engages for the degraded survivors.
    const snap = colonySnap({ draining: "W2N1", drainRoute: STAGING_ROUTE, drainRoomTerrain: OPEN_TERRAIN, creeps: healers });
    const state = drain.squadState(snap);
    expect(state).toBeDefined();
    expect(state!.members).toHaveLength(3);
    const moves = planSquadMove(state!, drain.squadGoal(snap)!, drain.terrain(snap));
    expect(moves).toHaveLength(3); // only the survivors get moves; the vacant anchor slot needs nobody
  });
});

describe("planDrainActions (Drain's plugged-in action content)", () => {
  it("targets a tower with the attacker and the most-damaged squadmate with each healer", () => {
    const attacker = snapCreep("drainAttacker", { room: "W2N1", x: 25, y: 25, memory: { op: "drain:W1N1" } });
    const healers = [
      snapCreep("drainHealer", { room: "W2N1", x: 26, y: 25, hits: 500, hitsMax: 500, memory: { op: "drain:W1N1" } }),
      snapCreep("drainHealer", { room: "W2N1", x: 25, y: 26, hits: 100, hitsMax: 500, memory: { op: "drain:W1N1" } }), // most damaged
      snapCreep("drainHealer", { room: "W2N1", x: 26, y: 26, hits: 500, hitsMax: 500, memory: { op: "drain:W1N1" } })
    ];
    const state = {
      members: [attacker, ...healers],
      formation: [] as never[],
      anchor: { x: 25, y: 25, room: "W2N1" },
      facing: TOP as DirectionConstant
    };
    const snap = colonySnap({ name: "W1N1", draining: "W2N1", hostileRoomTowers: { W2N1: [towerAt(25, 25, "tower_a")] } });
    const actions = planSquadActions(state, snap, planDrainActions);
    expect(actions.get(attacker.id)).toEqual({ do: "attack", target: "tower_a" });
    for (const h of healers) expect(actions.get(h.id)).toEqual({ do: "heal", target: healers[1].id });
  });

  it("falls back to the most threatening hostile for the attacker when no tower is present", () => {
    const attacker = snapCreep("drainAttacker", { room: "W2N1", x: 25, y: 25, memory: { op: "drain:W1N1" } });
    const state = {
      members: [attacker],
      formation: [] as never[],
      anchor: { x: 25, y: 25, room: "W2N1" },
      facing: TOP as DirectionConstant
    };
    // colony.hostiles carries the snapshot's hostile creeps; the more-armed one is picked.
    const snap = colonySnap({
      name: "W1N1",
      draining: "W2N1",
      hostiles: [
        { id: "unarmed" as Id<Creep>, x: 1, y: 1, hits: 100, hitsMax: 100, healParts: 0, attackParts: 0, rangedAttackParts: 0, toughReduction: 1 },
        { id: "armed" as Id<Creep>, x: 2, y: 2, hits: 100, hitsMax: 100, healParts: 0, attackParts: 5, rangedAttackParts: 0, toughReduction: 1 }
      ]
    });
    const actions = planSquadActions(state, snap, planDrainActions);
    expect(actions.get(attacker.id)).toEqual({ do: "attack", target: "armed" });
  });
});

describe("Drain.intents drainHistory sample (#40)", () => {
  it("records a sample (tick, tower energy, storage energy) when the target room is visible", () => {
    const members = squad({ room: "W2N1" });
    const snap = colonySnap({
      tick: 123,
      draining: "W2N1",
      drainRoute: STAGING_ROUTE,
      drainRoomTerrain: OPEN_TERRAIN,
      hostileRoomTowers: { W2N1: [towerAt(25, 25, "t1", 400), towerAt(10, 10, "t2", 200)] },
      hostileRoomStorageEnergy: { W2N1: 5000 },
      visibleRooms: [visibleRoom("W2N1")],
      creeps: members
    });
    const intents = drain.intents(snap);
    expect(intents).toContainEqual({
      kind: "recordDrainSample",
      room: "W1N1",
      target: "W2N1",
      tick: 123,
      towerEnergy: 600,
      storageEnergy: 5000
    });
  });

  it("records no sample (a gap, not a zero-filled entry) on a tick without vision of the target room", () => {
    const members = squad({ room: "W2N1" });
    const snap = colonySnap({
      tick: 124,
      draining: "W2N1",
      drainRoute: STAGING_ROUTE,
      drainRoomTerrain: OPEN_TERRAIN,
      hostileRoomTowers: { W2N1: [towerAt(25, 25, "t1", 400)] },
      hostileRoomStorageEnergy: { W2N1: 5000 },
      visibleRooms: [],
      creeps: members
    });
    const intents = drain.intents(snap);
    expect(intents.some(i => i.kind === "recordDrainSample")).toBe(false);
  });
});

describe("pickStagingRoom", () => {
  it("picks the first non-hostile room along the route", () => {
    expect(
      pickStagingRoom([
        { room: "W2N1", hostile: true },
        { room: "W3N1", hostile: false },
        { room: "W4N1", hostile: true }
      ])
    ).toBe("W3N1");
  });

  it("treats an unscouted room (hostile: false, the fixture default) as safe", () => {
    expect(
      pickStagingRoom([
        { room: "W2N1", hostile: true },
        { room: "W3N1", hostile: false }
      ])
    ).toBe("W3N1");
  });

  it("returns undefined when every room along the route is hostile", () => {
    expect(
      pickStagingRoom([
        { room: "W2N1", hostile: true },
        { room: "W3N1", hostile: true }
      ])
    ).toBeUndefined();
  });

  it("returns undefined for an empty route", () => {
    expect(pickStagingRoom([])).toBeUndefined();
  });
});
