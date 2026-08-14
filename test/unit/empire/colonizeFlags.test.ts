// Flag-triggered colonize entry point: reads Game.flags for a "colonize"/"colonize:<room>" flag,
// resolves the target room, picks a sponsor colony via pickColonizeSponsor, and hands the target off to
// it durably (addColonizeTarget — see colonize.ts's header) rather than spawning anything directly. Not
// part of the SYSTEMS loop (Colonize isn't a default operation) — exercised here as a standalone
// Game-touching function, same style as execute.test.ts.

import { describe, expect, it, vi } from "vitest";
import { runColonizeFlags } from "../../../src/empire/colonizeFlags";
import { COLONIZER_COST } from "../../../src/behaviors/roles/colonizer";
import { testEmpire, colonySnap } from "../../fixtures";
import { stubGame } from "../../helpers";

function flag(name: string, roomName: string, remove: () => void = vi.fn()) {
  return { name, pos: { roomName }, remove };
}

// Every test needs Game.flags/Game.map/Game.rooms/Game.gcl alongside stubGame's Game.getObjectById —
// set up together so each `it` only supplies what varies (the flags, gcl). gcl defaults roomy so none
// of the non-GCL tests below trip the room-budget gate incidentally.
function setUp(flags: Record<string, ReturnType<typeof flag>>, gclLevel = 10) {
  stubGame();
  const game = (globalThis as { Game: Record<string, unknown> }).Game;
  game.flags = flags;
  game.rooms = {};
  game.map = { findRoute: (_from: string, dest: string) => [{ room: dest }] };
  game.gcl = { level: gclLevel };
  // addColonizeTarget's handler writes Memory.colonies[room] — stubGame() only seeds Memory.creeps.
  (globalThis as { Memory: { colonies: Record<string, unknown> } }).Memory.colonies = {};
}

const colonizingOf = (mem: Record<string, unknown>, room: string): string[] =>
  ((mem as { colonies?: Record<string, { colonizing?: string[] }> }).colonies?.[room]?.colonizing) ?? [];

describe("runColonizeFlags", () => {
  it("does nothing when there are no colonize flags", () => {
    setUp({});
    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: COLONIZER_COST }));
    expect(() => runColonizeFlags(world)).not.toThrow();
  });

  it("hands the target off to the sponsor colony and removes the flag on success", () => {
    const remove = vi.fn();
    setUp({ f1: flag("colonize", "W5N5", remove) });
    // Bare "colonize" name resolves via the flag's own room — needs vision (a controller) there.
    (globalThis as { Game: { rooms: Record<string, unknown> } }).Game.rooms.W5N5 = { controller: {} };

    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: COLONIZER_COST }));

    runColonizeFlags(world);

    expect(colonizingOf(Memory, "W1N1")).toEqual(["W5N5"]);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("parses the target room from a colonize:<room> name when the flag's own room has no controller", () => {
    setUp({ f1: flag("colonize:W7N7", "W1N1") }); // placed at home, room itself unscouted

    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: COLONIZER_COST }));

    runColonizeFlags(world);

    expect(colonizingOf(Memory, "W1N1")).toEqual(["W7N7"]);
  });

  it("uses a colonize:<room> suffix even when the flag physically sits in a room with vision+a controller (e.g. the player's own base)", () => {
    // Placed AT HOME (W1N1, which has vision+a controller via testEmpire's colony), but named for W7N7 —
    // the name must win, not the incidental physical position. Regression: targetRoomFor used to check
    // position before the name suffix, so a "colonize:<room>" flag dropped anywhere with vision silently
    // targeted wherever it landed instead of the room its name actually said.
    setUp({ f1: flag("colonize:W7N7", "W1N1") });
    (globalThis as { Game: { rooms: Record<string, unknown> } }).Game.rooms.W1N1 = { controller: {} };

    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: COLONIZER_COST }));

    runColonizeFlags(world);

    expect(colonizingOf(Memory, "W1N1")).toEqual(["W7N7"]);
  });

  it("logs and leaves the flag when no colony can afford a colonizer", () => {
    const remove = vi.fn();
    setUp({ f1: flag("colonize", "W5N5", remove) });

    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: COLONIZER_COST - 1 }));

    expect(() => runColonizeFlags(world)).not.toThrow();
    expect(remove).not.toHaveBeenCalled();
    expect(colonizingOf(Memory, "W1N1")).toEqual([]);
  });

  it("does not re-pick a sponsor when this target is already being colonized", () => {
    setUp({ f1: flag("colonize", "W5N5") });
    (globalThis as { Game: { rooms: Record<string, unknown> } }).Game.rooms.W5N5 = { controller: {} };

    const world = testEmpire(
      colonySnap({ name: "W1N1", energyCapacity: COLONIZER_COST, colonizing: ["W5N5"] })
    );

    runColonizeFlags(world);

    // Still just the one entry — no duplicate handoff. Memory itself was never written this time
    // (the dedup check short-circuits before any addColonizeTarget intent is built).
    expect(colonizingOf(Memory, "W1N1")).toEqual([]);
  });

  it("cannot tell the target room when the flag has no room-suffixed name and sits in an unscouted room", () => {
    const remove = vi.fn();
    setUp({ f1: flag("colonize", "W1N1", remove) }); // bare name, home room has no controller in this fixture's Game.rooms

    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: COLONIZER_COST }));

    runColonizeFlags(world);

    expect(remove).not.toHaveBeenCalled();
    expect(colonizingOf(Memory, "W1N1")).toEqual([]);
  });

  it("logs and leaves the flag when the empire is already at its GCL room budget", () => {
    const remove = vi.fn();
    // GCL 1 with 1 owned colony already — no room left to claim another.
    setUp({ f1: flag("colonize", "W5N5", remove) }, 1);

    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: COLONIZER_COST }));

    runColonizeFlags(world);

    expect(remove).not.toHaveBeenCalled();
    expect(colonizingOf(Memory, "W1N1")).toEqual([]);
  });
});
