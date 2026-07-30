import { beforeEach, describe, expect, it, vi } from "vitest";
import { execute } from "../../src/intents/execute";
import { clearTiles, stubPathFinder, stubTile } from "../constants";
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

  it("repairs a structure with the given tower", () => {
    const repair = vi.fn(() => OK);
    const tower = { repair };
    const target = {};
    stubGame({ objects: { tower1: tower, target1: target } });

    execute([
      { kind: "towerRepair", tower: "tower1" as Id<StructureTower>, target: "target1" as Id<Structure> }
    ]);

    expect(repair).toHaveBeenCalledWith(target);
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

  it("persists a remote source's container id into its selected-remote memory entry", () => {
    stubGame();
    (globalThis as Record<string, unknown>).Memory = {
      colonies: {
        W1N1: {
          sources: {},
          danger: 0,
          remotes: [{ room: "W2N1", reserved: false, sources: [{ id: "s1" as Id<Source>, x: 25, y: 25, distance: 40 }] }]
        }
      }
    };

    execute([
      { kind: "recordRemoteContainer", room: "W1N1", remoteRoom: "W2N1", source: "s1" as Id<Source>, container: "cont1" as Id<StructureContainer> }
    ]);

    const mem = (globalThis as { Memory: { colonies: Record<string, { remotes: { room: string; sources: { id: string; containerId?: string }[] }[] }> } })
      .Memory.colonies.W1N1;
    expect(mem.remotes[0].sources[0].containerId).toBe("cont1");
  });

  it("does nothing when the remote source named isn't currently selected", () => {
    stubGame();
    (globalThis as Record<string, unknown>).Memory = {
      colonies: { W1N1: { sources: {}, danger: 0, remotes: [] } }
    };

    execute([
      { kind: "recordRemoteContainer", room: "W1N1", remoteRoom: "W2N1", source: "s1" as Id<Source>, container: "cont1" as Id<StructureContainer> }
    ]);

    const mem = (globalThis as { Memory: { colonies: Record<string, { remotes: unknown[] }> } }).Memory.colonies.W1N1;
    expect(mem.remotes).toEqual([]);
  });

  it("persists a remote room's dangerUntil into its selected-remote memory entry", () => {
    stubGame();
    (globalThis as Record<string, unknown>).Memory = {
      colonies: {
        W1N1: {
          sources: {},
          danger: 0,
          remotes: [{ room: "W2N1", reserved: false, sources: [{ id: "s1" as Id<Source>, x: 25, y: 25, distance: 40 }] }]
        }
      }
    };

    execute([{ kind: "recordRemoteDanger", room: "W1N1", remoteRoom: "W2N1", dangerUntil: 1500 }]);

    const mem = (globalThis as { Memory: { colonies: Record<string, { remotes: { room: string; dangerUntil?: number }[] }> } })
      .Memory.colonies.W1N1;
    expect(mem.remotes[0].dangerUntil).toBe(1500);
  });

  it("clears a remote room's dangerUntil when this tick's vision reads it clear", () => {
    stubGame();
    (globalThis as Record<string, unknown>).Memory = {
      colonies: {
        W1N1: {
          sources: {},
          danger: 0,
          remotes: [
            { room: "W2N1", reserved: false, dangerUntil: 1500, sources: [{ id: "s1" as Id<Source>, x: 25, y: 25, distance: 40 }] }
          ]
        }
      }
    };

    execute([{ kind: "recordRemoteDanger", room: "W1N1", remoteRoom: "W2N1", dangerUntil: undefined }]);

    const mem = (globalThis as { Memory: { colonies: Record<string, { remotes: { room: string; dangerUntil?: number }[] }> } })
      .Memory.colonies.W1N1;
    expect(mem.remotes[0].dangerUntil).toBeUndefined();
  });

  it("repurposes a creep: sets the new role and clears task and op stamp", () => {
    const creep = {
      memory: { home: "W1N1", role: "builder", op: "building:W1N1", task: { step: 2, target: "x" } } as CreepMemory
    };
    stubGame({ objects: { c1: creep } });

    execute([{ kind: "setCreepRole", creep: "c1" as Id<Creep>, role: "upgrader" }]);

    expect(creep.memory.role).toBe("upgrader");
    expect(creep.memory.task).toBeUndefined();
    expect(creep.memory.op).toBeUndefined();
  });

  // setRemotes replaces pickRemotes' cheap ranking-time distance estimate with the ground-truth
  // PathFinder path, computed once and cached on the *remote* room's memory (indexed by home room name)
  // so a future call never re-runs PathFinder for a source whose position — and whose home anchor —
  // hasn't moved.
  describe("setRemotes", () => {
    function memoryWithAnchor(anchor?: { x: number; y: number }): void {
      (globalThis as Record<string, unknown>).Memory = {
        colonies: { W1N1: { sources: {}, remotes: [], danger: 0, ...(anchor ? { anchor } : {}) } },
        rooms: { W2N1: { scouted: { tick: 0, type: "normal", sources: [{ id: "s1", x: 25, y: 25 }], hostile: false } } }
      };
    }
    type ColoniesMemory = {
      colonies: Record<string, { remotes: { room: string; sources: { id: string; distance: number; route?: { room: string; x: number; y: number }[] }[] }[] }>;
      rooms: Record<string, { scouted: { sources: { paths?: Record<string, string>; route?: Record<string, { room: string; x: number; y: number }[]> }[] } }>;
    };
    const mem = () => (globalThis as unknown as { Memory: ColoniesMemory }).Memory;

    it("computes and caches a real PathFinder distance and route for a newly selected source", () => {
      stubGame();
      memoryWithAnchor({ x: 25, y: 25 });
      // (49,25)/(0,25) are the exit tiles on each side of the crossing — real, but excluded from
      // the buildable route cache (see remotePath.ts's isExitTile); distance/paths still count them.
      const path = [
        new RoomPosition(26, 25, "W1N1"),
        new RoomPosition(49, 25, "W1N1"),
        new RoomPosition(0, 25, "W2N1"),
        new RoomPosition(1, 25, "W2N1")
      ];
      stubPathFinder(() => ({ path, incomplete: false, ops: 10, cost: 10 }));

      // pickRemotes' own estimate (999) must be discarded in favour of the real path's length.
      const remotes = [{ room: "W2N1", reserved: false, sources: [{ id: "s1" as Id<Source>, x: 25, y: 25, distance: 999 }] }];
      execute([{ kind: "setRemotes", room: "W1N1", remotes }]);

      expect(mem().colonies.W1N1.remotes[0].sources[0].distance).toBe(path.length);
      expect(mem().rooms.W2N1.scouted.sources[0].paths?.W1N1).toHaveLength(path.length);
      const route = mem().rooms.W2N1.scouted.sources[0].route?.W1N1;
      expect(route).toEqual([
        { room: "W1N1", x: 26, y: 25 },
        { room: "W2N1", x: 1, y: 25 }
      ]);
      expect(mem().colonies.W1N1.remotes[0].sources[0].route).toEqual(route);
    });

    it("reuses a cached path instead of calling PathFinder again", () => {
      stubGame();
      memoryWithAnchor({ x: 25, y: 25 });
      mem().rooms.W2N1.scouted.sources[0].paths = { W1N1: "121" }; // pre-cached, length 3
      mem().rooms.W2N1.scouted.sources[0].route = { W1N1: [{ room: "W2N1", x: 1, y: 25 }] };
      // No stubPathFinder() call: PathFinder.search would throw if this test hit it.

      const remotes = [{ room: "W2N1", reserved: false, sources: [{ id: "s1" as Id<Source>, x: 25, y: 25, distance: 999 }] }];
      execute([{ kind: "setRemotes", room: "W1N1", remotes }]);

      expect(mem().colonies.W1N1.remotes[0].sources[0].distance).toBe(3);
      expect(mem().colonies.W1N1.remotes[0].sources[0].route).toEqual([{ room: "W2N1", x: 1, y: 25 }]);
    });

    it("recomputes when only the digit-string cache predates the route cache", () => {
      stubGame();
      memoryWithAnchor({ x: 25, y: 25 });
      mem().rooms.W2N1.scouted.sources[0].paths = { W1N1: "121" }; // pre-existing cache, no route sibling
      const path = [new RoomPosition(26, 25, "W1N1")];
      stubPathFinder(() => ({ path, incomplete: false, ops: 10, cost: 10 }));

      const remotes = [{ room: "W2N1", reserved: false, sources: [{ id: "s1" as Id<Source>, x: 25, y: 25, distance: 999 }] }];
      execute([{ kind: "setRemotes", room: "W1N1", remotes }]);

      expect(mem().colonies.W1N1.remotes[0].sources[0].distance).toBe(path.length);
      expect(mem().rooms.W2N1.scouted.sources[0].route?.W1N1).toEqual([{ room: "W1N1", x: 26, y: 25 }]);
    });

    it("drops a source PathFinder can't reach at all", () => {
      stubGame();
      memoryWithAnchor({ x: 25, y: 25 });
      stubPathFinder(() => ({ path: [], incomplete: true, ops: 2000, cost: 0 }));

      const remotes = [{ room: "W2N1", reserved: false, sources: [{ id: "s1" as Id<Source>, x: 25, y: 25, distance: 999 }] }];
      execute([{ kind: "setRemotes", room: "W1N1", remotes }]);

      expect(mem().colonies.W1N1.remotes).toEqual([]);
    });

    it("drops a newly-selected source when the home has no anchor yet, without calling PathFinder", () => {
      stubGame();
      memoryWithAnchor(undefined);

      const remotes = [{ room: "W2N1", reserved: false, sources: [{ id: "s1" as Id<Source>, x: 25, y: 25, distance: 999 }] }];
      execute([{ kind: "setRemotes", room: "W1N1", remotes }]);

      expect(mem().colonies.W1N1.remotes).toEqual([]);
    });

    it("carries a room's dangerUntil forward across a re-selection instead of resetting it", () => {
      stubGame();
      memoryWithAnchor({ x: 25, y: 25 });
      mem().rooms.W2N1.scouted.sources[0].paths = { W1N1: "121" };
      mem().rooms.W2N1.scouted.sources[0].route = { W1N1: [{ room: "W2N1", x: 1, y: 25 }] };
      // A prior invasion flagged this room dangerous; pickRemotes' own output never carries dangerUntil.
      (mem().colonies.W1N1.remotes as { room: string; reserved: boolean; dangerUntil?: number; sources: unknown[] }[]) = [
        { room: "W2N1", reserved: false, dangerUntil: 5000, sources: [] }
      ];

      const remotes = [{ room: "W2N1", reserved: false, sources: [{ id: "s1" as Id<Source>, x: 25, y: 25, distance: 999 }] }];
      execute([{ kind: "setRemotes", room: "W1N1", remotes }]);

      expect((mem().colonies.W1N1.remotes[0] as { dangerUntil?: number }).dangerUntil).toBe(5000);
    });
  });

  // recordSourcePath is the pre-selection twin of setRemotes' own path resolution: scouting emits it for
  // an in-range scouted source so pickRemotes can rank/price on the real distance instead of the cheap
  // estimate. Same resolvePathToSource helper under the hood, same cache.
  describe("recordSourcePath", () => {
    function memoryWithScouted(): void {
      (globalThis as Record<string, unknown>).Memory = {
        colonies: {},
        rooms: { W2N1: { scouted: { tick: 0, type: "normal", sources: [{ id: "s1", x: 25, y: 25 }], hostile: false } } }
      };
    }
    const roomMem = () =>
      (globalThis as unknown as {
        Memory: { rooms: Record<string, { scouted: { sources: { paths?: Record<string, string> }[] } }> };
      }).Memory.rooms;

    it("computes and caches a real path for a scouted source", () => {
      stubGame();
      memoryWithScouted();
      const path = [new RoomPosition(26, 25, "W1N1"), new RoomPosition(1, 25, "W2N1")];
      stubPathFinder(() => ({ path, incomplete: false, ops: 10, cost: 10 }));

      execute([
        { kind: "recordSourcePath", home: "W1N1", room: "W2N1", anchor: { x: 25, y: 25 }, source: "s1" as Id<Source> }
      ]);

      expect(roomMem().W2N1.scouted.sources[0].paths?.W1N1).toHaveLength(path.length);
    });

    it("does nothing when the scouted source can no longer be found", () => {
      stubGame();
      memoryWithScouted();

      execute([
        {
          kind: "recordSourcePath",
          home: "W1N1",
          room: "W2N1",
          anchor: { x: 25, y: 25 },
          source: "gone" as Id<Source>
        }
      ]);

      expect(roomMem().W2N1.scouted.sources[0].paths).toBeUndefined();
    });
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

    execute([{ kind: "setScoutTarget", creep: "scout1" as Id<Creep>, candidates: ["W1N3"] }]);

    expect(creep.memory.scoutTarget).toBe("W1N3");
    expect(creep.memory.route).toEqual({ dest: "W1N3", rooms: ["W1N2", "W1N3"], index: 0 });
  });

  // The whole point of routing this through Game.map.findRoute rather than a linear-distance estimate:
  // a candidate that's Chebyshev-closer but reached by a longer real route must lose to one with fewer
  // actual room-graph hops.
  it("picks the candidate with the fewest findRoute hops, not the Chebyshev-nearest one", () => {
    const creep = { room: { name: "W1N1" }, memory: { home: "W1N1", role: "scout" } as CreepMemory };
    stubGame({ objects: { scout1: creep } });
    (globalThis as Record<string, unknown>).Memory = { rooms: {} };
    const findRoute = vi.fn((_from: string, dest: string) =>
      dest === "W1N2" ? [{ room: "W1N9" }, { room: "W1N8" }, { room: "W1N2" }] : [{ room: "W1N3" }]
    );
    (globalThis as { Game: { map: unknown } }).Game.map = { findRoute };

    execute([{ kind: "setScoutTarget", creep: "scout1" as Id<Creep>, candidates: ["W1N2", "W1N3"] }]);

    expect(creep.memory.scoutTarget).toBe("W1N3");
    expect(creep.memory.route).toEqual({ dest: "W1N3", rooms: ["W1N3"], index: 0 });
  });

  it("breaks a findRoute tie deterministically by room name", () => {
    const creep = { room: { name: "W1N1" }, memory: { home: "W1N1", role: "scout" } as CreepMemory };
    stubGame({ objects: { scout1: creep } });
    (globalThis as Record<string, unknown>).Memory = { rooms: {} };
    (globalThis as { Game: { map: unknown } }).Game.map = {
      findRoute: () => [{ room: "X" }]
    };

    execute([{ kind: "setScoutTarget", creep: "scout1" as Id<Creep>, candidates: ["W2N1", "W1N2"] }]);

    expect(creep.memory.scoutTarget).toBe("W1N2");
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
