// Unit-proves the any-resource ground pickup extension to transportRegister.ts's
// registerGroundResources/registerRemoteGroundResources: a tombstone/ruin holding several resource types
// is gated on its TILE TOTAL (not any single resource's own amount), yet still emits one LogisticsRequest
// per resource type present, matching the withdraw Task's single-resource shape (see that module's own
// doc on groundRequestsFor). Follows the same "fake the live-object shape" stub pattern as
// stewardRegister.test.ts/register.test.ts.

import { describe, expect, it } from "vitest";
import {
  DROP_WORTHWHILE_FLOOR,
  registerBoostCompoundSourceRequests,
  registerBoostLabEnergyWantRequest,
  registerBoostLabWantRequest,
  registerGroundResources,
  registerRemoteGroundResources,
  type BoostLabClaim
} from "../../../src/logistics/transportRegister";

const CATALYST: ResourceConstant = "XGH2O";

function pos(x: number, y: number, roomName = "W1N1"): RoomPosition {
  return { x, y, roomName } as unknown as RoomPosition;
}

// Object.keys(store) is what storedResources() iterates — build a plain object whose OWN keys are exactly
// the resource types present, with getUsedCapacity/getFreeCapacity methods attached (mirrors a real Store,
// which is itself a plain object of resource->amount plus those methods).
function realisticStore(amounts: Partial<Record<ResourceConstant, number>>): Store<ResourceConstant, false> {
  const store = { ...amounts } as Record<string, unknown>;
  store.getUsedCapacity = (r: ResourceConstant) => amounts[r] ?? 0;
  store.getFreeCapacity = () => 0;
  return store as unknown as Store<ResourceConstant, false>;
}

function tombstoneWith(id: string, amounts: Partial<Record<ResourceConstant, number>>): Tombstone {
  return { id: id as Id<Tombstone>, pos: pos(10, 10), store: realisticStore(amounts) } as unknown as Tombstone;
}

function ruinWith(id: string, amounts: Partial<Record<ResourceConstant, number>>): Ruin {
  return { id: id as Id<Ruin>, pos: pos(12, 12), store: realisticStore(amounts) } as unknown as Ruin;
}

function droppedResource(id: string, resourceType: ResourceConstant, amount: number): Resource {
  return { id: id as Id<Resource>, pos: pos(8, 8), resourceType, amount } as unknown as Resource;
}

function stubRoom(objects: { drops?: Resource[]; tombstones?: Tombstone[]; ruins?: Ruin[] }): Room {
  return {
    name: "W1N1",
    find: (findConstant: FindConstant) => {
      if (findConstant === FIND_DROPPED_RESOURCES) return objects.drops ?? [];
      if (findConstant === FIND_TOMBSTONES) return objects.tombstones ?? [];
      if (findConstant === FIND_RUINS) return objects.ruins ?? [];
      if (findConstant === FIND_STRUCTURES) return [];
      return [];
    }
  } as unknown as Room;
}

describe("registerGroundResources: any-resource tile-total gate", () => {
  it("registers a tombstone whose total across resources clears the floor even though no single resource does alone", () => {
    // 10 energy + 45 catalyst = 55 total, clears DROP_WORTHWHILE_FLOOR (50); neither line item alone does.
    const tombstone = tombstoneWith("tomb1", { [RESOURCE_ENERGY]: 10, [CATALYST]: 45 });
    const room = stubRoom({ tombstones: [tombstone] });

    const requests = registerGroundResources(room);

    expect(requests).toHaveLength(2);
    const byResource = Object.fromEntries(requests.map(r => [r.resource, r.amount]));
    expect(byResource[RESOURCE_ENERGY]).toBe(-10);
    expect(byResource[CATALYST]).toBe(-45);
  });

  it("skips a tombstone whose total across all resources is still below the floor", () => {
    const tombstone = tombstoneWith("tomb2", { [RESOURCE_ENERGY]: 10, [CATALYST]: 5 });
    const room = stubRoom({ tombstones: [tombstone] });

    expect(registerGroundResources(room)).toHaveLength(0);
  });

  it("registers a ruin the same way, one request per resource type present", () => {
    const ruin = ruinWith("ruin1", { [RESOURCE_ENERGY]: 20, [CATALYST]: 40 });
    const room = stubRoom({ ruins: [ruin] });

    const requests = registerGroundResources(room);

    expect(requests).toHaveLength(2);
    expect(requests.every(r => r.target === ruin)).toBe(true);
  });

  it("registers a dropped pile of a non-energy resource (single resourceType, gated on its own amount)", () => {
    const pile = droppedResource("pile1", CATALYST, DROP_WORTHWHILE_FLOOR);
    const room = stubRoom({ drops: [pile] });

    const requests = registerGroundResources(room);

    expect(requests).toEqual([expect.objectContaining({ resource: CATALYST, amount: -DROP_WORTHWHILE_FLOOR })]);
  });

  it("skips a dropped pile below the floor", () => {
    const pile = droppedResource("pile2", CATALYST, DROP_WORTHWHILE_FLOOR - 1);
    const room = stubRoom({ drops: [pile] });

    expect(registerGroundResources(room)).toHaveLength(0);
  });
});

