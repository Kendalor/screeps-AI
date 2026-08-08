// Integration test for threat-facing (src/lib/squad.ts's threatFacing/mostUrgentThreat, wired into
// Drain.squadState via drain.ts's threatsIn): drives the REAL production path — colony snapshot ->
// Drain.squadState -> planSquadMove — across many ticks with a hostile whose position changes tick to
// tick, the same "observable every tick, real code, no engine" style as squadReformDeadlock.test.ts and
// squadFormation.test.ts use for the generic squad layer. Confirms the formation actually reorients to
// track a moving threat over time (not just in one isolated call), reshuffles which axis-aligned facing it
// holds as the threat circles it, and applies the melee-vs-ranged engage-range priority rule end to end.
//
// A squad that's ALREADY tight in some facing reports THAT facing regardless of desiredFacing (currentFacing
// wins over desiredFacing — see squadState's doc in drain.ts, a deliberate rule fixing a different live bug).
// So every scenario here starts the squad scattered (independently-rallying positions, not yet welded into
// any 2x2 shape) rather than pre-formed — the only way to observe threatFacing's OWN output rather than
// whatever facing the fixture happened to hard-code the squad into.

import { beforeEach, describe, expect, it } from "vitest";
import { Drain } from "../../../src/operations/drain";
import { planSquadMove } from "../../../src/lib/squad";
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

// A squad clustered but NOT welded into any one facing's exact slot tiles (each member a tile off from
// every axis-aligned 2x2 fit) — so currentFacing (drain.ts) finds nothing and desiredFacing (goal- or
// threat-directed) is what squadState actually reports. Anchored away from (25,25) — Drain's fixed
// room-center advance aim — so a test's goal is never coincidentally equal to the squad's own position
// (which would make findSquadPath treat the squad as already-arrived and skip reform-edge exploration).
function scatteredSquad(near: { x: number; y: number }, room = ROOM) {
  const attacker = snapCreep("drainAttacker", { room, x: near.x, y: near.y, memory: { op: drain.name } });
  const healers = [
    { x: near.x + 2, y: near.y },
    { x: near.x, y: near.y + 2 },
    { x: near.x + 2, y: near.y + 2 }
  ].map((p, i) => snapCreep("drainHealer", { room, x: p.x, y: p.y, memory: { op: drain.name }, name: `healer_${i}` }));
  return [attacker, ...healers];
}

// Drives drain.squadState() -> planSquadMove() for `ticks` ticks, re-snapshotting each tick with the
// SQUAD'S OWN just-computed positions (so the formation's live facing genuinely evolves as it actually
// reforms, not just as reported once) and whatever hostiles `hostilesAtTick(tick)` returns that tick — the
// same "feed each tick's result back in as next tick's input" pattern SquadWorld uses for the generic
// layer, applied here to the real Drain integration.
function runDrain(
  initialMembers: ReturnType<typeof scatteredSquad>,
  ticks: number,
  hostilesAtTick: (tick: number) => ReturnType<typeof hostileAt>[]
): { tick: number; facing: DirectionConstant; anchor: { x: number; y: number; room: string } }[] {
  let members = initialMembers;
  const log: { tick: number; facing: DirectionConstant; anchor: { x: number; y: number; room: string } }[] = [];
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
    log.push({ tick, facing: state.facing, anchor: state.anchor });
    const goal = drain.goalTile(snap, state.members, "W1N5");
    const intents = planSquadMove(state, goal, r => snap.drainRoomTerrain[r], tick);
    const byId = new Map(intents.map(i => [i.creep, i.to]));
    members = members.map(m => {
      const to = byId.get(m.id);
      return to ? { ...m, x: to.x, y: to.y, room: to.room } : m;
    });
  }
  return log;
}

