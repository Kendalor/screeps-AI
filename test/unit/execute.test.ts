import { describe, expect, it, vi } from "vitest";
import { execute } from "../../src/intents/execute";
import { stubGame } from "../helpers";

describe("actuator", () => {
  it("activates safemode on the intent's room controller", () => {
    const activateSafeMode = vi.fn(() => OK);
    stubGame({ rooms: { W1N1: { controller: { activateSafeMode } } } });

    execute([{ kind: "safeMode", room: "W1N1" }]);

    expect(activateSafeMode).toHaveBeenCalledTimes(1);
  });

  it("spawns with a deterministic name after a successful dry run", () => {
    const spawnCreep = vi.fn(() => OK);
    stubGame({ time: 1234567, objects: { spawn1: { spawnCreep, pos: { findInRange: () => [] } } } });
    const memory: CreepMemory = { home: "W1N1", role: "bootstrap" };

    execute([{ kind: "spawn", spawn: "spawn1" as Id<StructureSpawn>, body: [WORK, CARRY, MOVE], memory }]);

    expect(spawnCreep).toHaveBeenCalledTimes(2);
    expect(spawnCreep).toHaveBeenNthCalledWith(1, [WORK, CARRY, MOVE], "bootstrap_W1N1_1234567", {
      memory,
      dryRun: true
    });
    expect(spawnCreep).toHaveBeenNthCalledWith(2, [WORK, CARRY, MOVE], "bootstrap_W1N1_1234567", {
      memory,
      dryRun: false
    });
  });

  it("does not spawn for real when the dry run fails", () => {
    const spawnCreep = vi.fn(() => ERR_NOT_ENOUGH_ENERGY);
    stubGame({ objects: { spawn1: { spawnCreep, pos: { findInRange: () => [] } } } });

    execute([
      {
        kind: "spawn",
        spawn: "spawn1" as Id<StructureSpawn>,
        body: [WORK, CARRY, MOVE],
        memory: { home: "W1N1", role: "bootstrap" }
      }
    ]);

    expect(spawnCreep).toHaveBeenCalledTimes(1);
    expect(spawnCreep.mock.calls[0][2]).toMatchObject({ dryRun: true });
  });

  it("passes an explicit spawn direction through to the real spawn call", () => {
    const spawnCreep = vi.fn(() => OK);
    stubGame({ objects: { spawn1: { spawnCreep, pos: { findInRange: () => [] } } } });

    execute([
      {
        kind: "spawn",
        spawn: "spawn1" as Id<StructureSpawn>,
        body: [WORK, CARRY, MOVE],
        memory: { home: "W1N1", role: "bootstrap" },
        dir: 3 as DirectionConstant
      }
    ]);

    expect(spawnCreep.mock.calls[1][2]).toMatchObject({ dryRun: false, directions: [3] });
  });

  it("persists a source's mining spot and container into colony memory", () => {
    stubGame();
    (globalThis as Record<string, unknown>).Memory = { colonies: {} };

    execute([
      {
        kind: "recordSourceSpot",
        room: "W1N1",
        source: "src1" as Id<Source>,
        spot: { x: 19, y: 11 },
        container: "cont1" as Id<StructureContainer>
      }
    ]);

    const mem = (globalThis as { Memory: { colonies: Record<string, { sources: Record<string, unknown> }> } })
      .Memory.colonies.W1N1;
    expect(mem.sources.src1).toEqual({ spot: { x: 19, y: 11 }, containerId: "cont1" });
  });

  it("keeps a previously recorded container id when this tick resolved none", () => {
    stubGame();
    (globalThis as Record<string, unknown>).Memory = {
      colonies: { W1N1: { sources: { src1: { spot: { x: 19, y: 11 }, containerId: "cont1" } }, remotes: [], danger: 0 } }
    };

    // A container momentarily out of vision must not wipe the recorded id.
    execute([{ kind: "recordSourceSpot", room: "W1N1", source: "src1" as Id<Source>, spot: { x: 19, y: 11 } }]);

    const mem = (globalThis as { Memory: { colonies: Record<string, { sources: Record<string, { containerId?: string }> }> } })
      .Memory.colonies.W1N1;
    expect(mem.sources.src1.containerId).toBe("cont1");
  });
});

