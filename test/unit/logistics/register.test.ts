// Unit-proves gh #46's registerMinerContainerOutput and gh #48's registerMineralContainerOutput against a
// minimal stub of the exact Game API surface each reads (Source/Mineral.pos.findInRange,
// StructureContainer.store) — same "fake the live-object shape, not a ColonySnapshot" pattern
// test/unit/behaviors/creepBehavior/world.ts and interpreter.test.ts already use for other Game.*-reading
// code. The rate-ranking core itself (pickBestRequest/scoreRequest) is proven separately via the real
// mockup server in test/integration/logistics-request-rank.test.ts (energy-only, gh #46's proof) and,
// below, via a plain pure-function test against request.ts's scoreRequest/pickBestRequest directly with
// hand-built LogisticsRequest objects — gh #48's mockup-server integration test was attempted and
// abandoned (the harness's console test seam stopped delivering commands once seeded past RCL4; see the
// removed test/integration/mineral-vs-energy-rank.test.ts in git history and this ticket's own testing
// note permitting a simplified proof). Each registration function's own logic (threshold gate vs.
// unconditional-if-any-amount) is a small enough pure computation over its inputs to unit-test directly,
// same as topoff.ts's pickTopoff.

import { describe, expect, it } from "vitest";
import {
  ENERGY_CONTAINER_REGISTER_THRESHOLD,
  registerMineralContainerOutput,
  registerMinerContainerOutput
} from "../../../src/logistics/register";
import { pickBestRequest, requestOutput, scoreRequest, type LogisticsRequest } from "../../../src/logistics/request";

const CAPACITY = 2000;

function stubSource(container: StructureContainer | undefined): Source {
  return {
    pos: {
      findInRange: () => (container ? [container] : [])
    }
  } as unknown as Source;
}

