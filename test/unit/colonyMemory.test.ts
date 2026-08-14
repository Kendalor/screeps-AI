import { describe, expect, it } from "vitest";
import { cleanColonyMemory } from "../../src/kernel/colonyMemory";
import { stubGame } from "../helpers";

describe("colony memory cleanup", () => {
  it("removes memory for a room that's no longer owned, keeping the owned", () => {
    stubGame({ rooms: { W1N1: { controller: { my: true } } } });
    Memory.colonies = {
      W1N1: { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [] },
      W2N2: { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [] }
    };

    cleanColonyMemory();

    expect(Object.keys(Memory.colonies)).toEqual(["W1N1"]);
  });

  it("removes memory for a room merely visible (scouted) without ownership — vision alone must never keep a colony record alive", () => {
    stubGame({ rooms: { W3N3: { controller: { my: false } } } });
    Memory.colonies = { W3N3: { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [] } };

    cleanColonyMemory();

    expect(Memory.colonies.W3N3).toBeUndefined();
  });

  it("removes memory for a room with no controller at all (e.g. a highway room briefly visible)", () => {
    stubGame({ rooms: { W3N3: {} } });
    Memory.colonies = { W3N3: { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [] } };

    cleanColonyMemory();

    expect(Memory.colonies.W3N3).toBeUndefined();
  });

  it("removes memory for a room with no vision at all this tick", () => {
    stubGame({ rooms: {} });
    Memory.colonies = { W4N4: { sources: {}, remotes: [], danger: 0, colonizing: [], attacking: [], defending: [] } };

    cleanColonyMemory();

    expect(Memory.colonies.W4N4).toBeUndefined();
  });

  it("does nothing when there is no colony memory yet", () => {
    stubGame({});
    delete (Memory as Partial<Memory>).colonies;

    expect(() => cleanColonyMemory()).not.toThrow();
  });
});
