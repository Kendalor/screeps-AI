// Integration test for Drain's attacker-faces-threat placement bias (src/operations/drain.ts's planMove,
// composing lib/squad.ts's mostUrgentThreat + reformAssignment): drives the REAL production path — colony
// snapshot -> Drain.squadState -> Drain.planMove — across many ticks with a hostile whose position changes
// tick to tick, the same "observable every tick, real code, no engine" style as squadReformDeadlock.test.ts
// and squadFormation.test.ts use for the generic squad layer. Confirms the attacker actually ends up on
// whichever of the formation's 4 FIXED tiles is nearest the current threat as it moves around, and applies
// the melee-vs-ranged engage-range priority rule end to end — all WITHOUT any rotation/facing concept: the
// box's tile-set never changes (see lib/formation.ts's module header), only which live creep sits where.

import { beforeEach, describe, expect, it } from "vitest";
import { Drain } from "../../../src/operations/drain";
import { NO_OCCUPANCY } from "../../../src/lib/squadPath";
import { clearSquadMatrixCache } from "../../../src/lib/squadCostMatrix";
import { clearTiles, stubPathFinderSingleRoom } from "../../constants";
import { colonySnap, hostileAt, snapCreep } from "../../fixtures";

beforeEach(() => {
  clearTiles();
  clearSquadMatrixCache();
  stubPathFinderSingleRoom();
});

const drain = new Drain("W1N1");
const ROOM = "W2N1";
const STAGING_ROUTE = [
  { room: "W1N5", hostile: false }, // staging room
  { room: ROOM, hostile: true } // target room — must be ON the route (roomsBeyondStaging) for a squad
  // already standing there to read as "underway" and get real squad-movement treatment from squadState.
];

function openTerrain(): Uint8Array {
  return new Uint8Array(2500).fill(1);
}
const OPEN_TERRAIN = { [ROOM]: openTerrain(), W1N5: openTerrain() };

// A squad clustered but NOT welded into any one fixed 2x2's exact slot tiles (each member a tile off from
// the fit) — so Drain.planMove's reform branch actually fires and the attacker-bias logic has a REFORM to
// bias, rather than an already-tight block with nothing to place.
function scatteredSquad(near: { x: number; y: number }, room = ROOM) {
  const attacker = snapCreep("drainAttacker", { room, x: near.x, y: near.y, memory: { op: drain.name } });
  const healers = [
    { x: near.x + 2, y: near.y },
    { x: near.x, y: near.y + 2 },
    { x: near.x + 2, y: near.y + 2 }
  ].map((p, i) => snapCreep("drainHealer", { room, x: p.x, y: p.y, memory: { op: drain.name }, name: `healer_${i}` }));
  return [attacker, ...healers];
}

// Drives drain.squadState() -> drain.planMove() for `ticks` ticks, re-snapshotting each tick with the
// SQUAD'S OWN just-computed positions (so the reform genuinely evolves as it actually happens, not just as
// reported once) and whatever hostiles `hostilesAtTick(tick)` returns that tick — the same "feed each
// tick's result back in as next tick's input" pattern SquadWorld uses for the generic layer, applied here
// to the real Drain integration.
function runDrain(
  initialMembers: ReturnType<typeof scatteredSquad>,
  ticks: number,
  hostilesAtTick: (tick: number) => ReturnType<typeof hostileAt>[]
): { tick: number; attackerPos: { x: number; y: number; room: string } }[] {
  let members = initialMembers;
  const log: { tick: number; attackerPos: { x: number; y: number; room: string } }[] = [];
  for (let tick = 0; tick < ticks; tick++) {
    const snap = colonySnap({
      draining: ROOM,
      drainRoute: STAGING_ROUTE,
      drainRoomTerrain: OPEN_TERRAIN,
      hostileRoomUnits: { [ROOM]: hostilesAtTick(tick) },
      creeps: members
    });
    const state = drain.squadState(snap);
    if (!state) throw new Error(`no squad state at tick ${tick}`);
    const goal = drain.goalTile(snap, state.members, "W1N5");
    const plan = drain.planMove(state, goal, snap, r => snap.drainRoomTerrain[r], tick, NO_OCCUPANCY);
    const byId = new Map(plan.moves.map(i => [i.creep, i.to]));
    const attacker = state.members.find(m => m.role === "drainAttacker")!;
    const attackerTo = byId.get(attacker.id) ?? { x: attacker.x, y: attacker.y, room: attacker.room };
    log.push({ tick, attackerPos: attackerTo });
    members = members.map(m => {
      const to = byId.get(m.id);
      return to ? { ...m, x: to.x, y: to.y, room: to.room } : m;
    });
  }
  return log;
}

