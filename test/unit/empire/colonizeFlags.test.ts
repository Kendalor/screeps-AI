// Flag-triggered colonize entry point: reads Game.flags for a "colonize"/"colonize:<room>" flag,
// resolves the target room, picks a sponsor colony via pickColonizeSponsor, and spawns a colonizer
// directly through the normal spawn intent path. Not part of the SYSTEMS loop (Colonize isn't a default
// operation) — exercised here as a standalone Game-touching function, same style as execute.test.ts.

import { describe, expect, it, vi } from "vitest";
import { runColonizeFlags } from "../../../src/empire/colonizeFlags";
import { COLONIZER_COST } from "../../../src/behaviors/roles/colonizer";
import { testEmpire, colonySnap, snapCreep } from "../../fixtures";
import { stubGame } from "../../helpers";

function openSpawn(spawnCreep: () => ScreepsReturnCode) {
  return { spawnCreep, pos: { x: 25, y: 25, roomName: "W1N1" }, room: { getTerrain: () => ({ get: () => 0 }) } };
}

function flag(name: string, roomName: string, remove: () => void = vi.fn()) {
  return { name, pos: { roomName }, remove };
}

// Every test needs Game.flags/Game.map/Game.rooms/Game.gcl alongside stubGame's Game.getObjectById —
// set up together so each `it` only supplies what varies (the flag, the spawn callback). gcl defaults
// roomy so none of the non-GCL tests below trip the room-budget gate incidentally.
function setUp(flags: Record<string, ReturnType<typeof flag>>, spawnCreep: () => ScreepsReturnCode, gclLevel = 10) {
  stubGame({ objects: { spawn1: openSpawn(spawnCreep) } });
  const game = (globalThis as { Game: Record<string, unknown> }).Game;
  game.flags = flags;
  game.rooms = {};
  game.map = { findRoute: (_from: string, dest: string) => [{ room: dest }] };
  game.gcl = { level: gclLevel };
}