describe("Drain squad facing tracks the nearest threat (integration)", () => {
  it("welds into formation already facing a melee hostile parked due east, and holds that facing over subsequent ticks", () => {
    const members = scatteredSquad({ x: 15, y: 25 });
    // A melee hostile planted due EAST of the squad — present every tick at the SAME relative side, so the
    // formation should settle on (and hold) RIGHT once it welds up, never drifting to another facing.
    const log = runDrain(members, 6, () => [hostileAt(40, 25, "melee", 0, { attackParts: 1 })]);

    expect(log[log.length - 1].facing, `expected the settled formation to face RIGHT (east):\n${JSON.stringify(log)}`).toBe(RIGHT);
    // Once it reaches RIGHT, it must never leave it again (the threat never moved).
    const firstRightIdx = log.findIndex(e => e.facing === RIGHT);
    expect(firstRightIdx, `formation never reached RIGHT at all:\n${JSON.stringify(log)}`).toBeGreaterThanOrEqual(0);
    expect(
      log.slice(firstRightIdx).every(e => e.facing === RIGHT),
      `formation left RIGHT after reaching it, with the threat stationary:\n${JSON.stringify(log)}`
    ).toBe(true);
  });

  it("reshuffles the formation's facing when a melee threat relocates from east to south between ticks", () => {
    // Two independent single-tick snapshots (not a continuous run — reforming AWAY from an already-tight
    // formation only starts turning next tick per currentFacing's "report live shape first" rule, so this
    // isolates each side's OWN scattered-start reform rather than chaining through that transition tick).
    const eastMembers = scatteredSquad({ x: 15, y: 25 });
    const eastSnap = colonySnap({
      draining: ROOM,
      drainRoute: STAGING_ROUTE,
      drainRoomTerrain: OPEN_TERRAIN,
      hostileRoomUnits: { [ROOM]: [hostileAt(40, 25, "melee", 0, { attackParts: 1 })] },
      creeps: eastMembers
    });
    const eastState = drain.squadState(eastSnap)!;
    expect(eastState.facing, `should face the eastern threat:\n${JSON.stringify(eastState)}`).toBe(RIGHT);

    const southMembers = scatteredSquad({ x: 15, y: 25 });
    const southSnap = colonySnap({
      draining: ROOM,
      drainRoute: STAGING_ROUTE,
      drainRoomTerrain: OPEN_TERRAIN,
      hostileRoomUnits: { [ROOM]: [hostileAt(15, 45, "melee", 0, { attackParts: 1 })] },
      creeps: southMembers
    });
    const southState = drain.squadState(southSnap)!;
    expect(southState.facing, `should face the southern threat instead, once it's the one present:\n${JSON.stringify(southState)}`).toBe(BOTTOM);
  });

  it("prioritizes an already-in-range ranged attacker over a not-yet-in-range melee attacker on a different side", () => {
    const members = scatteredSquad({ x: 15, y: 25 });
    // Melee (engage range 1) sits NORTH at range well beyond 1 — not yet hitting.
    // Ranged (engage range 3) sits EAST at exactly range 3 from the anchor slot (15,25) — already hitting —
    // so it wins priority despite the melee creep's raw distance being unremarkable either way.
    const snap = colonySnap({
      draining: ROOM,
      drainRoute: STAGING_ROUTE,
      drainRoomTerrain: OPEN_TERRAIN,
      hostileRoomUnits: {
        [ROOM]: [hostileAt(15, 15, "melee", 0, { attackParts: 1 }), hostileAt(18, 25, "ranged", 0, { rangedAttackParts: 1 })]
      },
      creeps: members
    });
    const state = drain.squadState(snap)!;

    expect(state.facing, `should face the already-engaged ranged attacker (east), not the not-yet-engaged melee one (north):\n${JSON.stringify(state)}`).toBe(
      RIGHT
    );
  });

  it("flips priority to the melee attacker once it closes to melee range, even with the ranged one still present", () => {
    const members = scatteredSquad({ x: 15, y: 25 });
    // Melee now ADJACENT to the anchor slot (15,25) — urgency 1-1=0, tied with the ranged attacker's own
    // urgency (3-3=0) — ties resolve to the FIRST-encountered threat (mostUrgentThreat's documented,
    // deterministic tiebreak), which is the melee entry here (array order), so the formation faces north.
    const snap = colonySnap({
      draining: ROOM,
      drainRoute: STAGING_ROUTE,
      drainRoomTerrain: OPEN_TERRAIN,
      hostileRoomUnits: {
        [ROOM]: [hostileAt(15, 24, "melee", 0, { attackParts: 1 }), hostileAt(18, 25, "ranged", 0, { rangedAttackParts: 1 })]
      },
      creeps: members
    });
    const state = drain.squadState(snap)!;

    expect(state.facing, `tied urgency should resolve to the first-listed (melee, north) threat:\n${JSON.stringify(state)}`).toBe(TOP);
  });

  it("a tower is always the most urgent threat present, overriding any creep threat", () => {
    const members = scatteredSquad({ x: 15, y: 25 });
    const snap = colonySnap({
      draining: ROOM,
      drainRoute: STAGING_ROUTE,
      drainRoomTerrain: OPEN_TERRAIN,
      hostileRoomUnits: { [ROOM]: [hostileAt(15, 24, "melee", 0, { attackParts: 1 })] }, // adjacent north
      hostileRoomTowers: { [ROOM]: [{ id: "tower_far" as Id<StructureTower>, x: 15, y: 45, storeEnergy: 1000, storeCapacity: 1000 }] }, // far south
      creeps: members
    });
    const state = drain.squadState(snap)!;

    expect(state.facing, `a tower must win over an adjacent melee creep (Infinity engageRange):\n${JSON.stringify(state)}`).toBe(BOTTOM);
  });

  it("falls back to goal-directed facing when the room is clear of threats", () => {
    const members = scatteredSquad({ x: 15, y: 25 });
    const snap = colonySnap({
      draining: ROOM,
      drainRoute: STAGING_ROUTE,
      drainRoomTerrain: OPEN_TERRAIN,
      hostileRoomUnits: {},
      creeps: members
    });
    const state = drain.squadState(snap)!;
    // No threats: falls back to drainFacing toward the goal (room center, EAST of the anchor at x=15).
    expect(state.facing, `should fall back to goal-directed facing (east, toward room center) with no threats:\n${JSON.stringify(state)}`).toBe(RIGHT);
  });
});