function stubMineral(mineralType: MineralConstant, container: StructureContainer | undefined): Mineral {
  return {
    mineralType,
    pos: {
      findInRange: () => (container ? [container] : [])
    }
  } as unknown as Mineral;
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

function stubMineralContainer(mineralType: MineralConstant, stored: number): StructureContainer {
  return {
    id: "mineralContainer1" as Id<StructureContainer>,
    pos: { x: 20, y: 20, roomName: "W1N1" } as RoomPosition,
    structureType: STRUCTURE_CONTAINER,
    store: {
      getUsedCapacity: (r: ResourceConstant) => (r === mineralType ? stored : 0),
      getCapacity: () => CAPACITY
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

describe("registerMineralContainerOutput", () => {
  const ZYNTHIUM: MineralConstant = "Z";

  it("returns undefined when no container is built yet", () => {
    expect(registerMineralContainerOutput(stubMineral(ZYNTHIUM, undefined))).toBeUndefined();
  });

  it("returns undefined when the container holds no mineral yet", () => {
    const container = stubMineralContainer(ZYNTHIUM, 0);
    expect(registerMineralContainerOutput(stubMineral(ZYNTHIUM, container))).toBeUndefined();
  });

  it("registers unconditionally with any amount above zero — no threshold", () => {
    const container = stubMineralContainer(ZYNTHIUM, 1);
    const request = registerMineralContainerOutput(stubMineral(ZYNTHIUM, container));

    expect(request).toBeDefined();
    expect(request?.target).toBe(container);
    expect(request?.resource).toBe(ZYNTHIUM);
    expect(request?.amount).toBe(-1); // requestOutput negates: "has to give", not "wants delivered"
  });

  it("carries no dAmountdt — mineral accrues in cooldown-gated bursts, not a continuous rate", () => {
    const container = stubMineralContainer(ZYNTHIUM, 500);
    const request = registerMineralContainerOutput(stubMineral(ZYNTHIUM, container));
    expect(request?.dAmountdt).toEqual(-0);
  });

  it("scales amount with whatever is actually stored, well below a fullness threshold", () => {
    const smallStored = 5; // trivial vs. CAPACITY — would fail any energy-style threshold gate
    const container = stubMineralContainer(ZYNTHIUM, smallStored);
    const request = registerMineralContainerOutput(stubMineral(ZYNTHIUM, container));
    expect(request?.amount).toBe(-smallStored);
  });
});

// gh #48's core proof, pure: scoreRequest/pickBestRequest (request.ts) are plain functions over
// LogisticsRequest values, so the "a long-starved mineral request eventually outranks a routine energy
// request" behavior this whole ticket exists to prove doesn't need registration or a live creep at
// all — only the rate math does, and the rate math is exactly what these two exercise directly. This is
// the pure-function seam standing in for the mockup-server proof this ticket's own testing note allows
// dropping (see this file's header).
describe("mineral vs. energy rate race (scoreRequest/pickBestRequest, gh #48)", () => {
  const target = (id: string, x: number, y: number): _HasId & { pos: RoomPosition } =>
    ({ id: id as Id<_HasId>, pos: { x, y, roomName: "W1N1" } }) as unknown as _HasId & { pos: RoomPosition };

  // Same distance for both, so only `amount` decides the winner — isolates the "starved mineral grows
  // past a routine energy request's score" claim from any distance-discount confound.
  const distance = 10;
  const distanceTo = () => distance;

  it("a routine, always-available energy request outranks a trivial fresh mineral trickle", () => {
    const energy = requestOutput(target("energyContainer", 5, 5), RESOURCE_ENERGY, 500); // routine: half a container
    const mineral: LogisticsRequest = requestOutput(target("mineralContainer", 8, 8), "Z" as ResourceConstant, 1); // just registered, no threshold

    expect(scoreRequest(mineral, distance)).toBeLessThan(scoreRequest(energy, distance));
    expect(pickBestRequest([energy], RESOURCE_ENERGY, distanceTo)).toBe(energy);
  });

  it("the mineral request's score grows past the energy request's as it goes unmoved (starves)", () => {
    const energy = requestOutput(target("energyContainer", 5, 5), RESOURCE_ENERGY, 500);
    const energyScore = scoreRequest(energy, distance);

    // Mineral accrues in cooldown-gated bursts (registerMineralContainerOutput has no threshold, so every
    // amount above 0 already registers) — model "long-starved" as simply a larger accumulated amount,
    // same quantity a real container's store would hold after several unclaimed extraction cycles.
    const starvedMineral = requestOutput(target("mineralContainer", 8, 8), "Z" as ResourceConstant, 900);
    const starvedScore = scoreRequest(starvedMineral, distance);

    expect(starvedScore).toBeGreaterThan(energyScore);
  });

  it("pickBestRequest resolves the flip: a fresh creep facing both picks mineral once it's starved enough", () => {
    const energy = requestOutput(target("energyContainer", 5, 5), RESOURCE_ENERGY, 500);
    const freshMineral = requestOutput(target("mineralContainerFresh", 8, 8), "Z" as ResourceConstant, 1);
    const starvedMineral = requestOutput(target("mineralContainerStarved", 8, 8), "Z" as ResourceConstant, 900);

    // Fresh: energy still wins (routine availability beats a trivial, just-registered mineral trickle).
    expect(pickBestRequest([energy, freshMineral], RESOURCE_ENERGY, distanceTo)).toBe(energy);
    expect(pickBestRequest([energy, freshMineral], "Z" as ResourceConstant, distanceTo)).toBe(freshMineral);

    // Starved: pickBestRequest itself only ranks within one resource (see its own doc), matching a real
    // Transport pool where each resource is picked separately and then compared — so call it once per
    // resource against the FULL mixed candidate list (proving the resource filter itself, not just a
    // single-element array) and compare the two winners' scores, exactly the cross-resource "which one
    // wins the creep's next trip" call a real ranking pass would make.
    const mixedPool = [energy, starvedMineral];
    const bestEnergy = pickBestRequest(mixedPool, RESOURCE_ENERGY, distanceTo)!;
    const bestMineral = pickBestRequest(mixedPool, "Z" as ResourceConstant, distanceTo)!;
    expect(bestEnergy).toBe(energy);
    expect(bestMineral).toBe(starvedMineral);
    expect(scoreRequest(bestMineral, distance)).toBeGreaterThan(scoreRequest(bestEnergy, distance));
  });
});