describe("runColonizeFlags", () => {
  it("does nothing when there are no colonize flags", () => {
    setUp({}, vi.fn(() => OK));
    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: COLONIZER_COST }));
    expect(() => runColonizeFlags(world)).not.toThrow();
  });

  it("spawns a colonizer from the sponsor colony and removes the flag on success", () => {
    const remove = vi.fn();
    const spawnCreep = vi.fn(() => OK);
    setUp({ f1: flag("colonize", "W5N5", remove) }, spawnCreep);
    // Bare "colonize" name resolves via the flag's own room — needs vision (a controller) there.
    (globalThis as { Game: { rooms: Record<string, unknown> } }).Game.rooms.W5N5 = { controller: {} };

    const world = testEmpire(
      colonySnap({
        name: "W1N1",
        energyCapacity: COLONIZER_COST,
        energyAvailable: COLONIZER_COST,
        spawns: [{ id: "spawn1" as Id<StructureSpawn>, busy: false }]
      })
    );

    runColonizeFlags(world);

    expect(spawnCreep).toHaveBeenCalled();
    const [, , opts] = spawnCreep.mock.calls[0] as [BodyPartConstant[], string, { memory: CreepMemory }];
    expect(opts.memory.role).toBe("colonizer");
    expect(opts.memory.targetRoom).toBe("W5N5");
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("parses the target room from a colonize:<room> name when the flag's own room has no controller", () => {
    const spawnCreep = vi.fn(() => OK);
    setUp({ f1: flag("colonize:W7N7", "W1N1") }, spawnCreep); // placed at home, room itself unscouted

    const world = testEmpire(
      colonySnap({
        name: "W1N1",
        energyCapacity: COLONIZER_COST,
        energyAvailable: COLONIZER_COST,
        spawns: [{ id: "spawn1" as Id<StructureSpawn>, busy: false }]
      })
    );

    runColonizeFlags(world);

    const [, , opts] = spawnCreep.mock.calls[0] as [BodyPartConstant[], string, { memory: CreepMemory }];
    expect(opts.memory.targetRoom).toBe("W7N7");
  });

  it("uses a colonize:<room> suffix even when the flag physically sits in a room with vision+a controller (e.g. the player's own base)", () => {
    const spawnCreep = vi.fn(() => OK);
    // Placed AT HOME (W1N1, which has vision+a controller via testEmpire's colony), but named for W7N7 —
    // the name must win, not the incidental physical position. Regression: targetRoomFor used to check
    // position before the name suffix, so a "colonize:<room>" flag dropped anywhere with vision silently
    // targeted wherever it landed instead of the room its name actually said.
    setUp({ f1: flag("colonize:W7N7", "W1N1") }, spawnCreep);
    (globalThis as { Game: { rooms: Record<string, unknown> } }).Game.rooms.W1N1 = { controller: {} };

    const world = testEmpire(
      colonySnap({
        name: "W1N1",
        energyCapacity: COLONIZER_COST,
        energyAvailable: COLONIZER_COST,
        spawns: [{ id: "spawn1" as Id<StructureSpawn>, busy: false }]
      })
    );

    runColonizeFlags(world);

    const [, , opts] = spawnCreep.mock.calls[0] as [BodyPartConstant[], string, { memory: CreepMemory }];
    expect(opts.memory.targetRoom).toBe("W7N7");
  });

  it("errors and leaves the flag when the sponsor has capacity but hasn't banked enough energy yet", () => {
    const remove = vi.fn();
    const spawnCreep = vi.fn(() => OK);
    setUp({ f1: flag("colonize", "W5N5", remove) }, spawnCreep);

    const world = testEmpire(
      colonySnap({
        name: "W1N1",
        energyCapacity: COLONIZER_COST, // can afford it eventually...
        energyAvailable: COLONIZER_COST - 1, // ...but hasn't banked enough THIS tick
        spawns: [{ id: "spawn1" as Id<StructureSpawn>, busy: false }]
      })
    );

    runColonizeFlags(world);

    expect(spawnCreep).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("logs and leaves the flag when no colony can afford a colonizer", () => {
    const remove = vi.fn();
    setUp({ f1: flag("colonize", "W5N5", remove) }, vi.fn(() => OK));

    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: COLONIZER_COST - 1 }));

    expect(() => runColonizeFlags(world)).not.toThrow();
    expect(remove).not.toHaveBeenCalled();
  });

  it("does not re-pick a sponsor when a colonizer is already en route to the target", () => {
    const spawnCreep = vi.fn(() => OK);
    setUp({ f1: flag("colonize", "W5N5") }, spawnCreep);

    const world = testEmpire(
      colonySnap({
        name: "W1N1",
        energyCapacity: COLONIZER_COST,
        spawns: [{ id: "spawn1" as Id<StructureSpawn>, busy: false }],
        creeps: [snapCreep("colonizer", { memory: { op: "colonize:W1N1", targetRoom: "W5N5" } })]
      })
    );

    runColonizeFlags(world);

    expect(spawnCreep).not.toHaveBeenCalled();
  });

  it("errors and leaves the flag when the sponsor colony has no idle spawn", () => {
    const remove = vi.fn();
    const spawnCreep = vi.fn(() => OK);
    setUp({ f1: flag("colonize", "W5N5", remove) }, spawnCreep);

    const world = testEmpire(
      colonySnap({
        name: "W1N1",
        energyCapacity: COLONIZER_COST,
        spawns: [{ id: "spawn1" as Id<StructureSpawn>, busy: true }]
      })
    );

    runColonizeFlags(world);

    expect(spawnCreep).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("cannot tell the target room when the flag has no room-suffixed name and sits in an unscouted room", () => {
    const remove = vi.fn();
    const spawnCreep = vi.fn(() => OK);
    setUp({ f1: flag("colonize", "W1N1", remove) }, spawnCreep); // bare name, home room has no controller in this fixture's Game.rooms

    const world = testEmpire(
      colonySnap({
        name: "W1N1",
        energyCapacity: COLONIZER_COST,
        spawns: [{ id: "spawn1" as Id<StructureSpawn>, busy: false }]
      })
    );

    runColonizeFlags(world);

    expect(spawnCreep).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("logs and leaves the flag when the empire is already at its GCL room budget", () => {
    const remove = vi.fn();
    const spawnCreep = vi.fn(() => OK);
    // GCL 1 with 1 owned colony already — no room left to claim another.
    setUp({ f1: flag("colonize", "W5N5", remove) }, spawnCreep, 1);

    const world = testEmpire(
      colonySnap({
        name: "W1N1",
        energyCapacity: COLONIZER_COST,
        spawns: [{ id: "spawn1" as Id<StructureSpawn>, busy: false }]
      })
    );

    runColonizeFlags(world);

    expect(spawnCreep).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});
