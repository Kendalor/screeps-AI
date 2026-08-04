// Flag-triggered drain entry point: reads Game.flags for a "drain"/"drain:<room>" flag, resolves the
// target room, picks a sponsor colony via pickDrainSponsor, and hands the target off durably
// (setDrainTarget) rather than spawning anything directly. Mirrors attackFlags.test.ts exactly, except
// the "already handed off" dedup check reads a scalar (ColonyMemory.draining === target) instead of
// checking list membership, since ADR 0006 fixes exactly one drain target per colony.

import { describe, expect, it, vi } from "vitest";
import { runDrainFlags } from "../../../src/empire/drainFlags";
import { DRAIN_ATTACKER_MIN_COST } from "../../../src/behaviors/roles/drainAttacker";
import { DRAIN_HEALER_MIN_COST } from "../../../src/behaviors/roles/drainHealer";
import { testEmpire, colonySnap } from "../../fixtures";
import { stubGame } from "../../helpers";

const SQUAD_MIN_COST = DRAIN_ATTACKER_MIN_COST + 3 * DRAIN_HEALER_MIN_COST;

function flag(name: string, roomName: string, remove: () => void = vi.fn()) {
  return { name, pos: { roomName }, remove };
}

function setUp(flags: Record<string, ReturnType<typeof flag>>) {
  stubGame();
  const game = (globalThis as { Game: Record<string, unknown> }).Game;
  game.flags = flags;
  game.rooms = {};
  game.map = { findRoute: (_from: string, dest: string) => [{ room: dest }] };
  // setDrainTarget's handler writes Memory.colonies[room] — stubGame() only seeds Memory.creeps.
  (globalThis as { Memory: { colonies: Record<string, unknown> } }).Memory.colonies = {};
}

const drainingOf = (mem: Record<string, unknown>, room: string): string | undefined =>
  (mem as { colonies?: Record<string, { draining?: string }> }).colonies?.[room]?.draining;

describe("runDrainFlags", () => {
  it("does nothing when there are no drain flags", () => {
    setUp({});
    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: SQUAD_MIN_COST }));
    expect(() => runDrainFlags(world)).not.toThrow();
  });

  it("hands the target off to the sponsor colony and removes the flag on success", () => {
    const remove = vi.fn();
    setUp({ f1: flag("drain", "W5N5", remove) });
    // Bare "drain" name resolves via the flag's own room — needs vision there, no controller required.
    (globalThis as { Game: { rooms: Record<string, unknown> } }).Game.rooms.W5N5 = {};

    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: SQUAD_MIN_COST }));

    runDrainFlags(world);

    expect(drainingOf(Memory, "W1N1")).toBe("W5N5");
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("parses the target room from a drain:<room> name when the flag's own room has no vision", () => {
    setUp({ f1: flag("drain:W7N7", "W1N1") }); // placed at home, target room itself unseen

    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: SQUAD_MIN_COST }));

    runDrainFlags(world);

    expect(drainingOf(Memory, "W1N1")).toBe("W7N7");
  });

  it("uses a drain:<room> suffix even when the flag physically sits in a room with vision (e.g. the player's own base)", () => {
    setUp({ f1: flag("drain:W7N7", "W1N1") });
    (globalThis as { Game: { rooms: Record<string, unknown> } }).Game.rooms.W1N1 = {};

    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: SQUAD_MIN_COST }));

    runDrainFlags(world);

    expect(drainingOf(Memory, "W1N1")).toBe("W7N7");
  });

  it("logs and leaves the flag when no colony can afford a full drain squad", () => {
    const remove = vi.fn();
    setUp({ f1: flag("drain", "W5N5", remove) });

    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: SQUAD_MIN_COST - 1 }));

    expect(() => runDrainFlags(world)).not.toThrow();
    expect(remove).not.toHaveBeenCalled();
    expect(drainingOf(Memory, "W1N1")).toBeUndefined();
  });

  it("does not re-pick a sponsor when this target is already being drained", () => {
    setUp({ f1: flag("drain", "W5N5") });
    (globalThis as { Game: { rooms: Record<string, unknown> } }).Game.rooms.W5N5 = {};

    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: SQUAD_MIN_COST, draining: "W5N5" }));

    runDrainFlags(world);

    // Memory itself was never written this time (the dedup check short-circuits before any
    // setDrainTarget intent is built) — draining stays whatever the snapshot said, untouched.
    expect(drainingOf(Memory, "W1N1")).toBeUndefined();
  });

  it("cannot tell the target room when the flag has no room-suffixed name and sits in an unseen room", () => {
    const remove = vi.fn();
    setUp({ f1: flag("drain", "W1N1", remove) }); // bare name, home room absent from this fixture's Game.rooms

    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: SQUAD_MIN_COST }));

    runDrainFlags(world);

    expect(remove).not.toHaveBeenCalled();
    expect(drainingOf(Memory, "W1N1")).toBeUndefined();
  });

  it("does not offer a colony already draining a different target as a sponsor for a new one", () => {
    const remove = vi.fn();
    setUp({ f1: flag("drain", "W6N6", remove) });
    (globalThis as { Game: { rooms: Record<string, unknown> } }).Game.rooms.W6N6 = {};

    // Only colony in the empire is already draining W5N5 — it must not be reassigned to W6N6.
    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: SQUAD_MIN_COST, draining: "W5N5" }));

    runDrainFlags(world);

    expect(remove).not.toHaveBeenCalled();
    expect(drainingOf(Memory, "W1N1")).toBeUndefined();
  });

  it("a second drain flag for the same target the colony already has active is a harmless no-op", () => {
    const remove = vi.fn();
    setUp({ f1: flag("drain", "W5N5", remove) });
    (globalThis as { Game: { rooms: Record<string, unknown> } }).Game.rooms.W5N5 = {};

    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: SQUAD_MIN_COST, draining: "W5N5" }));

    expect(() => runDrainFlags(world)).not.toThrow();
    // Already-draining dedup short-circuits before any intent/flag removal — same as the "already being
    // drained" case above (draining that exact target again is a no-op, not an error).
    expect(remove).not.toHaveBeenCalled();
  });
});