// A live room stub whose finds return the given sources/mineral and controller. find is keyed by the
// FIND_* constant execute uses.
function stubScoutRoom(
  name: string,
  over: { sources?: number; mineral?: string; controller?: unknown } = {}
): unknown {
  const sources = Array.from({ length: over.sources ?? 2 }, (_, i) => ({ id: `s${i}` }));
  const minerals = over.mineral ? [{ mineralType: over.mineral }] : [];
  return {
    name,
    controller: over.controller,
    find: (type: number) => (type === FIND_SOURCES ? sources : type === FIND_MINERALS ? minerals : [])
  };
}

describe("actuator — scouting", () => {
  it("records what a scout sees of its room into RoomMemory", () => {
    stubGame({ time: 500, rooms: { W1N2: stubScoutRoom("W1N2", { sources: 2, mineral: RESOURCE_OXYGEN }) } });
    (globalThis as Record<string, unknown>).Memory = { rooms: {} };

    execute([{ kind: "recordScout", room: "W1N2" }]);

    const mem = (globalThis as { Memory: { rooms: Record<string, { scouted?: unknown }> } }).Memory.rooms.W1N2;
    expect(mem.scouted).toEqual({ tick: 500, type: "normal", sources: 2, mineral: RESOURCE_OXYGEN, hostile: false });
  });

  it("marks a room hostile when its controller is owned by someone else", () => {
    const room = stubScoutRoom("W1N2", { controller: { owner: { username: "Enemy" }, my: false } });
    stubGame({ time: 10, rooms: { W1N2: room } });
    (globalThis as Record<string, unknown>).Memory = { rooms: {} };

    execute([{ kind: "recordScout", room: "W1N2" }]);

    const mem = (globalThis as { Memory: { rooms: Record<string, { scouted?: { owner?: string; hostile?: boolean } }> } })
      .Memory.rooms.W1N2;
    expect(mem.scouted).toMatchObject({ owner: "Enemy", hostile: true });
  });

  it("does nothing for a room the scout has no vision of", () => {
    stubGame({ rooms: {} });
    (globalThis as Record<string, unknown>).Memory = { rooms: {} };
    execute([{ kind: "recordScout", room: "W9N9" }]);
    expect((globalThis as { Memory: { rooms: Record<string, unknown> } }).Memory.rooms.W9N9).toBeUndefined();
  });

  it("assigns a scout its target and a route computed by findRoute", () => {
    const creep = { room: { name: "W1N1" }, memory: { home: "W1N1", role: "scout" } as CreepMemory };
    stubGame({ objects: { scout1: creep } });
    (globalThis as Record<string, unknown>).Memory = { rooms: {} };
    (globalThis as { Game: { map: unknown } }).Game.map = {
      findRoute: () => [{ room: "W1N2" }, { room: "W1N3" }]
    };

    execute([{ kind: "setScoutTarget", creep: "scout1" as Id<Creep>, targetRoom: "W1N3" }]);

    expect(creep.memory.scoutTarget).toBe("W1N3");
    expect(creep.memory.route).toEqual({ dest: "W1N3", rooms: ["W1N2", "W1N3"], index: 0 });
  });

  it("grows the scouting radius, capped, on advanceScoutRadius", () => {
    stubGame();
    (globalThis as Record<string, unknown>).Memory = { scouting: { radius: 1 } };

    execute([{ kind: "advanceScoutRadius" }]);
    expect((globalThis as { Memory: { scouting: { radius: number } } }).Memory.scouting.radius).toBe(2);

    // At the cap it stays put rather than growing without bound.
    (globalThis as { Memory: { scouting: { radius: number } } }).Memory.scouting.radius = 6;
    execute([{ kind: "advanceScoutRadius" }]);
    expect((globalThis as { Memory: { scouting: { radius: number } } }).Memory.scouting.radius).toBe(6);
  });
});
