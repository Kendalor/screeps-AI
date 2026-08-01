// autoPickColonyTarget: throttled empire-wide scan of Memory.rooms for the best colonize candidate,
// live-re-derived against current scouting data, spawned via the same path a manual flag uses.

import { describe, expect, it, vi } from "vitest";
import { autoPickColonyTarget, AUTO_PICK_INTERVAL } from "../../../src/empire/pickColonyTargets";
import { COLONIZER_COST } from "../../../src/behaviors/roles/colonizer";
import { NEW_MINERAL_BONUS } from "../../../src/mining/colonizePotentialScore";
import { testEmpire, colonySnap } from "../../fixtures";
import { stubGame } from "../../helpers";
import type { ColonizationPotential, ScoutInfo } from "../../../src/memory/schema";

function scoutInfo(over: Partial<ScoutInfo> = {}): ScoutInfo {
  return { tick: 0, type: "normal", sources: [], hostile: false, ...over };
}

function potential(over: Partial<ColonizationPotential> = {}): ColonizationPotential {
  return { normal: 10, keeper: 0, keeperMinerals: [], ...over };
}

// A candidate room fully viable on cached data: has an anchor, has a scored (non-empty) neighborhood.
function viableCandidate(over: Partial<ScoutInfo> = {}): ScoutInfo {
  return scoutInfo({
    anchor: { x: 25, y: 25 },
    anchorChecked: true,
    potential: potential(),
    potentialChecked: true,
    ...over
  });
}

function openSpawn(spawnCreep: () => ScreepsReturnCode) {
  return { spawnCreep, pos: { x: 25, y: 25, roomName: "W1N1" }, room: { getTerrain: () => ({ get: () => 0 }) } };
}

// Sets up Game/Memory for a firing tick. `rooms` seeds Memory.rooms[x].scouted; `remotes` seeds
// Memory.colonies[home].remotes for the overlap-guard tests. The live re-check (scoutCandidatesAround)
// walks Game.map.describeExits — stubbed with no exits, so every candidate's own neighborhood is trivially
// "fully scouted" (zero neighbors to be missing) and its live score is just its own summarizePotential
// of nothing, i.e. 0 — tests that need a specific live score seed the candidate room's OWN entry, since
// summarizePotential always excludes distance-0 (the room being scored) from its own sum. To get a
// specific non-zero live score, seed a same-map neighbor via describeExits.
function setUp(rooms: Record<string, ScoutInfo>, spawnCreep: () => ScreepsReturnCode, gclLevel = 10, time = AUTO_PICK_INTERVAL) {
  stubGame({ time, objects: { spawn1: openSpawn(spawnCreep) } });
  const game = (globalThis as { Game: Record<string, unknown> }).Game;
  game.gcl = { level: gclLevel };
  game.map = {
    findRoute: (_from: string, dest: string) => [{ room: dest }],
    describeExits: () => ({}), // no neighbors — every candidate's neighborhood is trivially "fully scouted"
    getRoomStatus: () => ({ status: "normal" })
  };
  (globalThis as { Memory: Record<string, unknown> }).Memory = {
    creeps: {},
    rooms: Object.fromEntries(Object.entries(rooms).map(([room, scouted]) => [room, { scouted }])),
    colonies: {}
  };
}

