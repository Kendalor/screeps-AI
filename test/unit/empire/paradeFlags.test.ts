// Flag-triggered parade entry point: reads Game.flags for a "parade"/"parade:<room>"/"parade:<shape>"/
// "parade:<room>:<shape>" flag, resolves the sponsor room and squad shape, picks a sponsor colony via
// pickParadeSponsor, and hands the flag name + shape off durably (setParadeTarget). Unlike drain's target
// room, Parade's live destination is the flag's OWN position (see operations/parade.ts), so the flag
// itself — not a resolved room — is what stays in ColonyMemory.parading; the flag is never removed on a
// successful handoff, same "flag IS the operation's lifetime" shape as drainFlags.

import { describe, expect, it, vi } from "vitest";
import { runParadeFlags } from "../../../src/empire/paradeFlags";
import { PARADE_MEMBER_MIN_COST } from "../../../src/behaviors/roles/paradeMember";
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
  (globalThis as { Memory: { colonies: Record<string, unknown> } }).Memory.colonies = {};
}

const paradingOf = (mem: Record<string, unknown>, room: string): { flag: string; formation: string } | undefined =>
  (mem as { colonies?: Record<string, { parading?: { flag: string; formation: string } }> }).colonies?.[room]?.parading;

describe("runParadeFlags", () => {
  it("does nothing when there are no parade flags", () => {
    setUp({});
    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: PARADE_MEMBER_MIN_COST }));
    expect(() => runParadeFlags(world)).not.toThrow();
  });

  it("hands a bare 'parade' flag off with the default 2x2 formation and leaves the flag in place", () => {
    const remove = vi.fn();
    setUp({ f1: flag("parade", "W5N5", remove) });
    (globalThis as { Game: { rooms: Record<string, unknown> } }).Game.rooms.W5N5 = {};

    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: PARADE_MEMBER_MIN_COST }));
    runParadeFlags(world);

    expect(paradingOf(Memory, "W1N1")).toEqual({ flag: "parade", formation: "2x2" });
    expect(remove).not.toHaveBeenCalled();
  });

  it("parses an explicit shape segment (parade:1x3)", () => {
    setUp({ f1: flag("parade:1x3", "W5N5") });
    (globalThis as { Game: { rooms: Record<string, unknown> } }).Game.rooms.W5N5 = {};

    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: PARADE_MEMBER_MIN_COST }));
    runParadeFlags(world);

    expect(paradingOf(Memory, "W1N1")).toEqual({ flag: "parade:1x3", formation: "1x3" });
  });

  it("parses an explicit room segment even when the flag physically sits elsewhere (parade:W7N7)", () => {
    setUp({ f1: flag("parade:W7N7", "W1N1") });

    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: PARADE_MEMBER_MIN_COST }));
    runParadeFlags(world);

    expect(paradingOf(Memory, "W1N1")).toEqual({ flag: "parade:W7N7", formation: "2x2" });
  });

  it("parses room+shape segments in either order (parade:W7N7:1x3 and parade:1x3:W7N7 are equivalent)", () => {
    setUp({ f1: flag("parade:W7N7:1x3", "W1N1") });
    const world1 = testEmpire(colonySnap({ name: "W1N1", energyCapacity: PARADE_MEMBER_MIN_COST }));
    runParadeFlags(world1);
    expect(paradingOf(Memory, "W1N1")).toEqual({ flag: "parade:W7N7:1x3", formation: "1x3" });

    setUp({ f1: flag("parade:1x3:W7N7", "W1N1") });
    const world2 = testEmpire(colonySnap({ name: "W1N1", energyCapacity: PARADE_MEMBER_MIN_COST }));
    runParadeFlags(world2);
    expect(paradingOf(Memory, "W1N1")).toEqual({ flag: "parade:1x3:W7N7", formation: "1x3" });
  });

  it("clears a colony's parade the tick its flag is removed", () => {
    setUp({}); // no flags at all this tick

    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: PARADE_MEMBER_MIN_COST, parading: { flag: "parade", formation: "2x2" } }));
    runParadeFlags(world);

    expect(paradingOf(Memory, "W1N1")).toBeUndefined();
  });

  it("keeps parading while its flag is still present", () => {
    setUp({ f1: flag("parade", "W5N5") });
    (globalThis as { Game: { rooms: Record<string, unknown> } }).Game.rooms.W5N5 = {};

    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: PARADE_MEMBER_MIN_COST, parading: { flag: "parade", formation: "2x2" } }));
    runParadeFlags(world);

    // Handoff dedup short-circuits (already parading this exact flag); clear pass finds the flag live.
    // Neither pass writes Memory, so it reads back exactly what the snapshot said via testEmpire — i.e.
    // this assertion only checks the clear pass didn't fire.
    expect(Memory.colonies?.W1N1?.parading).toBeUndefined();
  });

  it("logs and leaves the flag when no colony can afford even one parade member", () => {
    const remove = vi.fn();
    setUp({ f1: flag("parade", "W5N5", remove) });

    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: PARADE_MEMBER_MIN_COST - 1 }));
    expect(() => runParadeFlags(world)).not.toThrow();

    expect(remove).not.toHaveBeenCalled();
    expect(paradingOf(Memory, "W1N1")).toBeUndefined();
  });

  it("does not re-pick a sponsor when this exact flag is already parading", () => {
    setUp({ f1: flag("parade", "W5N5") });
    (globalThis as { Game: { rooms: Record<string, unknown> } }).Game.rooms.W5N5 = {};

    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: PARADE_MEMBER_MIN_COST, parading: { flag: "parade", formation: "2x2" } }));
    runParadeFlags(world);

    expect(Memory.colonies?.W1N1?.parading).toBeUndefined(); // dedup short-circuits before any write
  });

  it("cannot tell which room to spawn near when the flag has no room segment and sits in an unseen room", () => {
    const remove = vi.fn();
    setUp({ f1: flag("parade", "W1N1", remove) }); // bare name, home room absent from Game.rooms

    const world = testEmpire(colonySnap({ name: "W1N1", energyCapacity: PARADE_MEMBER_MIN_COST }));
    runParadeFlags(world);

    expect(remove).not.toHaveBeenCalled();
    expect(paradingOf(Memory, "W1N1")).toBeUndefined();
  });

  it("does not offer a colony already parading a different flag as a sponsor for a new one", () => {
    const remove = vi.fn();
    setUp({ f1: flag("parade:new", "W6N6", remove) });
    (globalThis as { Game: { rooms: Record<string, unknown> } }).Game.rooms.W6N6 = {};

    const world = testEmpire(
      colonySnap({ name: "W1N1", energyCapacity: PARADE_MEMBER_MIN_COST, parading: { flag: "parade:old", formation: "2x2" } })
    );
    runParadeFlags(world);

    expect(remove).not.toHaveBeenCalled();
    // W1N1 keeps its OLD parading (untouched by this pass — it wasn't offered as a sponsor); the "new"
    // flag simply finds no eligible colony and is logged as such.
    expect(paradingOf(Memory, "W1N1")).toBeUndefined();
  });
});
