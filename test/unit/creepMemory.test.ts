import { beforeEach, describe, expect, it } from "vitest";
import { cleanCreepMemory } from "../../src/kernel/creepMemory";
import { stubGame } from "../helpers";

describe("creep memory cleanup", () => {
  beforeEach(() => {
    stubGame({});
  });

  it("removes memory for creeps that no longer exist, keeping the living", () => {
    Game.creeps = { harvester1: {} as Creep };
    Memory.creeps = {
      harvester1: { role: "harvester" },
      deadHauler: { role: "hauler" }
    } as unknown as Memory["creeps"];

    cleanCreepMemory();

    expect(Object.keys(Memory.creeps)).toEqual(["harvester1"]);
  });

  it("does nothing when a fresh colony has no creep memory yet", () => {
    delete (Memory as Partial<Memory>).creeps;

    expect(() => cleanCreepMemory()).not.toThrow();
  });
});