describe("registerRemoteGroundResources: any-resource tile-total gate applies to remote rooms too", () => {
  it("picks up a remote tombstone's multi-resource total the same way as a home-room one", () => {
    const tombstone = tombstoneWith("remoteTomb1", { [RESOURCE_ENERGY]: 15, [CATALYST]: 40 });
    const room = stubRoom({ tombstones: [tombstone] });

    const requests = registerRemoteGroundResources([room]);

    expect(requests).toHaveLength(2);
  });
});

// registerBoostLabWantRequest (gh #61 epic): a boost lab's own want-request, now registered into
// Transport's pool instead of Steward's (see stewardRegister.ts's registerStewardRequests doc for why —
// confirmed live via integration testing that Steward's fixed single-anchor-tile design can never reach a
// boost lab elsewhere in the bunker). A minimal lab stub controls getUsedCapacity/getFreeCapacity directly
// per test case rather than reimplementing the real engine's single-mineral-type store semantics — each
// test states the exact values that semantics would produce in that scenario (see the "different compound"
// case's own comment for the real-engine reasoning behind its expected numbers).
function labStub(id: string, used: Partial<Record<ResourceConstant, number>>, freeCapacity: Partial<Record<ResourceConstant, number | null>>): StructureLab {
  return {
    id: id as Id<StructureLab>,
    pos: pos(20, 20),
    store: {
      getUsedCapacity: (r: ResourceConstant) => used[r] ?? 0,
      getFreeCapacity: (r: ResourceConstant) => freeCapacity[r] ?? null
    }
  } as unknown as StructureLab;
}

describe("registerBoostLabWantRequest", () => {
  it("returns undefined when the lab is undefined", () => {
    expect(registerBoostLabWantRequest(undefined, { compound: "GO", amount: 1000 })).toBeUndefined();
  });

  it("returns undefined when the claim is undefined", () => {
    const lab = labStub("lab1", {}, { GO: 3000 });
    expect(registerBoostLabWantRequest(lab, undefined)).toBeUndefined();
  });

  it("returns undefined once the lab already holds the full claimed amount", () => {
    const lab = labStub("lab2", { GO: 1000 }, { GO: 2000 });
    const claim: BoostLabClaim = { compound: "GO", amount: 1000 };
    expect(registerBoostLabWantRequest(lab, claim)).toBeUndefined();
  });

  it("returns undefined when the lab holds MORE than the claimed amount (over-stocked, nothing more wanted)", () => {
    const lab = labStub("lab3", { GO: 1200 }, { GO: 1800 });
    const claim: BoostLabClaim = { compound: "GO", amount: 1000 };
    expect(registerBoostLabWantRequest(lab, claim)).toBeUndefined();
  });

  it("wants exactly the shortfall when the lab has plenty of free capacity to receive it", () => {
    const lab = labStub("lab4", { GO: 300 }, { GO: 2700 });
    const claim: BoostLabClaim = { compound: "GO", amount: 1000 };
    const request = registerBoostLabWantRequest(lab, claim);
    expect(request).toEqual(expect.objectContaining({ target: lab, resource: "GO", amount: 700 }));
  });

  it("uses a deliberately high multiplier so an active boost claim outranks Transport's routine traffic regardless of when it happens to arrive (confirmed live: at the default multiplier, a compound that arrived into an already-running economy sat undelivered for 1000+ ticks, while the identical delivery seeded fresh into an idle colony from tick 0 completed in under 20 — the default multiplier was never reliable, just accidentally fast in the idle-from-tick-0 case)", () => {
    const lab = labStub("lab11", {}, { GO: 1000 });
    const claim: BoostLabClaim = { compound: "GO", amount: 1000 };
    const request = registerBoostLabWantRequest(lab, claim);
    expect(request?.multiplier).toBeGreaterThan(1);
  });

  it("caps the want at the lab's own free capacity when the shortfall would exceed it (double-cap, same shape as registerMineralStorageWantRequest)", () => {
    // Claimed amount (1000) minus used (0) = a 1000 shortfall, but the lab can only physically receive 500
    // more right now — the request must be capped at 500, not the full shortfall.
    const lab = labStub("lab5", { GO: 0 }, { GO: 500 });
    const claim: BoostLabClaim = { compound: "GO", amount: 1000 };
    const request = registerBoostLabWantRequest(lab, claim);
    expect(request).toEqual(expect.objectContaining({ target: lab, resource: "GO", amount: 500 }));
  });

  it("emits nothing while the lab is still committed to a DIFFERENT compound from an earlier claim", () => {
    // Per the real engine's single-mineral-type store (@screeps/engine's utils.capacityForResource): a lab
    // currently holding UH reports getFreeCapacity("GO") as 0 (not the lab's raw mineral capacity) until
    // it's actually emptied of UH — this test states that real behavior directly rather than re-deriving it.
    const lab = labStub("lab6", { UH: 900 }, { UH: 2100, GO: 0 });
    const claim: BoostLabClaim = { compound: "GO", amount: 1000 };
    expect(registerBoostLabWantRequest(lab, claim)).toBeUndefined();
  });
});

