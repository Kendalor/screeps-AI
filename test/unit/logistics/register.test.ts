// Unit-proves gh #46's registerMinerContainerOutput against a minimal stub of the exact Game API surface
// it reads (Source.pos.findInRange, StructureContainer.store) — same "fake the live-object shape, not a
// ColonySnapshot" pattern test/unit/behaviors/creepBehavior/world.ts and interpreter.test.ts already use
// for other Game.*-reading code. The rate-ranking core itself (pickBestRequest) is proven separately via
// the real mockup server in test/integration/logistics-request-rank.test.ts, per the PRD's testing
// decision that only the ranking/matching behavior needs the full integration seam — this function's own
// logic (threshold gate, dAmountdt wiring) is a small enough pure computation over its inputs to unit-test
// directly, same as topoff.ts's pickTopoff.

import { describe, expect, it } from "vitest";
import { ENERGY_CONTAINER_REGISTER_THRESHOLD, registerMinerContainerOutput } from "../../../src/logistics/register";

const CAPACITY = 2000;

function stubSource(container: StructureContainer | undefined): Source {
  return {
    pos: {
      findInRange: () => (container ? [container] : [])
    }
  } as unknown as Source;
}

function stubContainer(stored: number): StructureContainer {
  return {
    id: "container1" as Id<StructureContainer>,
    pos: { x: 10, y: 10, roomName: "W1N1" } as RoomPosition,
    structureType: STRUCTURE_CONTAINER,
    store: {
      getUsedCapacity: (r: ResourceConstant) => (r === RESOURCE_ENERGY ? stored : 0),
      getCapacity: (r: ResourceConstant) => (r === RESOURCE_ENERGY ? CAPACITY : 0)
    }
  } as unknown as StructureContainer;
}

describe("registerMinerContainerOutput", () => {
  it("returns undefined when no container is built yet", () => {
    expect(registerMinerContainerOutput(stubSource(undefined))).toBeUndefined();
  });

  it("returns undefined below the register threshold", () => {
    const container = stubContainer(Math.floor(CAPACITY * ENERGY_CONTAINER_REGISTER_THRESHOLD) - 1);
    expect(registerMinerContainerOutput(stubSource(container))).toBeUndefined();
  });

  it("registers an output request once at/above the threshold, negated amount/rate", () => {
    const stored = Math.ceil(CAPACITY * ENERGY_CONTAINER_REGISTER_THRESHOLD);
    const container = stubContainer(stored);
    const request = registerMinerContainerOutput(stubSource(container), 12);

    expect(request).toBeDefined();
    expect(request?.target).toBe(container);
    expect(request?.resource).toBe(RESOURCE_ENERGY);
    expect(request?.amount).toBe(-stored); // requestOutput negates: "has to give", not "wants delivered"
    expect(request?.dAmountdt).toBe(-12);
    expect(request?.multiplier).toBe(1);
  });

  it("defaults dAmountdt to 0 when no harvest rate is given", () => {
    const stored = CAPACITY; // full, well above threshold
    const request = registerMinerContainerOutput(stubSource(stubContainer(stored)));
    // -0, not +0: requestOutput negates dAmountdt unconditionally — see its own doc. Equal by value.
    expect(request?.dAmountdt).toEqual(-0);
  });
});