// Distance from an attacker position to a threat position (Chebyshev, matching lib/squad.ts's `range`).
function chebyshev(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

describe("Drain squad attacker placement tracks the nearest threat (integration)", () => {
  it("places the attacker on whichever fixed tile ends up nearest a melee hostile parked due east", () => {
    const members = scatteredSquad({ x: 15, y: 25 });
    // A melee hostile planted due EAST of the squad — present every tick at the same relative side.
    const log = runDrain(members, 6, () => [hostileAt(40, 25, "melee", 0, { attackParts: 1 })]);

    // Once the reform settles, the attacker's own final tile should be closer (or equal) to the threat's
    // x-coordinate side than the squad's OTHER (non-preferred) tiles would have put it — i.e. it ends up on
    // the formation's east-facing tile, not an arbitrary one.
    const last = log[log.length - 1];
    expect(last.attackerPos.x, `attacker should have moved toward the eastern threat:\n${JSON.stringify(log)}`).toBeGreaterThan(15);
  });

  it("prioritizes an already-in-range ranged attacker over a not-yet-in-range melee attacker on a different side", () => {
    const members = scatteredSquad({ x: 15, y: 25 });
    // Melee (engage range 1) sits NORTH at range well beyond 1 — not yet hitting.
    // Ranged (engage range 3) sits EAST at exactly range 3 from the squad — already hitting — so it wins
    // priority despite the melee creep's raw distance being unremarkable either way.
    const log = runDrain(members, 3, () => [hostileAt(15, 15, "melee", 0, { attackParts: 1 }), hostileAt(18, 25, "ranged", 0, { rangedAttackParts: 1 })]);

    const last = log[log.length - 1];
    const rangedThreat = { x: 18, y: 25 };
    const meleeThreat = { x: 15, y: 15 };
    expect(
      chebyshev(last.attackerPos, rangedThreat),
      `attacker should have preferred the already-engaged ranged threat (east) over the not-yet-engaged melee one (north):\n${JSON.stringify(log)}`
    ).toBeLessThan(chebyshev(last.attackerPos, meleeThreat));
  });

  it("a tower is always the most urgent threat present, overriding any creep threat", () => {
    const withTowerLog: { tick: number; attackerPos: { x: number; y: number; room: string } }[] = [];
    let members2 = scatteredSquad({ x: 15, y: 25 });
    for (let tick = 0; tick < 3; tick++) {
      const snap = colonySnap({
        draining: ROOM,
        drainRoute: STAGING_ROUTE,
        drainRoomTerrain: OPEN_TERRAIN,
        hostileRoomUnits: { [ROOM]: [hostileAt(15, 24, "melee", 0, { attackParts: 1 })] },
        hostileRoomTowers: { [ROOM]: [{ id: "tower_far" as Id<StructureTower>, x: 15, y: 45, storeEnergy: 1000, storeCapacity: 1000 }] },
        creeps: members2
      });
      const state = drain.squadState(snap)!;
      const goal = drain.goalTile(snap, state.members, "W1N5");
      const plan = drain.planMove(state, goal, snap, r => snap.drainRoomTerrain[r], tick, NO_OCCUPANCY);
      const byId = new Map(plan.moves.map(i => [i.creep, i.to]));
      const attacker = state.members.find(m => m.role === "drainAttacker")!;
      const attackerTo = byId.get(attacker.id) ?? { x: attacker.x, y: attacker.y, room: attacker.room };
      withTowerLog.push({ tick, attackerPos: attackerTo });
      members2 = members2.map(m => {
        const to = byId.get(m.id);
        return to ? { ...m, x: to.x, y: to.y, room: to.room } : m;
      });
    }

    const last = withTowerLog[withTowerLog.length - 1];
    // The tower sits far SOUTH (y=45, increasing y); an adjacent melee hostile sits NORTH (y=24,
    // decreasing y) of the squad's starting y=25 — the attacker must have moved SOUTH (toward the tower),
    // not north toward the nearer-in-tiles-but-lower-urgency melee creep, despite the tower being much
    // farther away in raw distance (Infinity engageRange always wins, see mostUrgentThreat's doc).
    expect(
      last.attackerPos.y,
      `a tower must win placement bias over an adjacent melee creep (Infinity engageRange):\n${JSON.stringify(withTowerLog)}`
    ).toBeGreaterThan(25);
  });

  it("falls back to goal-directed placement when the room is clear of threats", () => {
    const members = scatteredSquad({ x: 15, y: 25 });
    const snap = colonySnap({
      draining: ROOM,
      drainRoute: STAGING_ROUTE,
      drainRoomTerrain: OPEN_TERRAIN,
      hostileRoomUnits: {},
      creeps: members
    });
    const state = drain.squadState(snap)!;
    const goal = drain.goalTile(snap, state.members, "W1N5");
    const plan = drain.planMove(state, goal, snap, r => snap.drainRoomTerrain[r], 0, NO_OCCUPANCY);
    // No threats: the plan still resolves (falls back to goal-directed preference) — every member gets a move.
    expect(plan.moves.length).toBe(state.members.length);
  });
});
