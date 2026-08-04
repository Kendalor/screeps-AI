// Ported from legacy SupplyOperation: a flat RCL-gated quota, not a per-source deficit like Mining.
// Spawnable from RCL1 — a starved spawn stalls the whole colony, so supply must be available before
// storage or even the RCL3 energy cap exist (see operations/supply.ts).
// Task assignment (where it withdraws/delivers) is Logistics-owned, not tested here — see
// test/unit/logistics/ for the provider/consumer graph and allocator this operation's creeps run under.

import { describe, expect, it } from "vitest";
import { Supply } from "../../../src/operations/supply";
import { colonySnap, snapCreeps } from "../../fixtures";

const supply = new Supply("W1N1");
const supplyRequests = (over: Parameters<typeof colonySnap>[0]) => supply.desiredCreeps(colonySnap(over));

describe("Supply.desiredCreeps", () => {
  it("wants one supply creep from RCL1, before the room can afford the RCL3-sized body", () => {
    expect(supplyRequests({ energyCapacity: 300, controllerLevel: 2 })).toHaveLength(1);
  });

  it("wants one supply creep once energyCapacity reaches the RCL3 threshold", () => {
    expect(supplyRequests({ energyCapacity: 550, controllerLevel: 3 })).toHaveLength(1);
  });

  it("scales to two supply creeps at the high-RCL threshold", () => {
    expect(supplyRequests({ energyCapacity: 550, controllerLevel: 7 })).toHaveLength(2);
    expect(supplyRequests({ energyCapacity: 550, controllerLevel: 8 })).toHaveLength(2);
  });

  it("returns nothing once the live supply creeps meet the quota", () => {
    expect(
      supplyRequests({ energyCapacity: 550, controllerLevel: 4, creeps: snapCreeps("supply", 1) })
    ).toEqual([]);
  });

  it("asks only for the shortfall when short of quota", () => {
    expect(
      supplyRequests({ energyCapacity: 550, controllerLevel: 7, creeps: snapCreeps("supply", 1) })
    ).toHaveLength(1);
  });

  it("stamps its own op name on every request", () => {
    const [request] = supplyRequests({ energyCapacity: 550, controllerLevel: 4 });
    expect(request.memory).toMatchObject({ role: "supply", home: "W1N1", op: "supply:W1N1" });
  });

  // With none alive, waiting for a capacity-sized body is the stall that starves extensions in
  // the meantime — size off what the room can spend right now instead.
  describe("cold start — no supply creep alive", () => {
    it("sizes the body off energyAvailable, not energyCapacity", () => {
      const [request] = supplyRequests({
        controllerLevel: 4,
        energyAvailable: 300,
        energyCapacity: 1800
      });
      expect(request.body).toHaveLength(6); // 3 [CARRY,MOVE] sets afford at 300, not the 36 parts 1800 would buy
    });

    it("sizes off energyCapacity once a supply creep is alive", () => {
      const [request] = supplyRequests({
        controllerLevel: 7, // quota 2, one alive — the shortfall path, not a cold start
        energyAvailable: 300,
        energyCapacity: 1800,
        creeps: snapCreeps("supply", 1)
      });
      expect(request.body.length).toBeGreaterThan(6);
    });
  });

  // A late request leaves the room without a supply creep for however long spawning runs past
  // death — the replacement must be requested with enough lead time to be ready in time.
  describe("handoff before the last supply creep dies", () => {
    it("requests nothing while the sole survivor has plenty of ticksToLive left", () => {
      expect(
        supplyRequests({
          energyCapacity: 550,
          controllerLevel: 4,
          creeps: snapCreeps("supply", 1, { ticksToLive: 500 })
        })
      ).toEqual([]);
    });

    it("requests the replacement once ticksToLive drops to the new body's spawn time", () => {
      // energyCapacity 550 → haulerBody affords 5 [CARRY,MOVE] sets = 10 parts → 10*3=30 tick spawn time.
      const requests = supplyRequests({
        controllerLevel: 4,
        energyCapacity: 550,
        creeps: snapCreeps("supply", 1, { ticksToLive: 30 })
      });
      expect(requests).toHaveLength(1);
      expect(requests[0].body).toHaveLength(10);
    });

    it("does not yet request a replacement one tick before the spawn-time threshold", () => {
      expect(
        supplyRequests({
          controllerLevel: 4,
          energyCapacity: 550,
          creeps: snapCreeps("supply", 1, { ticksToLive: 31 })
        })
      ).toEqual([]);
    });

    it("does not apply the one-in-one-out handoff check when at quota with more than one alive", () => {
      // RCL7 quota is 2; both alive and both about to die — no per-source ticksToLive branch fires,
      // so nothing is requested until one actually dies and the count drops to one.
      expect(
        supplyRequests({
          energyCapacity: 550,
          controllerLevel: 7,
          creeps: snapCreeps("supply", 2, { ticksToLive: 1 })
        })
      ).toEqual([]);
    });
  });
});
