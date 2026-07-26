import { beforeEach, describe, expect, it, vi } from "vitest";
import { execute } from "../../src/intents/execute";
import { clearTiles, stubTile } from "../constants";
import { stubGame } from "../helpers";

// A spawn whose room reports all-open terrain (no walls), so spawnExitDirections sees every
// neighbour as potentially walkable unless a tile is explicitly stubbed occupied via stubTile().
function openSpawn(spawnCreep: () => ScreepsReturnCode, x = 25, y = 25, roomName = "W1N1"): Record<string, unknown> {
  return {
    spawnCreep,
    pos: new RoomPosition(x, y, roomName),
    room: { getTerrain: () => ({ get: () => 0 }) }
  };
}

describe("actuator", () => {
  beforeEach(clearTiles);

  it("activates safemode on the intent's room controller", () => {
    const activateSafeMode = vi.fn(() => OK);
    stubGame({ rooms: { W1N1: { controller: { activateSafeMode } } } });

    execute([{ kind: "safeMode", room: "W1N1" }]);

    expect(activateSafeMode).toHaveBeenCalledTimes(1);
  });

  it("spawns with a deterministic name after a successful dry run", () => {
    const spawnCreep = vi.fn(() => OK);
    stubGame({ time: 1234567, objects: { spawn1: openSpawn(spawnCreep) } });
    const memory: CreepMemory = { home: "W1N1", role: "bootstrap" };

    execute([{ kind: "spawn", spawn: "spawn1" as Id<StructureSpawn>, body: [WORK, CARRY, MOVE], memory }]);

    expect(spawnCreep).toHaveBeenCalledTimes(2);
    expect(spawnCreep).toHaveBeenNthCalledWith(1, [WORK, CARRY, MOVE], "bootstrap_W1N1_1234567", {
      memory,
      dryRun: true
    });
    // On open terrain every neighbour is a viable exit, so the real call offers all 8 directions.
    expect(spawnCreep).toHaveBeenNthCalledWith(2, [WORK, CARRY, MOVE], "bootstrap_W1N1_1234567", {
      memory,
      dryRun: false,
      directions: expect.arrayContaining([TOP, TOP_RIGHT, RIGHT, BOTTOM_RIGHT, BOTTOM, BOTTOM_LEFT, LEFT, TOP_LEFT])
    });
  });

  it("does not spawn for real when the dry run fails", () => {
    const spawnCreep = vi.fn(() => ERR_NOT_ENOUGH_ENERGY);
    stubGame({ objects: { spawn1: openSpawn(spawnCreep) } });

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
    stubGame({ objects: { spawn1: openSpawn(spawnCreep) } });

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

  it("offers every open exit but the one an idling creep occupies — never a single locked direction", () => {
    // Reproduces the live pserver deadlock: a supply creep idles on the spawn's road-adjacent tile.
    // The finished creep must still be released through another free tile.
    const spawnCreep = vi.fn(() => OK);
    const spawn = openSpawn(spawnCreep, 17, 36, "W8N3");
    // The road sits TOP_RIGHT of the spawn (18,35) — but a creep is parked on it.
    stubTile("W8N3", 18, 35, { structure: [{ structureType: STRUCTURE_ROAD }], creep: [{}] });
    // Block the tile with a real structure too, to prove non-road blockers are excluded.
    stubTile("W8N3", 16, 36, { structure: [{ structureType: STRUCTURE_TOWER }] });
    stubGame({ objects: { spawn1: spawn } });

    execute([
      {
        kind: "spawn",
        spawn: "spawn1" as Id<StructureSpawn>,
        body: [WORK, MOVE],
        memory: { home: "W8N3", role: "miner" }
      }
    ]);

    const dirs = (spawnCreep.mock.calls[1][2] as { directions: DirectionConstant[] }).directions;
    // More than one option, so an occupied preferred tile can never strand the creep.
    expect(dirs.length).toBeGreaterThan(1);
    // The tower tile (LEFT) is excluded; the occupied road tile (TOP_RIGHT) is still walkable (creeps
    // don't block spawning), so it remains offered — just no longer the *only* option.
    expect(dirs).not.toContain(LEFT);
    expect(dirs).toContain(BOTTOM);
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
  const sources = Array.from({ length: over.sources ?? 2 }, (_, i) => ({ id: `s${i}`, pos: { x: i, y: i } }));
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
    expect(mem.scouted).toEqual({
      tick: 500,
      type: "normal",
      sources: [
        { id: "s0", x: 0, y: 0 },
        { id: "s1", x: 1, y: 1 }
      ],
      mineral: RESOURCE_OXYGEN,
      hostile: false
    });
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

  it("a passive recording reuses the previously recorded sources/mineral instead of re-finding them", () => {
    const room = stubScoutRoom("W1N2", { sources: 2, mineral: RESOURCE_OXYGEN });
    const find = vi.spyOn(room as { find: unknown } as { find: (...a: unknown[]) => unknown }, "find");
    stubGame({ time: 1000, rooms: { W1N2: room } });
    (globalThis as Record<string, unknown>).Memory = {
      rooms: {
        W1N2: {
          scouted: {
            tick: 10,
            type: "normal",
            sources: [{ id: "old0", x: 5, y: 5 }],
            mineral: "H" as MineralConstant,
            hostile: false
          }
        }
      }
    };

    execute([{ kind: "recordScout", room: "W1N2", passive: true }]);

    const mem = (globalThis as { Memory: { rooms: Record<string, { scouted?: unknown }> } }).Memory.rooms.W1N2;
    // tick refreshed, but the stale-static-safe fields (sources/mineral) carried over from the old record.
    expect(mem.scouted).toEqual({
      tick: 1000,
      type: "normal",
      sources: [{ id: "old0", x: 5, y: 5 }],
      mineral: "H" as MineralConstant,
      hostile: false
    });
    expect(find).not.toHaveBeenCalledWith(FIND_SOURCES);
    expect(find).not.toHaveBeenCalledWith(FIND_MINERALS);
  });

  it("a passive recording still does a full observe when the room was never scouted before", () => {
    stubGame({ time: 1000, rooms: { W1N2: stubScoutRoom("W1N2", { sources: 2, mineral: RESOURCE_OXYGEN }) } });
    (globalThis as Record<string, unknown>).Memory = { rooms: {} };

    execute([{ kind: "recordScout", room: "W1N2", passive: true }]);

    const mem = (globalThis as { Memory: { rooms: Record<string, { scouted?: unknown }> } }).Memory.rooms.W1N2;
    expect(mem.scouted).toEqual({
      tick: 1000,
      type: "normal",
      sources: [
        { id: "s0", x: 0, y: 0 },
        { id: "s1", x: 1, y: 1 }
      ],
      mineral: RESOURCE_OXYGEN,
      hostile: false
    });
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
