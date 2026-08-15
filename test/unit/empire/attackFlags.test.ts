// Flag-triggered attack entry point: reads Game.flags for an "attack"/"attack:<room>" flag, resolves
// the target room, picks a sponsor colony via pickAttackSponsor, and hands the target off durably
// (addAttackTarget) rather than spawning anything directly. Same style as colonizeFlags.test.ts, except
// a bare "attack" flag's physical-room fallback needs only vision (Game.rooms entry), not a controller —
// attacking an unowned/hostile room is exactly the point, unlike colonizing which needs a controller to claim.

import { describe, expect, it, vi } from "vitest";
import { runAttackFlags } from "../../../src/empire/attackFlags";
import { ATTACKER_MIN_COST } from "../../../src/behaviors/roles/attacker";
import { testEmpire, colonySnap } from "../../fixtures";
import { stubGame } from "../../helpers";

function flag(name: string, roomName: string, remove: () => void = vi.fn()) {
  return { name, pos: { roomName }, remove };
}

function setUp(flags: Record<string, ReturnType<typeof flag>>) {
  stubGame();
  const game = (globalThis as { Game: Record<string, unknown> }).Game;
  game.flags = flags;
  game.rooms = {};
  game.map = { findRoute: (_from: string, dest: string) => [{ room: dest }] };
  // addAttackTarget's handler writes Memory.colonies[room] — stubGame() only seeds Memory.creeps.
  (globalThis as { Memory: { colonies: Record<string, unknown> } }).Memory.colonies = {};
}

const attackingOf = (mem: Record<string, unknown>, room: string): string[] =>
  ((mem as { colonies?: Record<string, { attacking?: string[] }> }).colonies?.[room]?.attacking) ?? [];

describe("runAttackFlags", () => {
  it("does nothing when there are no attack flags", () => {
    setUp({});
    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: ATTACKER_MIN_COST }));
    expect(() => runAttackFlags(world)).not.toThrow();
  });

  it("hands the target off to the sponsor colony and leaves the flag in place as the target's live switch", () => {
    const remove = vi.fn();
    setUp({ f1: flag("attack", "W5N5", remove) });
    // Bare "attack" name resolves via the flag's own room — needs vision there, no controller required.
    (globalThis as { Game: { rooms: Record<string, unknown> } }).Game.rooms.W5N5 = {};

    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: ATTACKER_MIN_COST }));

    runAttackFlags(world);

    expect(attackingOf(Memory, "W1N1")).toEqual(["W5N5"]);
    expect(remove).not.toHaveBeenCalled();
    expect(
      (Memory as unknown as { colonies: Record<string, { attackingFlags?: Record<string, string> }> }).colonies.W1N1
        .attackingFlags
    ).toEqual({ W5N5: "attack" });
  });

  it("drops just the flagged target the tick its flag is removed, leaving other targets untouched", () => {
    setUp({}); // no flags at all this tick
    const world = testEmpire(
      colonySnap({ name: "W1N1", energyCapacity: ATTACKER_MIN_COST, attacking: ["W5N5", "W6N6"] })
    );
    // runAttackFlags' second/third pass reads raw Memory.attacking (not the snapshot — see the source's
    // comment on why), so it must be seeded here too, alongside attackingFlags.
    (Memory as unknown as { colonies: Record<string, { attacking: string[]; attackingFlags?: Record<string, string> }> }).colonies.W1N1 = {
      attacking: ["W5N5", "W6N6"],
      attackingFlags: { W5N5: "attack" } // W6N6 has no flag entry — e.g. auto-picked by remoteInvaderAttacks
    } as never;

    runAttackFlags(world);

    expect(attackingOf(Memory, "W1N1")).toEqual(["W6N6"]);
  });

  it("removes a target's flag once the target itself is gone (operation's own completion logic)", () => {
    const remove = vi.fn();
    setUp({ f1: flag("attack", "W5N5", remove) });
    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: ATTACKER_MIN_COST, attacking: [] }));
    (Memory as unknown as { colonies: Record<string, { attackingFlags?: Record<string, string> }> }).colonies.W1N1 = {
      attackingFlags: { W5N5: "attack" }
    } as never;

    runAttackFlags(world);

    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("parses the target room from an attack:<room> name when the flag's own room has no vision", () => {
    setUp({ f1: flag("attack:W7N7", "W1N1") }); // placed at home, target room itself unseen

    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: ATTACKER_MIN_COST }));

    runAttackFlags(world);

    expect(attackingOf(Memory, "W1N1")).toEqual(["W7N7"]);
  });

  it("uses an attack:<room> suffix even when the flag physically sits in a room with vision (e.g. the player's own base)", () => {
    setUp({ f1: flag("attack:W7N7", "W1N1") });
    (globalThis as { Game: { rooms: Record<string, unknown> } }).Game.rooms.W1N1 = {};

    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: ATTACKER_MIN_COST }));

    runAttackFlags(world);

    expect(attackingOf(Memory, "W1N1")).toEqual(["W7N7"]);
  });

  it("logs and leaves the flag when no colony can afford an attacker", () => {
    const remove = vi.fn();
    setUp({ f1: flag("attack", "W5N5", remove) });

    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: ATTACKER_MIN_COST - 1 }));

    expect(() => runAttackFlags(world)).not.toThrow();
    expect(remove).not.toHaveBeenCalled();
    expect(attackingOf(Memory, "W1N1")).toEqual([]);
  });

  it("does not re-pick a sponsor when this target is already being attacked", () => {
    setUp({ f1: flag("attack", "W5N5") });
    (globalThis as { Game: { rooms: Record<string, unknown> } }).Game.rooms.W5N5 = {};

    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: ATTACKER_MIN_COST, attacking: ["W5N5"] }));

    runAttackFlags(world);

    // Still just the one entry — no duplicate handoff. Memory itself was never written this time
    // (the dedup check short-circuits before any addAttackTarget intent is built).
    expect(attackingOf(Memory, "W1N1")).toEqual([]);
  });

  it("cannot tell the target room when the flag has no room-suffixed name and sits in an unseen room", () => {
    const remove = vi.fn();
    setUp({ f1: flag("attack", "W1N1", remove) }); // bare name, home room absent from this fixture's Game.rooms

    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: ATTACKER_MIN_COST }));

    runAttackFlags(world);

    expect(remove).not.toHaveBeenCalled();
    expect(attackingOf(Memory, "W1N1")).toEqual([]);
  });
});
