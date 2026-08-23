import { describe, expect, it } from "vitest";
import { spawningBoostedCreeps } from "../../../src/empire/boostSpawnDetection";
import type { ColonySnapshot, SnapCreep } from "../../../src/snapshot/types";

// Minimal fabricated SnapCreep — only the fields spawningBoostedCreeps actually reads
// (spawning, memory.boosts) matter; the rest are filled with plausible placeholder values
// matching the real SnapCreep shape (src/snapshot/types.ts) so the fixture stays representative.
function fakeCreep(name: string, spawning: boolean, boosts?: string[]): SnapCreep {
  return {
    id: name as SnapCreep["id"],
    name,
    body: [],
    ticksToLive: spawning ? undefined : 1000,
    spawning,
    role: "hauler",
    home: "W1N1",
    room: "W1N1",
    x: 10,
    y: 10,
    hits: 100,
    hitsMax: 100,
    fatigue: 0,
    storeEnergy: 0,
    storeCapacity: 0,
    memory: {
      role: "hauler",
      home: "W1N1",
      ...(boosts ? { boosts } : {})
    } as SnapCreep["memory"]
  };
}

function fakeColony(creeps: SnapCreep[]): ColonySnapshot {
  return { creeps } as ColonySnapshot;
}

describe("spawningBoostedCreeps", () => {
  it("returns a spawning creep that has a pending boost order", () => {
    const spawningBoosted = fakeCreep("boostedSpawner", true, ["heal", "tough"]);
    const colony = fakeColony([spawningBoosted]);

    expect(spawningBoostedCreeps(colony)).toEqual([spawningBoosted]);
  });

  it("excludes a spawning creep with no pending boost order", () => {
    const spawningPlain = fakeCreep("plainSpawner", true);
    const colony = fakeColony([spawningPlain]);

    expect(spawningBoostedCreeps(colony)).toEqual([]);
  });

  it("excludes a non-spawning (already alive) creep even with a pending boost order", () => {
    const aliveBoosted = fakeCreep("aliveBoosted", false, ["heal"]);
    const colony = fakeColony([aliveBoosted]);

    expect(spawningBoostedCreeps(colony)).toEqual([]);
  });

  it("returns an empty array for an empty creep list without error", () => {
    expect(spawningBoostedCreeps(fakeColony([]))).toEqual([]);
  });
});
