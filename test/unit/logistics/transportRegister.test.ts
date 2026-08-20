// Unit-proves the any-resource ground pickup extension to transportRegister.ts's
// registerGroundResources/registerRemoteGroundResources: a tombstone/ruin holding several resource types
// is gated on its TILE TOTAL (not any single resource's own amount), yet still emits one LogisticsRequest
// per resource type present, matching the withdraw Task's single-resource shape (see that module's own
// doc on groundRequestsFor). Follows the same "fake the live-object shape" stub pattern as
// stewardRegister.test.ts/register.test.ts.

import { describe, expect, it } from "vitest";
import { DROP_WORTHWHILE_FLOOR, registerGroundResources, registerRemoteGroundResources } from "../../../src/logistics/transportRegister";

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
