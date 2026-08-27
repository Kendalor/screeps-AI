// SingleTargetFlagOperation.desiredCreeps()'s boost-stamping (Task E, gh #61 epic): a state carrying a
// resolved boostTier must stamp memory.boosts (the role's full boostable list) and a non-empty boostNeeds
// map onto every spawned creep's request; a state with no boostTier must add neither field at all — this
// must be a strictly additive, zero-behavior-change path for every existing non-boosted request.

import { describe, expect, it } from "vitest";
import { SimpleBaitTowerOperation } from "../../../src/operations/simpleBaitTower";
import { colonySnap } from "../../fixtures";
import type { SingleTargetOpState } from "../../../src/memory/schema";

function state(over: Partial<SingleTargetOpState> = {}): SingleTargetOpState {
  return { flag: "simpleBaitTower:W5N5:1", lifetime: "constant", wanted: 1, spawnedCount: 0, ...over };
}

describe("SingleTargetFlagOperation.desiredCreeps boost-stamping", () => {
  it("stamps memory.boosts and a non-empty boostNeeds when boostTier is set", () => {
    const op = new SimpleBaitTowerOperation("W1N1", "W5N5", state({ boostTier: 3 }));
    const colony = colonySnap({ name: "W1N1", energyCapacity: 1000 });

    const requests = op.desiredCreeps(colony);

    expect(requests).toHaveLength(1);
    expect(requests[0].memory.boosts).toEqual(["tough", "heal", "attack"]);
    expect(requests[0].boostNeeds).toBeDefined();
    expect(Object.keys(requests[0].boostNeeds ?? {}).length).toBeGreaterThan(0);
  });

  it("adds neither memory.boosts nor boostNeeds when boostTier is not set", () => {
    const op = new SimpleBaitTowerOperation("W1N1", "W5N5", state());
    const colony = colonySnap({ name: "W1N1", energyCapacity: 1000 });

    const requests = op.desiredCreeps(colony);

    expect(requests).toHaveLength(1);
    expect(requests[0].memory.boosts).toBeUndefined();
    expect(requests[0].boostNeeds).toBeUndefined();
  });
});
