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

  // gh #60's four new market dispatch cases — same stubGame() + spy pattern as every other case in this
  // file; stubGame doesn't stub Game.market itself, so each case attaches it directly afterward.
  it("deals a market order via Game.market.deal", () => {
    const deal = vi.fn(() => OK);
    stubGame();
    (globalThis as { Game: { market: unknown } }).Game.market = { deal };

    execute([{ kind: "marketDeal", order: "order1", amount: 500, room: "W1N1" }]);

    expect(deal).toHaveBeenCalledTimes(1);
    expect(deal).toHaveBeenCalledWith("order1", 500, "W1N1");
  });

  it("creates a market order via Game.market.createOrder", () => {
    const createOrder = vi.fn(() => OK);
    stubGame();
    (globalThis as { Game: { market: unknown } }).Game.market = { createOrder };

    execute([{ kind: "marketCreateOrder", room: "W1N1", resource: RESOURCE_OXYGEN, amount: 3000, price: 2.5, type: "buy" }]);

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder).toHaveBeenCalledWith({
      type: ORDER_BUY,
      resourceType: RESOURCE_OXYGEN,
      price: 2.5,
      totalAmount: 3000,
      roomName: "W1N1"
    });
  });

  it("creates a sell order with ORDER_SELL when the intent's type is sell", () => {
    const createOrder = vi.fn(() => OK);
    stubGame();
    (globalThis as { Game: { market: unknown } }).Game.market = { createOrder };

    execute([{ kind: "marketCreateOrder", room: "W1N1", resource: RESOURCE_OXYGEN, amount: 3000, price: 2.5, type: "sell" }]);

    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ type: ORDER_SELL }));
  });

  it("reprices a market order via Game.market.changeOrderPrice", () => {
    const changeOrderPrice = vi.fn(() => OK);
    stubGame();
    (globalThis as { Game: { market: unknown } }).Game.market = { changeOrderPrice };

    execute([{ kind: "marketReprice", order: "order1", price: 3.1 }]);

    expect(changeOrderPrice).toHaveBeenCalledTimes(1);
    expect(changeOrderPrice).toHaveBeenCalledWith("order1", 3.1);
  });

  it("extends a market order via Game.market.extendOrder", () => {
    const extendOrder = vi.fn(() => OK);
    stubGame();
    (globalThis as { Game: { market: unknown } }).Game.market = { extendOrder };

    execute([{ kind: "marketExtendOrder", order: "order1", amount: 1000 }]);

    expect(extendOrder).toHaveBeenCalledTimes(1);
    expect(extendOrder).toHaveBeenCalledWith("order1", 1000);
  });

  it("cancels a market order via Game.market.cancelOrder", () => {
    const cancelOrder = vi.fn(() => OK);
    stubGame();
    (globalThis as { Game: { market: unknown } }).Game.market = { cancelOrder };

    execute([{ kind: "marketCancelOrder", order: "order1" }]);

    expect(cancelOrder).toHaveBeenCalledTimes(1);
    expect(cancelOrder).toHaveBeenCalledWith("order1");
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

  describe("recordMineralRegen", () => {
    it("records a newly-depleted deposit's regen deadline", () => {
      stubGame();
      (globalThis as Record<string, unknown>).Memory = { colonies: { W1N1: { sources: {}, danger: 0, remotes: [] } } };

      execute([{ kind: "recordMineralRegen", room: "W1N1", regeneratesAt: 1500 }]);

      const mem = (globalThis as { Memory: { colonies: Record<string, { mineral?: { regeneratesAt?: number } }> } }).Memory.colonies.W1N1;
      expect(mem.mineral?.regeneratesAt).toBe(1500);
    });

    it("clears the cached regen deadline once regen completes with vision (moves down, not just up)", () => {
      stubGame();
      (globalThis as Record<string, unknown>).Memory = {
        colonies: { W1N1: { sources: {}, danger: 0, remotes: [], mineral: { regeneratesAt: 1500 } } }
      };

      execute([{ kind: "recordMineralRegen", room: "W1N1", regeneratesAt: undefined }]);

      const mem = (globalThis as { Memory: { colonies: Record<string, { mineral?: { regeneratesAt?: number } }> } }).Memory.colonies.W1N1;
      expect(mem.mineral?.regeneratesAt).toBeUndefined();
    });
  });

  describe("recordDrainSample (#40)", () => {
    it("starts a fresh history and appends the first sample when none exists yet", () => {
      stubGame();
      (globalThis as Record<string, unknown>).Memory = { colonies: { W1N1: { sources: {}, danger: 0, remotes: [] } } };

      execute([{ kind: "recordDrainSample", room: "W1N1", target: "W2N1", tick: 100, towerEnergy: 400, storageEnergy: 5000 }]);

      const mem = (
        globalThis as {
          Memory: { colonies: Record<string, { drainHistory?: { room: string; samples: unknown[] } }> };
        }
      ).Memory.colonies.W1N1;
      expect(mem.drainHistory).toEqual({
        room: "W2N1",
        samples: [{ tick: 100, towerEnergy: 400, storageEnergy: 5000 }]
      });
    });

    it("appends to the existing history when the sample's target matches the stored history's room", () => {
      stubGame();
      (globalThis as Record<string, unknown>).Memory = {
        colonies: {
          W1N1: {
            sources: {},
            danger: 0,
            remotes: [],
            drainHistory: { room: "W2N1", samples: [{ tick: 100, towerEnergy: 400, storageEnergy: 5000 }] }
          }
        }
      };

      execute([{ kind: "recordDrainSample", room: "W1N1", target: "W2N1", tick: 101, towerEnergy: 300, storageEnergy: 5100 }]);

      const mem = (
        globalThis as {
          Memory: { colonies: Record<string, { drainHistory?: { room: string; samples: unknown[] } }> };
        }
      ).Memory.colonies.W1N1;
      expect(mem.drainHistory?.samples).toEqual([
        { tick: 100, towerEnergy: 400, storageEnergy: 5000 },
        { tick: 101, towerEnergy: 300, storageEnergy: 5100 }
      ]);
    });

    it("resets to a fresh history (discarding old samples) when the target room changes", () => {
      stubGame();
      (globalThis as Record<string, unknown>).Memory = {
        colonies: {
          W1N1: {
            sources: {},
            danger: 0,
            remotes: [],
            drainHistory: { room: "W2N1", samples: [{ tick: 100, towerEnergy: 400, storageEnergy: 5000 }] }
          }
        }
      };

      // Squad switched to a new drain target, W3N1 — the old W2N1 history must not carry over.
      execute([{ kind: "recordDrainSample", room: "W1N1", target: "W3N1", tick: 200, towerEnergy: 900, storageEnergy: 0 }]);

      const mem = (
        globalThis as {
          Memory: { colonies: Record<string, { drainHistory?: { room: string; samples: unknown[] } }> };
        }
      ).Memory.colonies.W1N1;
      expect(mem.drainHistory).toEqual({
        room: "W3N1",
        samples: [{ tick: 200, towerEnergy: 900, storageEnergy: 0 }]
      });
    });
  });

  it("repurposes a creep: sets the new role, clears task, and re-stamps op for the new owner", () => {
    const creep = {
      memory: { home: "W1N1", role: "builder", op: "building:W1N1", task: { step: 2, target: "x" } } as CreepMemory
    };
    stubGame({ objects: { c1: creep } });

    execute([{ kind: "setCreepRole", creep: "c1" as Id<Creep>, role: "upgrader", op: "upgrading:W1N1" }]);

    expect(creep.memory.role).toBe("upgrader");
    expect(creep.memory.task).toBeUndefined();
    expect(creep.memory.op).toBe("upgrading:W1N1");
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
      execute([{ kind: "setRemotes", room: "W1N1", remotes, strikes: {} }]);

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
      execute([{ kind: "setRemotes", room: "W1N1", remotes, strikes: {} }]);

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
      execute([{ kind: "setRemotes", room: "W1N1", remotes, strikes: {} }]);

      expect(mem().colonies.W1N1.remotes[0].sources[0].distance).toBe(path.length);
      expect(mem().rooms.W2N1.scouted.sources[0].route?.W1N1).toEqual([{ room: "W1N1", x: 26, y: 25 }]);
    });

    it("drops a source PathFinder can't reach at all", () => {
      stubGame();
      memoryWithAnchor({ x: 25, y: 25 });
      stubPathFinder(() => ({ path: [], incomplete: true, ops: 2000, cost: 0 }));

      const remotes = [{ room: "W2N1", reserved: false, sources: [{ id: "s1" as Id<Source>, x: 25, y: 25, distance: 999 }] }];
      execute([{ kind: "setRemotes", room: "W1N1", remotes, strikes: {} }]);

      expect(mem().colonies.W1N1.remotes).toEqual([]);
    });

    it("drops a newly-selected source when the home has no anchor yet, without calling PathFinder", () => {
      stubGame();
      memoryWithAnchor(undefined);

      const remotes = [{ room: "W2N1", reserved: false, sources: [{ id: "s1" as Id<Source>, x: 25, y: 25, distance: 999 }] }];
      execute([{ kind: "setRemotes", room: "W1N1", remotes, strikes: {} }]);

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
      execute([{ kind: "setRemotes", room: "W1N1", remotes, strikes: {} }]);

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

  // recordPotential caches ScoutInfo.potential/potentialChecked — the pure map-topology colonization
  // score, summed over a candidate room's own neighborhood (a fresh describeExits BFS rooted at the
  // candidate, not the requesting colony's home). Only writes once every room within MAX_REMOTE_HOPS is
  // itself already scouted; scouting's own pure planner re-emits the intent every tick until then.
  describe("recordPotential", () => {
    it("computes and caches potential once the whole neighborhood is scouted", () => {
      stubGame();
      (globalThis as { Game: { map: unknown } }).Game.map = {
        describeExits: (name: string) => (name === "W1N1" ? { 3: "W1N2" } : {}),
        getRoomStatus: () => ({ status: "normal" })
      };
      (globalThis as Record<string, unknown>).Memory = {
        rooms: {
          W1N1: { scouted: { tick: 0, type: "normal", sources: [], hostile: false, anchor: { x: 25, y: 25 } } },
          W1N2: {
            scouted: {
              tick: 0,
              type: "normal",
              sources: [{ id: "s1", x: 10, y: 10 }, { id: "s2", x: 20, y: 20 }],
              hostile: false
            }
          }
        }
      };

      execute([{ kind: "recordPotential", room: "W1N1" }]);

      const mem = (
        globalThis as {
          Memory: { rooms: Record<string, { scouted: { potential?: unknown; potentialChecked?: boolean } }> };
        }
      ).Memory.rooms;
      expect(mem.W1N1.scouted.potentialChecked).toBe(true);
      expect(mem.W1N1.scouted.potential).toBeDefined();
    });

    it("does nothing (and does not mark checked) when a neighbor is still unscouted", () => {
      stubGame();
      (globalThis as { Game: { map: unknown } }).Game.map = {
        describeExits: (name: string) => (name === "W1N1" ? { 3: "W1N2" } : {}),
        getRoomStatus: () => ({ status: "normal" })
      };
      (globalThis as Record<string, unknown>).Memory = {
        rooms: {
          W1N1: { scouted: { tick: 0, type: "normal", sources: [], hostile: false, anchor: { x: 25, y: 25 } } }
          // W1N2 not present — the neighborhood isn't fully scouted yet
        }
      };

      execute([{ kind: "recordPotential", room: "W1N1" }]);

      const mem = (
        globalThis as { Memory: { rooms: Record<string, { scouted: { potentialChecked?: boolean } }> } }
      ).Memory.rooms;
      expect(mem.W1N1.scouted.potentialChecked).toBeUndefined();
    });

    it("does nothing when the room itself has gone stale (no scouted record)", () => {
      stubGame();
      (globalThis as { Game: { map: unknown } }).Game.map = { describeExits: () => ({}), getRoomStatus: () => ({ status: "normal" }) };
      (globalThis as Record<string, unknown>).Memory = { rooms: {} };

      execute([{ kind: "recordPotential", room: "W1N1" }]);

      expect((globalThis as { Memory: { rooms: Record<string, unknown> } }).Memory.rooms.W1N1).toBeUndefined();
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

  it("calls Game.cpu.generatePixel on generatePixel", () => {
    const generatePixel = vi.fn(() => OK);
    stubGame({ generatePixel });

    execute([{ kind: "generatePixel" }]);

    expect(generatePixel).toHaveBeenCalledTimes(1);
  });
});

// A live room stub whose finds return the given sources/mineral and controller. find is keyed by the
// FIND_* constant execute uses.
function stubScoutRoom(
  name: string,
  over: { sources?: number; mineral?: string; controller?: unknown; hostileStructures?: unknown[] } = {}
): unknown {
  const sources = Array.from({ length: over.sources ?? 2 }, (_, i) => ({ id: `s${i}`, pos: { x: i, y: i } }));
  const minerals = over.mineral ? [{ mineralType: over.mineral }] : [];
  return {
    name,
    controller: over.controller,
    find: (type: number) =>
      type === FIND_SOURCES
        ? sources
        : type === FIND_MINERALS
          ? minerals
          : type === FIND_HOSTILE_STRUCTURES
            ? over.hostileStructures ?? []
            : []
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
    const room = stubScoutRoom("W1N2", {
      controller: { pos: { x: 25, y: 25 }, owner: { username: "Enemy" }, my: false }
    });
    stubGame({ time: 10, rooms: { W1N2: room } });
    (globalThis as Record<string, unknown>).Memory = { rooms: {} };
    (globalThis as { Game: { map: unknown } }).Game.map = {
      getRoomTerrain: () => ({ get: () => 0 })
    };

    execute([{ kind: "recordScout", room: "W1N2" }]);

    const mem = (globalThis as { Memory: { rooms: Record<string, { scouted?: { owner?: string; hostile?: boolean } }> } })
      .Memory.rooms.W1N2;
    expect(mem.scouted).toMatchObject({ owner: "Enemy", hostile: true });
  });

  it("does not mark a room hostile when it's only reserved by the Invader NPC", () => {
    // A STRUCTURE_INVADER_CORE reservation must read as owner: "Invader" but hostile: false — remote
    // selection (pickRemotes) treats that as temporary/contestable, not a real player's claim, and only
    // ScoutInfo.hostile (not `owner` alone) is allowed to gate selection.
    const room = stubScoutRoom("W1N2", {
      controller: { pos: { x: 25, y: 25 }, my: false, reservation: { username: "Invader" } }
    });
    stubGame({ time: 10, rooms: { W1N2: room } });
    (globalThis as Record<string, unknown>).Memory = { rooms: {} };
    (globalThis as { Game: { map: unknown } }).Game.map = {
      getRoomTerrain: () => ({ get: () => 0 })
    };

    execute([{ kind: "recordScout", room: "W1N2" }]);

    const mem = (globalThis as { Memory: { rooms: Record<string, { scouted?: { owner?: string; hostile?: boolean } }> } })
      .Memory.rooms.W1N2;
    expect(mem.scouted).toMatchObject({ owner: "Invader", hostile: false });
  });

  it("records a fortified Stronghold core's level and ticksToDeploy before it's deployed", () => {
    const room = stubScoutRoom("W1N2", {
      hostileStructures: [{ structureType: STRUCTURE_INVADER_CORE, level: 3, ticksToDeploy: 4000, effects: [] }]
    });
    stubGame({ time: 10, rooms: { W1N2: room } });
    (globalThis as Record<string, unknown>).Memory = { rooms: {} };

    execute([{ kind: "recordScout", room: "W1N2" }]);

    const mem = (globalThis as { Memory: { rooms: Record<string, { scouted?: { invaderCore?: unknown } }> } }).Memory.rooms.W1N2;
    expect(mem.scouted?.invaderCore).toEqual({ level: 3, ticksToDeploy: 4000 });
  });

  it("records a deployed Stronghold core's collapse timer instead of ticksToDeploy", () => {
    const room = stubScoutRoom("W1N2", {
      hostileStructures: [
        { structureType: STRUCTURE_INVADER_CORE, level: 3, effects: [{ effect: EFFECT_COLLAPSE_TIMER, ticksRemaining: 15000 }] }
      ]
    });
    stubGame({ time: 10, rooms: { W1N2: room } });
    (globalThis as Record<string, unknown>).Memory = { rooms: {} };

    execute([{ kind: "recordScout", room: "W1N2" }]);

    const mem = (globalThis as { Memory: { rooms: Record<string, { scouted?: { invaderCore?: unknown } }> } }).Memory.rooms.W1N2;
    expect(mem.scouted?.invaderCore).toEqual({ level: 3, collapseTicksRemaining: 15000 });
  });

  it("records a plain level-0 core with no deploy/collapse timer present", () => {
    const room = stubScoutRoom("W1N2", {
      hostileStructures: [{ structureType: STRUCTURE_INVADER_CORE, level: 0, effects: [] }]
    });
    stubGame({ time: 10, rooms: { W1N2: room } });
    (globalThis as Record<string, unknown>).Memory = { rooms: {} };

    execute([{ kind: "recordScout", room: "W1N2" }]);

    const mem = (globalThis as { Memory: { rooms: Record<string, { scouted?: { invaderCore?: unknown } }> } }).Memory.rooms.W1N2;
    expect(mem.scouted?.invaderCore).toEqual({ level: 0 });
  });

  it("omits invaderCore entirely when no core is present", () => {
    const room = stubScoutRoom("W1N2");
    stubGame({ time: 10, rooms: { W1N2: room } });
    (globalThis as Record<string, unknown>).Memory = { rooms: {} };

    execute([{ kind: "recordScout", room: "W1N2" }]);

    const mem = (globalThis as { Memory: { rooms: Record<string, { scouted?: { invaderCore?: unknown } }> } }).Memory.rooms.W1N2;
    expect(mem.scouted?.invaderCore).toBeUndefined();
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

  it("computes a bunker anchor for a room with a controller", () => {
    // No sources (over.sources defaults elided) so the anchor is purely controller-driven.
    const room = stubScoutRoom("W1N2", { sources: 0, controller: { pos: { x: 25, y: 25 } } });
    stubGame({ time: 10, rooms: { W1N2: room } });
    (globalThis as Record<string, unknown>).Memory = { rooms: {} };
    (globalThis as { Game: { map: unknown } }).Game.map = {
      getRoomTerrain: () => ({ get: () => 0 }) // fully open room, every tile walkable
    };

    execute([{ kind: "recordScout", room: "W1N2" }]);

    const mem = (globalThis as {
      Memory: { rooms: Record<string, { scouted?: { anchor?: { x: number; y: number }; anchorChecked?: boolean } }> };
    }).Memory.rooms.W1N2;
    expect(mem.scouted?.anchor).toEqual({ x: 25, y: 25 });
    expect(mem.scouted?.anchorChecked).toBe(true);
  });

  it("does not compute an anchor for a room with no controller, and leaves anchorChecked unset", () => {
    stubGame({ time: 10, rooms: { W1N2: stubScoutRoom("W1N2") } });
    (globalThis as Record<string, unknown>).Memory = { rooms: {} };
    const getRoomTerrain = vi.fn();
    (globalThis as { Game: { map: unknown } }).Game.map = { getRoomTerrain };

    execute([{ kind: "recordScout", room: "W1N2" }]);

    const mem = (globalThis as {
      Memory: { rooms: Record<string, { scouted?: { anchor?: unknown; anchorChecked?: boolean } }> };
    }).Memory.rooms.W1N2;
    expect(mem.scouted?.anchor).toBeUndefined();
    expect(mem.scouted?.anchorChecked).toBeUndefined();
    expect(getRoomTerrain).not.toHaveBeenCalled();
  });

  it("marks anchorChecked true (with anchor absent) when a controller room's terrain rejects every candidate", () => {
    const room = stubScoutRoom("W1N2", { sources: 0, controller: { pos: { x: 25, y: 25 } } });
    stubGame({ time: 10, rooms: { W1N2: room } });
    (globalThis as Record<string, unknown>).Memory = { rooms: {} };
    (globalThis as { Game: { map: unknown } }).Game.map = {
      getRoomTerrain: () => ({ get: () => TERRAIN_MASK_WALL }) // entirely wall, no bunker fits anywhere
    };

    execute([{ kind: "recordScout", room: "W1N2" }]);

    const mem = (globalThis as {
      Memory: { rooms: Record<string, { scouted?: { anchor?: unknown; anchorChecked?: boolean } }> };
    }).Memory.rooms.W1N2;
    expect(mem.scouted?.anchor).toBeUndefined();
    expect(mem.scouted?.anchorChecked).toBe(true);
  });

  it("reuses a cached anchor on re-scout instead of recomputing it", () => {
    const room = stubScoutRoom("W1N2", { controller: { pos: { x: 25, y: 25 } } });
    stubGame({ time: 1000, rooms: { W1N2: room } });
    const getRoomTerrain = vi.fn(() => ({ get: () => 0 }));
    (globalThis as { Game: { map: unknown } }).Game.map = { getRoomTerrain };
    (globalThis as Record<string, unknown>).Memory = {
      rooms: {
        W1N2: {
          scouted: {
            tick: 10,
            type: "normal",
            sources: [{ id: "old0", x: 5, y: 5 }],
            anchor: { x: 7, y: 7 },
            anchorChecked: true,
            hostile: false
          }
        }
      }
    };

    execute([{ kind: "recordScout", room: "W1N2", passive: true }]);

    const mem = (globalThis as {
      Memory: { rooms: Record<string, { scouted?: { anchor?: unknown; anchorChecked?: boolean } }> };
    }).Memory.rooms.W1N2;
    expect(mem.scouted?.anchor).toEqual({ x: 7, y: 7 });
    expect(mem.scouted?.anchorChecked).toBe(true);
    expect(getRoomTerrain).not.toHaveBeenCalled();
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
      findRoute: () => [{ room: "W1N2" }, { room: "W1N3" }],
      getRoomStatus: () => ({ status: "normal" })
    };

    execute([{ kind: "setScoutTargets", assignments: [{ creep: "scout1" as Id<Creep>, candidates: ["W1N3"] }] }]);

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
    (globalThis as { Game: { map: unknown } }).Game.map = { findRoute, getRoomStatus: () => ({ status: "normal" }) };

    execute([
      { kind: "setScoutTargets", assignments: [{ creep: "scout1" as Id<Creep>, candidates: ["W1N2", "W1N3"] }] }
    ]);

    expect(creep.memory.scoutTarget).toBe("W1N3");
    expect(creep.memory.route).toEqual({ dest: "W1N3", rooms: ["W1N3"], index: 0 });
  });

  it("breaks a findRoute tie deterministically by room name", () => {
    const creep = { room: { name: "W1N1" }, memory: { home: "W1N1", role: "scout" } as CreepMemory };
    stubGame({ objects: { scout1: creep } });
    (globalThis as Record<string, unknown>).Memory = { rooms: {} };
    (globalThis as { Game: { map: unknown } }).Game.map = {
      findRoute: () => [{ room: "X" }],
      getRoomStatus: () => ({ status: "normal" })
    };

    execute([
      { kind: "setScoutTargets", assignments: [{ creep: "scout1" as Id<Creep>, candidates: ["W2N1", "W1N2"] }] }
    ]);

    expect(creep.memory.scoutTarget).toBe("W1N2");
  });

  // The actual bug this fixes: two idle scouts with overlapping candidate pools both independently
  // agreeing "W1N2 is nearest" used to send them both there. Greedy matching must give the second scout
  // its next-best option instead.
  it("distributes two scouts across distinct candidates instead of sending both to the same nearest room", () => {
    const creep1 = { room: { name: "W1N1" }, memory: { home: "W1N1", role: "scout" } as CreepMemory };
    const creep2 = { room: { name: "W1N1" }, memory: { home: "W1N1", role: "scout" } as CreepMemory };
    stubGame({ objects: { scout1: creep1, scout2: creep2 } });
    (globalThis as Record<string, unknown>).Memory = { rooms: {} };
    const findRoute = vi.fn((_from: string, dest: string) => {
      const hops: Record<string, number> = { W1N2: 1, W1N3: 2 };
      return Array.from({ length: hops[dest] }, () => ({ room: dest }));
    });
    (globalThis as { Game: { map: unknown } }).Game.map = { findRoute, getRoomStatus: () => ({ status: "normal" }) };

    execute([
      {
        kind: "setScoutTargets",
        assignments: [
          { creep: "scout1" as Id<Creep>, candidates: ["W1N2", "W1N3"] },
          { creep: "scout2" as Id<Creep>, candidates: ["W1N2", "W1N3"] }
        ]
      }
    ]);

    const targets = [creep1.memory.scoutTarget, creep2.memory.scoutTarget].sort();
    expect(targets).toEqual(["W1N2", "W1N3"]);
  });

  // Confirmed live on shard0: Game.map.findRoute is blind to the invisible respawn/novice-zone border
  // wall (it's a structure, not terrain — see scoutGraph.ts's crossesSealedBorder doc), so it happily
  // reports a "reachable" route straight through one. A scout sent on that route walks up to the real
  // wall and wedges there forever (Traveler's PathFinder call returns an incomplete-but-nonempty best
  // path, so travelTo never returns ERR_NO_PATH and the usual noPathFrom cache never kicks in). The fix
  // has to reject the route before ever assigning it, by cross-checking each hop's room status.
  it("rejects a findRoute result that crosses a respawn/novice-zone status boundary", () => {
    const creep = { room: { name: "W1N1" }, memory: { home: "W1N1", role: "scout" } as CreepMemory };
    stubGame({ objects: { scout1: creep } });
    (globalThis as Record<string, unknown>).Memory = { rooms: {} };
    const statuses: Record<string, string> = { W1N1: "respawn", W1N2: "normal" };
    (globalThis as { Game: { map: unknown } }).Game.map = {
      findRoute: () => [{ room: "W1N2" }],
      getRoomStatus: (room: string) => ({ status: statuses[room] ?? "normal" })
    };

    execute([{ kind: "setScoutTargets", assignments: [{ creep: "scout1" as Id<Creep>, candidates: ["W1N2"] }] }]);

    expect(creep.memory.scoutTarget).toBeUndefined();
  });

  // Same guard applied to a scout's own precomputed route (routeTo, used by setScoutTargets to fill in
  // creep.memory.route once a target has already been picked) — falls back to a direct [dest] hop rather
  // than trusting a findRoute path that crosses the sealed border, same as an outright ERR_NO_PATH.
  it("falls back to a direct route when findRoute's path crosses a status boundary", () => {
    const creep = { room: { name: "W1N1" }, memory: { home: "W1N1", role: "scout" } as CreepMemory };
    stubGame({ objects: { scout1: creep } });
    (globalThis as Record<string, unknown>).Memory = { rooms: {} };
    const statuses: Record<string, string> = { W1N1: "respawn", W1N9: "normal", W1N3: "normal" };
    (globalThis as { Game: { map: unknown } }).Game.map = {
      findRoute: () => [{ room: "W1N9" }, { room: "W1N3" }],
      getRoomStatus: (room: string) => ({ status: statuses[room] ?? "normal" })
    };

    execute([{ kind: "setScoutTargets", assignments: [{ creep: "scout1" as Id<Creep>, candidates: ["W1N3"] }] }]);

    // The candidate itself is unreachable via this sealed route too, so it loses the assignment round
    // entirely (assignScoutTargets rejects it the same as an ERR_NO_PATH) — matches production behaviour:
    // there's no legal candidate left to send this scout to this tick.
    expect(creep.memory.scoutTarget).toBeUndefined();
  });

  // Issue 3: a scout's own precomputed route (unlike Traveler's internal findRoute, which other roles
  // rely on) must also steer around a reputation-flagged hostile/dangerous room's territory — see
  // memory/reputation.ts and interpreter.ts's dangerRouteCallback for the same rule applied to Traveler.
  it("prices a hostile-owned transit room high via findRoute's routeCallback", () => {
    const creep = { room: { name: "W1N1" }, memory: { home: "W1N1", role: "scout" } as CreepMemory };
    stubGame({ objects: { scout1: creep } });
    (globalThis as Record<string, unknown>).Memory = {
      rooms: { W1N2: { scouted: { owner: "Griefer" } } },
      playerReputation: { Griefer: "hostile" }
    };
    const findRoute = vi.fn((_from: string, _dest: string, options: { routeCallback: (r: string) => number }) => {
      expect(options.routeCallback("W1N2")).toBe(50);
      expect(options.routeCallback("W1N9")).toBe(1);
      return [{ room: "W1N9" }, { room: "W1N3" }];
    });
    (globalThis as { Game: { map: unknown } }).Game.map = { findRoute, getRoomStatus: () => ({ status: "normal" }) };

    execute([{ kind: "setScoutTargets", assignments: [{ creep: "scout1" as Id<Creep>, candidates: ["W1N3"] }] }]);

    expect(findRoute).toHaveBeenCalledWith("W1N1", "W1N3", { routeCallback: expect.any(Function) });
    expect(creep.memory.scoutTarget).toBe("W1N3");
  });

  // A room this colony's own scout already confirmed is walled off at every border (see interpreter.ts's
  // moveToRoom writing noPathFrom on a real travelTo failure) must never be used as a transit hop for a
  // DIFFERENT candidate's route â€” priced Infinity, not just the 50-hop hostile penalty, since there is
  // provably no way through at all.
  it("prices a noPathFrom-flagged transit room as impassable via findRoute's routeCallback", () => {
    const creep = { room: { name: "W1N1" }, memory: { home: "W1N1", role: "scout" } as CreepMemory };
    stubGame({ time: 5000, objects: { scout1: creep } });
    (globalThis as Record<string, unknown>).Memory = {
      rooms: { W1N2: { scouted: { noPathFrom: { W1N1: 1000 } } } }
    };
    const findRoute = vi.fn((_from: string, _dest: string, options: { routeCallback: (r: string) => number }) => {
      expect(options.routeCallback("W1N2")).toBe(Infinity);
      return [{ room: "W1N9" }, { room: "W1N3" }];
    });
    (globalThis as { Game: { map: unknown } }).Game.map = { findRoute, getRoomStatus: () => ({ status: "normal" }) };

    execute([{ kind: "setScoutTargets", assignments: [{ creep: "scout1" as Id<Creep>, candidates: ["W1N3"] }] }]);
    expect(creep.memory.scoutTarget).toBe("W1N3");
  });

  // Confirmed live on shard0: a scout assigned a destination whose only route in crossed a towered room
  // walked straight through it as a mere DANGEROUS_ROOM_HOPS detour and died there every generation,
  // never reaching the real destination. A lethal transit room must price Infinity, not 50, since routing
  // through it is pure loss (the scout never survives to reach anything beyond it) — unlike a merely
  // hostile room, which is still worth the detour cost because the scout usually does survive the crossing.
  it("prices a lethal-flagged transit room as impassable via findRoute's routeCallback", () => {
    const creep = { room: { name: "W1N1" }, memory: { home: "W1N1", role: "scout" } as CreepMemory };
    stubGame({ time: 5000, objects: { scout1: creep } });
    (globalThis as Record<string, unknown>).Memory = {
      rooms: { W1N2: { scouted: { lethalAt: 1000 } } }
    };
    const findRoute = vi.fn((_from: string, _dest: string, options: { routeCallback: (r: string) => number }) => {
      expect(options.routeCallback("W1N2")).toBe(Infinity);
      return [{ room: "W1N9" }, { room: "W1N3" }];
    });
    (globalThis as { Game: { map: unknown } }).Game.map = { findRoute, getRoomStatus: () => ({ status: "normal" }) };

    execute([{ kind: "setScoutTargets", assignments: [{ creep: "scout1" as Id<Creep>, candidates: ["W1N3"] }] }]);
    expect(creep.memory.scoutTarget).toBe("W1N3");
  });

  // Same reasoning as the lethalAt case above, but for a room whose danger is known the instant it's
  // seen (a Stronghold's fortified core), not just after a death — see schema.ts's ScoutInfo.invaderCore
  // doc and behaviors/scoutTargets.ts's hasFortifiedInvaderCore.
  it("prices a room with a live fortified core as impassable via findRoute's routeCallback", () => {
    const creep = { room: { name: "W1N1" }, memory: { home: "W1N1", role: "scout" } as CreepMemory };
    stubGame({ time: 5000, objects: { scout1: creep } });
    (globalThis as Record<string, unknown>).Memory = {
      rooms: { W1N2: { scouted: { tick: 0, invaderCore: { level: 3 } } } }
    };
    const findRoute = vi.fn((_from: string, _dest: string, options: { routeCallback: (r: string) => number }) => {
      expect(options.routeCallback("W1N2")).toBe(Infinity);
      return [{ room: "W1N9" }, { room: "W1N3" }];
    });
    (globalThis as { Game: { map: unknown } }).Game.map = { findRoute, getRoomStatus: () => ({ status: "normal" }) };

    execute([{ kind: "setScoutTargets", assignments: [{ creep: "scout1" as Id<Creep>, candidates: ["W1N3"] }] }]);
    expect(creep.memory.scoutTarget).toBe("W1N3");
  });

  it("does not price a room with only a level-0 core as impassable", () => {
    const creep = { room: { name: "W1N1" }, memory: { home: "W1N1", role: "scout" } as CreepMemory };
    stubGame({ time: 5000, objects: { scout1: creep } });
    (globalThis as Record<string, unknown>).Memory = {
      rooms: { W1N2: { scouted: { tick: 0, invaderCore: { level: 0 } } } }
    };
    const findRoute = vi.fn((_from: string, _dest: string, options: { routeCallback: (r: string) => number }) => {
      expect(options.routeCallback("W1N2")).toBe(1);
      return [{ room: "W1N9" }, { room: "W1N3" }];
    });
    (globalThis as { Game: { map: unknown } }).Game.map = { findRoute, getRoomStatus: () => ({ status: "normal" }) };

    execute([{ kind: "setScoutTargets", assignments: [{ creep: "scout1" as Id<Creep>, candidates: ["W1N3"] }] }]);
    expect(creep.memory.scoutTarget).toBe("W1N3");
  });

  it("stops treating a lethalAt entry as impassable once the backoff window has elapsed", () => {
    const creep = { room: { name: "W1N1" }, memory: { home: "W1N1", role: "scout" } as CreepMemory };
    stubGame({ time: 25000, objects: { scout1: creep } }); // 25000 - 1000 = 24000 >= 20000
    (globalThis as Record<string, unknown>).Memory = {
      rooms: { W1N2: { scouted: { lethalAt: 1000 } } }
    };
    const findRoute = vi.fn((_from: string, _dest: string, options: { routeCallback: (r: string) => number }) => {
      expect(options.routeCallback("W1N2")).toBe(1);
      return [{ room: "W1N9" }, { room: "W1N3" }];
    });
    (globalThis as { Game: { map: unknown } }).Game.map = { findRoute, getRoomStatus: () => ({ status: "normal" }) };

    execute([{ kind: "setScoutTargets", assignments: [{ creep: "scout1" as Id<Creep>, candidates: ["W1N3"] }] }]);
    expect(creep.memory.scoutTarget).toBe("W1N3");
  });

  // The exact same room stays a fully legal DIRECT scout destination despite the same noPathFrom entry:
  // the exit tile itself is always reachable (structures can never sit on one), which already fulfills
  // the scouting order (see schema.ts's noPathFrom doc). The exclusion above only ever fires for rooms
  // findRoute is considering passing THROUGH, never for the candidate being routed TO.
  it("still assigns a noPathFrom-flagged room as a direct scout destination", () => {
    const creep = { room: { name: "W1N1" }, memory: { home: "W1N1", role: "scout" } as CreepMemory };
    stubGame({ time: 5000, objects: { scout1: creep } });
    (globalThis as Record<string, unknown>).Memory = {
      rooms: { W1N2: { scouted: { noPathFrom: { W1N1: 1000 } } } }
    };
    const findRoute = vi.fn((_from: string, _dest: string, options: { routeCallback: (r: string) => number }) => {
      expect(options.routeCallback("W1N2")).toBe(1); // destination itself: never priced by noPathFrom/danger
      return [{ room: "W1N2" }];
    });
    (globalThis as { Game: { map: unknown } }).Game.map = { findRoute, getRoomStatus: () => ({ status: "normal" }) };

    execute([{ kind: "setScoutTargets", assignments: [{ creep: "scout1" as Id<Creep>, candidates: ["W1N2"] }] }]);
    expect(creep.memory.scoutTarget).toBe("W1N2");
  });

  // A stale noPathFrom entry past NO_PATH_RETRY_AFTER (20000 ticks) is trusted again as a normal transit
  // hop â€” the negative cache is a backoff, not a permanent verdict (mirrors ScoutedSource.noPathAt's same
  // rule for remote-mining source paths), in case a border wall genuinely comes down later.
  it("stops treating a noPathFrom entry as impassable once the backoff window has elapsed", () => {
    const creep = { room: { name: "W1N1" }, memory: { home: "W1N1", role: "scout" } as CreepMemory };
    stubGame({ time: 25000, objects: { scout1: creep } }); // 25000 - 1000 = 24000 >= 20000
    (globalThis as Record<string, unknown>).Memory = {
      rooms: { W1N2: { scouted: { noPathFrom: { W1N1: 1000 } } } }
    };
    const findRoute = vi.fn((_from: string, _dest: string, options: { routeCallback: (r: string) => number }) => {
      expect(options.routeCallback("W1N2")).toBe(1);
      return [{ room: "W1N9" }, { room: "W1N3" }];
    });
    (globalThis as { Game: { map: unknown } }).Game.map = { findRoute, getRoomStatus: () => ({ status: "normal" }) };

    execute([{ kind: "setScoutTargets", assignments: [{ creep: "scout1" as Id<Creep>, candidates: ["W1N3"] }] }]);
    expect(creep.memory.scoutTarget).toBe("W1N3");
  });

  it("grows the scouting radius, capped, on advanceScoutRadius", () => {
    stubGame();
    (globalThis as Record<string, unknown>).Memory = { scouting: { radius: 1 } };

    execute([{ kind: "advanceScoutRadius" }]);
    expect((globalThis as { Memory: { scouting: { radius: number } } }).Memory.scouting.radius).toBe(2);

    // At the cap it stays put rather than growing without bound.
    (globalThis as { Memory: { scouting: { radius: number } } }).Memory.scouting.radius = 8;
    execute([{ kind: "advanceScoutRadius" }]);
    expect((globalThis as { Memory: { scouting: { radius: number } } }).Memory.scouting.radius).toBe(8);
  });
});
