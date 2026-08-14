import { describe, expect, it } from "vitest";
import { censusByColony } from "../../src/snapshot/census";
import { snapCreep } from "../fixtures";

describe("censusByColony", () => {
  it("groups creeps by the colony they call home", () => {
    const map = censusByColony([
      snapCreep("bootstrap", { name: "a" }),
      snapCreep("bootstrap", { name: "b" }),
      snapCreep("miner", { name: "c" }),
      snapCreep("hauler", { name: "d", home: "W2N2" })
    ]);

    expect(map.W1N1.map(c => c.name)).toEqual(["a", "b", "c"]);
    expect(map.W2N2.map(c => c.name)).toEqual(["d"]);
  });

  // Grouping is by memory.home, not by the room the creep stands in — otherwise a creep stepping
  // across a border would make its colony's counts flicker.
  it("keeps a creep with its home colony regardless of where it is", () => {
    const map = censusByColony([snapCreep("miner", { name: "visitor", home: "W1N1" })]);

    expect(map.W1N1).toHaveLength(1);
    expect(map.W2N2).toBeUndefined();
  });

  it("includes spawning creeps, so a request is not filled twice while its creep is in the spawn", () => {
    const map = censusByColony([snapCreep("bootstrap", { spawning: true })]);

    expect(map.W1N1).toHaveLength(1);
  });

  it("returns an empty map for no creeps", () => {
    expect(censusByColony([])).toEqual({});
  });
});
