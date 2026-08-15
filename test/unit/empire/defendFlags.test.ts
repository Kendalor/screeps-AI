// Flag-triggered defend entry point: reads Game.flags for a "defend"/"defend:<room>" flag, resolves
// the target room, picks a sponsor colony via pickDefendSponsor, and hands the target off durably
// (addDefendTarget) rather than spawning anything directly. Same style as attackFlags.test.ts.

import { describe, expect, it, vi } from "vitest";
import { runDefendFlags } from "../../../src/empire/defendFlags";
import { DEFENDER_MIN_COST } from "../../../src/behaviors/roles/defender";
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
  // addDefendTarget's handler writes Memory.colonies[room] — stubGame() only seeds Memory.creeps.
  (globalThis as { Memory: { colonies: Record<string, unknown> } }).Memory.colonies = {};
}

const defendingOf = (mem: Record<string, unknown>, room: string): string[] =>
  ((mem as { colonies?: Record<string, { defending?: string[] }> }).colonies?.[room]?.defending) ?? [];

describe("runDefendFlags", () => {
  it("does nothing when there are no defend flags", () => {
    setUp({});
    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: DEFENDER_MIN_COST }));
    expect(() => runDefendFlags(world)).not.toThrow();
  });

  it("hands the target off to the sponsor colony and leaves the flag in place as the target's live switch", () => {
    const remove = vi.fn();
    setUp({ f1: flag("defend", "W5N5", remove) });
    // Bare "defend" name resolves via the flag's own room — needs vision there, no controller required.
    (globalThis as { Game: { rooms: Record<string, unknown> } }).Game.rooms.W5N5 = {};

    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: DEFENDER_MIN_COST }));

    runDefendFlags(world);

    expect(defendingOf(Memory, "W1N1")).toEqual(["W5N5"]);
    expect(remove).not.toHaveBeenCalled();
    expect(
      (Memory as unknown as { colonies: Record<string, { defendingFlags?: Record<string, string> }> }).colonies.W1N1
        .defendingFlags
    ).toEqual({ W5N5: "defend" });
  });

  it("drops just the flagged target the tick its flag is removed, leaving other targets untouched", () => {
    setUp({}); // no flags at all this tick
    const world = testEmpire(
      colonySnap({ name: "W1N1", energyCapacity: DEFENDER_MIN_COST, defending: ["W5N5", "W6N6"] })
    );
    // runDefendFlags' second/third pass reads raw Memory.defending (not the snapshot — see the source's
    // comment on why), so it must be seeded here too, alongside defendingFlags.
    (Memory as unknown as { colonies: Record<string, { defending: string[]; defendingFlags?: Record<string, string> }> }).colonies.W1N1 = {
      defending: ["W5N5", "W6N6"],
      defendingFlags: { W5N5: "defend" } // W6N6 has no flag entry
    } as never;

    runDefendFlags(world);

    expect(defendingOf(Memory, "W1N1")).toEqual(["W6N6"]);
  });

  it("removes a target's flag once the target itself is gone (operation's own completion logic)", () => {
    const remove = vi.fn();
    setUp({ f1: flag("defend", "W5N5", remove) });
    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: DEFENDER_MIN_COST, defending: [] }));
    (Memory as unknown as { colonies: Record<string, { defendingFlags?: Record<string, string> }> }).colonies.W1N1 = {
      defendingFlags: { W5N5: "defend" }
    } as never;

    runDefendFlags(world);

    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("parses the target room from a defend:<room> name when the flag's own room has no vision", () => {
    setUp({ f1: flag("defend:W7N7", "W1N1") }); // placed at home, target room itself unseen

    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: DEFENDER_MIN_COST }));

    runDefendFlags(world);

    expect(defendingOf(Memory, "W1N1")).toEqual(["W7N7"]);
  });

  it("logs and leaves the flag when no colony can afford a defender", () => {
    const remove = vi.fn();
    setUp({ f1: flag("defend", "W5N5", remove) });

    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: DEFENDER_MIN_COST - 1 }));

    expect(() => runDefendFlags(world)).not.toThrow();
    expect(remove).not.toHaveBeenCalled();
    expect(defendingOf(Memory, "W1N1")).toEqual([]);
  });

  it("does not re-pick a sponsor when this target is already being defended", () => {
    setUp({ f1: flag("defend", "W5N5") });
    (globalThis as { Game: { rooms: Record<string, unknown> } }).Game.rooms.W5N5 = {};

    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: DEFENDER_MIN_COST, defending: ["W5N5"] }));

    runDefendFlags(world);

    // Still just the one entry — no duplicate handoff. Memory itself was never written this time
    // (the dedup check short-circuits before any addDefendTarget intent is built).
    expect(defendingOf(Memory, "W1N1")).toEqual([]);
  });

  it("cannot tell the target room when the flag has no room-suffixed name and sits in an unseen room", () => {
    const remove = vi.fn();
    setUp({ f1: flag("defend", "W1N1", remove) }); // bare name, home room absent from this fixture's Game.rooms

    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: DEFENDER_MIN_COST }));

    runDefendFlags(world);

    expect(remove).not.toHaveBeenCalled();
    expect(defendingOf(Memory, "W1N1")).toEqual([]);
  });
});
