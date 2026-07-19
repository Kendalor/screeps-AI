import { describe, expect, it } from "vitest";
import { censusByColony, type CensusCreep } from "../../src/snapshot/census";

function creep(home: string, role: string, spawning = false): CensusCreep {
  return { home, role: role as CensusCreep["role"], spawning };
}

describe("census", () => {
  it("counts alive creeps per role per home colony", () => {
    const map = censusByColony([
      creep("W1N1", "bootstrap"),
      creep("W1N1", "bootstrap"),
      creep("W1N1", "miner"),
      creep("W2N2", "hauler")
    ]);

    expect(map.W1N1).toEqual({ bootstrap: 2, miner: 1 });
    expect(map.W2N2).toEqual({ hauler: 1 });
  });

  it("counts spawning creeps toward the census so quotas are not double-filled", () => {
    const map = censusByColony([creep("W1N1", "bootstrap", true)]);

    expect(map.W1N1).toEqual({ bootstrap: 1 });
  });

  it("returns an empty map for no creeps", () => {
    expect(censusByColony([])).toEqual({});
  });
});