// registerBoostLabEnergyWantRequest: boostCreep() consumes BOTH the compound (registerBoostLabWantRequest's
// concern) AND LAB_BOOST_ENERGY per part — confirmed live via integration testing that a lab correctly
// stocked with its claimed compound still failed boostCreep() with ERR_NOT_ENOUGH_RESOURCES every tick,
// since nothing had ever requested energy for it (see this function's own doc for the real engine trace).
describe("registerBoostLabEnergyWantRequest", () => {
  it("returns undefined when the lab is undefined", () => {
    expect(registerBoostLabEnergyWantRequest(undefined)).toBeUndefined();
  });

  it("wants the lab's full free energy capacity even with no active claim — pre-staged ahead of demand", () => {
    const lab = labStub("lab7", {}, { energy: 2000 });
    const request = registerBoostLabEnergyWantRequest(lab);
    expect(request).toEqual(expect.objectContaining({ target: lab, resource: RESOURCE_ENERGY, amount: 2000 }));
  });

  it("wants the lab's full free energy capacity when not yet topped up", () => {
    const lab = labStub("lab8", { energy: 500 }, { energy: 1500 });
    const request = registerBoostLabEnergyWantRequest(lab);
    expect(request).toEqual(expect.objectContaining({ target: lab, resource: RESOURCE_ENERGY, amount: 1500 }));
  });

  it("uses a deliberately high multiplier so this small want can outscore storage's own much larger routine energy want (confirmed live: at the default multiplier, storage's want always won pickBestPair's race and the lab sat at 0 energy for 400+ ticks)", () => {
    const lab = labStub("lab10", {}, { energy: 2000 });
    const request = registerBoostLabEnergyWantRequest(lab);
    expect(request?.multiplier).toBeGreaterThan(1);
    // storage's own free capacity can run into the hundreds of thousands (STORAGE_CAPACITY = 1,000,000) —
    // the multiplier must be large enough that a fully-drained storage's amount still can't win against
    // this lab's tiny 2,000-unit ask at equal distance.
    expect(request!.multiplier * request!.amount).toBeGreaterThan(1_000_000);
  });

  it("returns undefined once the lab's energy is already full", () => {
    const lab = labStub("lab9", { energy: 2000 }, { energy: 0 });
    expect(registerBoostLabEnergyWantRequest(lab)).toBeUndefined();
  });
});

// registerBoostCompoundSourceRequests: the paired OUTPUT half a boost lab's want-request needs to ever
// actually match in Transport's pool (greedyMatch.ts's pickBestPair requires a real opposite-signed
// candidate — see that module's own header). Confirmed live via integration testing this was the missing
// piece even after moving the WANT itself into Transport's pool: storage sitting at/above its own
// BOOST_TARGETS empire target had no route to a lab at all, since Transport's existing
// registerStorageSinkRequests is sink-only and Steward's registerMineralStorageSurplusRequest (the only
// other thing that ever offered storage's mineral stock as output) is Steward-only and gated on
// LIQUIDATION_MODE/above-target surplus, neither of which this function depends on.
function storeStub(amounts: Partial<Record<ResourceConstant, number>>): { getUsedCapacity(r: ResourceConstant): number } {
  return { getUsedCapacity: (r: ResourceConstant) => amounts[r] ?? 0 };
}

