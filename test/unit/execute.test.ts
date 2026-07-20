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

    execute([{ kind: "spawn", spawn: "spawn1" as Id<StructureSpawn>, role: "bootstrap", body: [WORK, CARRY, MOVE], memory }]);

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
        role: "bootstrap",
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
        role: "bootstrap",
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

    // A container that momentarily isn't in the snapshot (out of vision, or a
    // tick where it was destroyed and is being rebuilt) must not wipe the id —
    // roles reading SourceMemory would lose their handle for no good reason.
    execute([{ kind: "recordSourceSpot", room: "W1N1", source: "src1" as Id<Source>, spot: { x: 19, y: 11 } }]);

    const mem = (globalThis as { Memory: { colonies: Record<string, { sources: Record<string, { containerId?: string }> }> } })
      .Memory.colonies.W1N1;
    expect(mem.sources.src1.containerId).toBe("cont1");
  });
});
