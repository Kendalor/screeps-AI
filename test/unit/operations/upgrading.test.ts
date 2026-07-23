// The quota has two regimes now: pre-storage, a small dedicated squad leads the RCL climb; with
// storage, the ported getMaxUpgraders formula scales on what storage holds. Constructs the operation
// directly and hands it a snapshot: no Game mock, no Colony.

import { describe, expect, it } from "vitest";
import { Upgrading } from "../../../src/operations/upgrading";
import { colonySnap, containerAt, dropAt, snapCreeps } from "../../fixtures";

const upgrading = new Upgrading("W1N1");
const upgraderRequests = (over: Parameters<typeof colonySnap>[0]) => upgrading.desiredCreeps(colonySnap(over));

describe("Upgrading.desiredCreeps — pre-storage squad", () => {
  it("fields 1–3 dedicated upgraders once there is energy to draw from, scaling with sources", () => {
    // A filled mining container is a source of energy the upgrader role can withdraw from.
    const one = upgraderRequests({
      storageEnergy: 0,
      controllerLevel: 2,
      sources: [{ id: "s1" as Id<Source>, x: 20, y: 10, openTiles: 8 }],
      containers: [containerAt(21, 10, 500)]
    });
    expect(one).toHaveLength(1);

    const two = upgraderRequests({
      storageEnergy: 0,
      controllerLevel: 2,
      sources: [
        { id: "s1" as Id<Source>, x: 20, y: 10, openTiles: 8 },
        { id: "s2" as Id<Source>, x: 30, y: 40, openTiles: 8 }
      ],
      containers: [containerAt(21, 10, 500)]
    });
    expect(two).toHaveLength(2);
  });

  it("also works off ground drops before any container is built", () => {
    expect(
      upgraderRequests({ storageEnergy: 0, controllerLevel: 2, drops: [dropAt(20, 10, 200)] })
    ).toHaveLength(1);
  });

  it("asks for nothing pre-storage with no container energy and no drops — nothing to withdraw from", () => {
    expect(upgraderRequests({ storageEnergy: 0, controllerLevel: 2, containers: [], drops: [] })).toEqual([]);
  });

  it("is viable from RCL1 — it is what climbs the controller off room start", () => {
    expect(
      upgraderRequests({ storageEnergy: 0, controllerLevel: 1, drops: [dropAt(20, 10, 200)] })
    ).toHaveLength(1);
  });
});

describe("Upgrading.desiredCreeps — with storage (ported getMaxUpgraders)", () => {
  it("with storage, scales with stored energy instead of room energy (ported getMaxUpgraders)", () => {
    expect(upgraderRequests({ storageEnergy: 100_000, controllerLevel: 4 })).toHaveLength(0);
    expect(upgraderRequests({ storageEnergy: 140_000, controllerLevel: 4 })).toHaveLength(1);
    expect(upgraderRequests({ storageEnergy: 500_000, controllerLevel: 6 })).toHaveLength(4);
  });

  it("returns nothing once the live upgraders meet the quota", () => {
    expect(
      upgraderRequests({ storageEnergy: 500_000, controllerLevel: 6, creeps: snapCreeps("upgrader", 4) })
    ).toEqual([]);
  });

  it("asks only for the shortfall when some upgraders are already alive", () => {
    expect(
      upgraderRequests({ storageEnergy: 500_000, controllerLevel: 6, creeps: snapCreeps("upgrader", 3) })
    ).toHaveLength(1);
  });

  it("stamps its own op name on every request", () => {
    const [request] = upgraderRequests({ storageEnergy: 140_000, controllerLevel: 4 });

    expect(request.memory).toMatchObject({ role: "upgrader", home: "W1N1", op: "upgrading:W1N1" });
  });
});