describe("registerBoostCompoundSourceRequests", () => {
  it("returns nothing when there are no active claims", () => {
    const storage = { id: "storage1" as Id<StructureStorage>, pos: pos(5, 5), store: storeStub({ GO: 5000 }) } as unknown as StructureStorage;
    expect(registerBoostCompoundSourceRequests(storage, undefined, [])).toHaveLength(0);
  });

  it("caps the offered amount to the real remaining shortfall, not storage's full stock", () => {
    const storage = { id: "storage1" as Id<StructureStorage>, pos: pos(5, 5), store: storeStub({ GO: 5000, H: 3000 }) } as unknown as StructureStorage;
    const shortfalls: BoostLabClaim[] = [{ compound: "GO", amount: 1000 }];

    const requests = registerBoostCompoundSourceRequests(storage, undefined, shortfalls);

    // Only the CLAIMED compound (GO) is offered — H sitting in storage is irrelevant to this claim and
    // must not be exposed just because storage happens to hold some. The offered amount is capped to the
    // 1000-unit shortfall, not storage's much larger 5000 stock — see this function's own doc for why an
    // uncapped offer let a Transport creep's withdraw carry away far more than any order needed.
    expect(requests).toEqual([expect.objectContaining({ target: storage, resource: "GO", amount: -1000 })]);
  });

  it("uses a deliberately high multiplier on the OUTPUT side too — pickBestPair's cross-resource race is scored off the output, so this is what actually decides whether an idle Transport creep picks up a boost delivery over the colony's routine traffic (see BOOST_URGENCY_MULTIPLIER's own doc for the confirmed live failure this fixes)", () => {
    const storage = { id: "storage1" as Id<StructureStorage>, pos: pos(5, 5), store: storeStub({ GO: 5000 }) } as unknown as StructureStorage;
    const claims: BoostLabClaim[] = [{ compound: "GO", amount: 1000 }];

    const requests = registerBoostCompoundSourceRequests(storage, undefined, claims);

    expect(requests[0]?.multiplier).toBeGreaterThan(1);
  });

  it("offers BOTH storage's and terminal's stock of the same claimed compound, as two separate requests, each independently capped to the shortfall", () => {
    const storage = { id: "storage1" as Id<StructureStorage>, pos: pos(5, 5), store: storeStub({ GO: 2000 }) } as unknown as StructureStorage;
    const terminal = { id: "terminal1" as Id<StructureTerminal>, pos: pos(6, 6), store: storeStub({ GO: 500 }) } as unknown as StructureTerminal;
    const shortfalls: BoostLabClaim[] = [{ compound: "GO", amount: 1000 }];

    const requests = registerBoostCompoundSourceRequests(storage, terminal, shortfalls);

    expect(requests).toHaveLength(2);
    expect(requests).toEqual(
      expect.arrayContaining([
        // Storage holds 2000 but only 1000 is actually needed — capped down.
        expect.objectContaining({ target: storage, resource: "GO", amount: -1000 }),
        // Terminal's 500 is already below the shortfall — offered in full, unchanged.
        expect.objectContaining({ target: terminal, resource: "GO", amount: -500 })
      ])
    );
  });

  it("skips a structure holding none of the claimed compound", () => {
    const storage = { id: "storage1" as Id<StructureStorage>, pos: pos(5, 5), store: storeStub({ GO: 0 }) } as unknown as StructureStorage;
    const claims: BoostLabClaim[] = [{ compound: "GO", amount: 1000 }];

    expect(registerBoostCompoundSourceRequests(storage, undefined, claims)).toHaveLength(0);
  });

  it("dedupes two labs claiming the same compound into ONE pair of source requests, summing (not just capping to) their shortfalls", () => {
    const storage = { id: "storage1" as Id<StructureStorage>, pos: pos(5, 5), store: storeStub({ GO: 4000 }) } as unknown as StructureStorage;
    const claims: BoostLabClaim[] = [
      { compound: "GO", amount: 500 },
      { compound: "GO", amount: 300 }
    ];

    const requests = registerBoostCompoundSourceRequests(storage, undefined, claims);
    expect(requests).toHaveLength(1);
    // Capped to the SUM of both labs' shortfalls (800), not storage's full 4000 stock and not just one
    // lab's individual 500/300 figure.
    expect(requests[0]).toEqual(expect.objectContaining({ amount: -800 }));
  });

  it("returns nothing at all when neither storage nor terminal is given", () => {
    const claims: BoostLabClaim[] = [{ compound: "GO", amount: 1000 }];
    expect(registerBoostCompoundSourceRequests(undefined, undefined, claims)).toHaveLength(0);
  });
});