describe("autoPickColonyTarget", () => {
  it("does nothing off the throttle tick", () => {
    const spawnCreep = vi.fn(() => OK);
    setUp({ W5N5: viableCandidate() }, spawnCreep, 10, AUTO_PICK_INTERVAL + 1);
    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: COLONIZER_COST, energyAvailable: COLONIZER_COST, spawns: [{ id: "spawn1" as Id<StructureSpawn>, busy: false }] }));

    autoPickColonyTarget(world);

    expect(spawnCreep).not.toHaveBeenCalled();
  });

  it("does nothing when the GCL room budget is already spent", () => {
    const spawnCreep = vi.fn(() => OK);
    setUp({ W5N5: viableCandidate() }, spawnCreep, /* gclLevel */ 1);
    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: COLONIZER_COST, energyAvailable: COLONIZER_COST, spawns: [{ id: "spawn1" as Id<StructureSpawn>, busy: false }] }));

    autoPickColonyTarget(world);

    expect(spawnCreep).not.toHaveBeenCalled();
  });

  it("spawns a colonizer for the only viable candidate", () => {
    const spawnCreep = vi.fn(() => OK);
    setUp({ W5N5: viableCandidate() }, spawnCreep);
    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: COLONIZER_COST, energyAvailable: COLONIZER_COST, spawns: [{ id: "spawn1" as Id<StructureSpawn>, busy: false }] }));

    autoPickColonyTarget(world);

    expect(spawnCreep).toHaveBeenCalled();
    const [, , opts] = spawnCreep.mock.calls[0] as [BodyPartConstant[], string, { memory: CreepMemory }];
    expect(opts.memory.role).toBe("colonizer");
    expect(opts.memory.targetRoom).toBe("W5N5");
  });

  it("ignores a room with no anchor", () => {
    const spawnCreep = vi.fn(() => OK);
    setUp({ W5N5: viableCandidate({ anchor: undefined }) }, spawnCreep);
    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: COLONIZER_COST, energyAvailable: COLONIZER_COST, spawns: [{ id: "spawn1" as Id<StructureSpawn>, busy: false }] }));

    autoPickColonyTarget(world);

    expect(spawnCreep).not.toHaveBeenCalled();
  });

  it("ignores a room whose potential hasn't been scored yet", () => {
    const spawnCreep = vi.fn(() => OK);
    setUp({ W5N5: viableCandidate({ potentialChecked: false, potential: undefined }) }, spawnCreep);
    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: COLONIZER_COST, energyAvailable: COLONIZER_COST, spawns: [{ id: "spawn1" as Id<StructureSpawn>, busy: false }] }));

    autoPickColonyTarget(world);

    expect(spawnCreep).not.toHaveBeenCalled();
  });

  it("ignores an owned or hostile room", () => {
    const spawnCreep = vi.fn(() => OK);
    setUp({ W5N5: viableCandidate({ owner: "someoneElse" }), W6N6: viableCandidate({ hostile: true }) }, spawnCreep);
    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: COLONIZER_COST, energyAvailable: COLONIZER_COST, spawns: [{ id: "spawn1" as Id<StructureSpawn>, busy: false }] }));

    autoPickColonyTarget(world);

    expect(spawnCreep).not.toHaveBeenCalled();
  });

  it("prefers the higher-scoring candidate", () => {
    const spawnCreep = vi.fn(() => OK);
    setUp(
      {
        W5N5: viableCandidate({ potential: potential({ normal: 5 }) }),
        W6N6: viableCandidate({ potential: potential({ normal: 50 }) })
      },
      spawnCreep
    );
    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: COLONIZER_COST, energyAvailable: COLONIZER_COST, spawns: [{ id: "spawn1" as Id<StructureSpawn>, busy: false }] }));

    autoPickColonyTarget(world);

    const [, , opts] = spawnCreep.mock.calls[0] as [BodyPartConstant[], string, { memory: CreepMemory }];
    expect(opts.memory.targetRoom).toBe("W6N6");
  });

  it("excludes a room already selected as a remote by any colony", () => {
    const spawnCreep = vi.fn(() => OK);
    setUp({ W5N5: viableCandidate() }, spawnCreep);
    (globalThis as { Memory: { colonies: Record<string, unknown> } }).Memory.colonies.W1N1 = {
      remotes: [{ room: "W5N5", sources: [], reserved: false }]
    };
    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: COLONIZER_COST, energyAvailable: COLONIZER_COST, spawns: [{ id: "spawn1" as Id<StructureSpawn>, busy: false }] }));

    autoPickColonyTarget(world);

    expect(spawnCreep).not.toHaveBeenCalled();
  });

  it("falls through to the next-best candidate when the top one has no fitting sponsor", () => {
    const spawnCreep = vi.fn(() => OK);
    setUp(
      {
        W5N5: viableCandidate({ potential: potential({ normal: 50 }) }), // best score, but unreachable below
        W6N6: viableCandidate({ potential: potential({ normal: 5 }) })
      },
      spawnCreep
    );
    // Make W5N5 unreachable from every colony, W6N6 reachable.
    (globalThis as { Game: { map: { findRoute: unknown } } }).Game.map.findRoute = (_from: string, dest: string) =>
      dest === "W5N5" ? ERR_NO_PATH : [{ room: dest }];
    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: COLONIZER_COST, energyAvailable: COLONIZER_COST, spawns: [{ id: "spawn1" as Id<StructureSpawn>, busy: false }] }));

    autoPickColonyTarget(world);

    const [, , opts] = spawnCreep.mock.calls[0] as [BodyPartConstant[], string, { memory: CreepMemory }];
    expect(opts.memory.targetRoom).toBe("W6N6");
  });

  it("bonuses a candidate with a new mineral the empire doesn't already have", () => {
    const spawnCreep = vi.fn(() => OK);
    setUp(
      {
        // Equal base potential; W6N6 additionally has a mineral no owned colony has yet.
        W5N5: viableCandidate({ potential: potential({ normal: 10 }) }),
        W6N6: viableCandidate({ potential: potential({ normal: 10 }), mineral: "X" as MineralConstant })
      },
      spawnCreep
    );
    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: COLONIZER_COST, energyAvailable: COLONIZER_COST, spawns: [{ id: "spawn1" as Id<StructureSpawn>, busy: false }] }));

    autoPickColonyTarget(world);

    expect(NEW_MINERAL_BONUS).toBeGreaterThan(0); // sanity: the bonus this test relies on is actually positive
    const [, , opts] = spawnCreep.mock.calls[0] as [BodyPartConstant[], string, { memory: CreepMemory }];
    expect(opts.memory.targetRoom).toBe("W6N6");
  });
});
