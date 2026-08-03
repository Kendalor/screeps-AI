import { describe, expect, it } from "vitest";
import { runTransport } from "../../src/behaviors/transport";
import { stubGame } from "../helpers";

function transportCreep(over: {
  memory: CreepMemory;
  free?: number;
  used?: number;
  inRange?: boolean;
  name?: string;
  pos?: { x: number; y: number };
  /** Candidate objects (each needs a `pos: {x,y}`) findInRange filters by real range, keyed by FIND_* constant. */
  nearby?: Partial<Record<number, { pos: { x: number; y: number } }[]>>;
}): {
  creep: Creep;
  calls: { withdraw: number; pickup: number; transfer: number };
  traveled: number;
  travelTargets: { x: number; y: number }[];
} {
  const calls = { withdraw: 0, pickup: 0, transfer: 0 };
  let traveled = 0;
  const travelTargets: { x: number; y: number }[] = [];
  const creep = {
    id: "transport1",
    name: over.name ?? "transport1",
    memory: over.memory,
    store: {
      getFreeCapacity: () => over.free ?? 50,
      getUsedCapacity: () => over.used ?? 0
    },
    pos: {
      x: over.pos?.x ?? 25,
      y: over.pos?.y ?? 25,
      inRangeTo: () => over.inRange ?? true,
      getRangeTo: (x: number, y: number) => Math.max(Math.abs((over.pos?.x ?? 25) - x), Math.abs((over.pos?.y ?? 25) - y)),
      findClosestByPath: (list: object[]) => list[0] ?? null,
      findInRange: (type: number, range: number) =>
        (over.nearby?.[type] ?? []).filter(
          o => Math.max(Math.abs((over.pos?.x ?? 25) - o.pos.x), Math.abs((over.pos?.y ?? 25) - o.pos.y)) <= range
        )
    },
    room: { name: over.memory.home, find: () => [] },
    withdraw: () => {
      calls.withdraw++;
      return OK;
    },
    pickup: () => {
      calls.pickup++;
      return OK;
    },
    transfer: () => {
      calls.transfer++;
      return OK;
    },
    travelTo: (t: { x: number; y: number }) => {
      traveled++;
      travelTargets.push({ x: t.x, y: t.y });
    }
  };
  return { creep: creep as unknown as Creep, calls, traveled, travelTargets };
}

describe("runTransport", () => {
  it("does nothing when there is no current task", () => {
    const { creep, calls, traveled } = transportCreep({ memory: { role: "transport", home: "W1N1" } });
    runTransport(creep);
    expect(calls).toEqual({ withdraw: 0, pickup: 0, transfer: 0 });
    expect(traveled).toBe(0);
  });

  it("withdraws from a resolved structure on a pickup task", () => {
    const container = { id: "cont1", pos: { x: 5, y: 5 }, structureType: STRUCTURE_CONTAINER, store: {} };
    stubGame({ objects: { cont1: container } });
    const { creep, calls } = transportCreep({
      memory: {
        role: "transport",
        home: "W1N1",
        logistics: { current: { kind: "pickup", from: { kind: "structure", id: "cont1" as Id<AnyStoreStructure> }, resource: RESOURCE_ENERGY, amount: 50 } }
      },
      free: 50
    });

    runTransport(creep);

    expect(calls.withdraw).toBe(1);
  });

  it("picks up a dropped resource on a pickup task, not withdraw", () => {
    const drop = { id: "drop1", pos: { x: 5, y: 5 }, resourceType: RESOURCE_ENERGY, amount: 100 };
    stubGame({ objects: { drop1: drop } });
    const { creep, calls } = transportCreep({
      memory: {
        role: "transport",
        home: "W1N1",
        logistics: { current: { kind: "pickup", from: { kind: "dropped", id: "drop1" as Id<Resource> }, resource: RESOURCE_ENERGY, amount: 100 } }
      },
      free: 50
    });

    runTransport(creep);

    expect(calls.pickup).toBe(1);
    expect(calls.withdraw).toBe(0);
  });

  it("transfers to a resolved structure on a deliver task", () => {
    const ext = { id: "ext1", pos: { x: 5, y: 5 }, structureType: STRUCTURE_EXTENSION, store: {} };
    stubGame({ objects: { ext1: ext } });
    const { creep, calls } = transportCreep({
      memory: {
        role: "transport",
        home: "W1N1",
        logistics: { current: { kind: "deliver", to: { kind: "structure", id: "ext1" as Id<AnyStoreStructure> }, resource: RESOURCE_ENERGY, amount: 50 } }
      },
      used: 50,
      free: 0
    });

    runTransport(creep);

    expect(calls.transfer).toBe(1);
  });

  it("clears the current task and promotes next once a pickup fills the creep", () => {
    const { creep } = transportCreep({
      memory: {
        role: "transport",
        home: "W1N1",
        logistics: {
          current: {
            kind: "pickup",
            from: { kind: "structure", id: "cont1" as Id<AnyStoreStructure> },
            resource: RESOURCE_ENERGY,
            amount: 50,
            next: { kind: "deliver", to: { kind: "structure", id: "ext1" as Id<AnyStoreStructure> }, resource: RESOURCE_ENERGY, amount: 50 }
          }
        }
      },
      free: 0 // already full — task is done
    });

    runTransport(creep);

    expect(creep.memory.logistics?.current).toEqual({ kind: "deliver", to: { kind: "structure", id: "ext1" }, resource: RESOURCE_ENERGY, amount: 50 });
  });

  it("advances to the next pickup once a provider is drained, even with free capacity left", () => {
    // A partial provider (100 left) into a creep with room for 200: the withdraw fires but the creep
    // is still half-empty. The pickup must still complete — the provider is spent — so the creep flows
    // to the chained second pickup rather than re-withdrawing from the now-empty container forever.
    const cont = { id: "cont1", pos: { x: 5, y: 5 }, structureType: STRUCTURE_CONTAINER, store: { getUsedCapacity: () => 0 } };
    stubGame({ objects: { cont1: cont } });
    const { creep, calls } = transportCreep({
      memory: {
        role: "transport",
        home: "W1N1",
        logistics: {
          current: {
            kind: "pickup",
            from: { kind: "structure", id: "cont1" as Id<AnyStoreStructure> },
            resource: RESOURCE_ENERGY,
            amount: 100,
            next: { kind: "pickup", from: { kind: "structure", id: "cont2" as Id<AnyStoreStructure> }, resource: RESOURCE_ENERGY, amount: 100, next: { kind: "deliver", to: { kind: "spawnSystem" }, resource: RESOURCE_ENERGY, amount: 200 } }
          }
        }
      },
      free: 100, // still room after the withdraw — but the provider is now empty
      inRange: true
    });

    runTransport(creep);

    expect(calls.withdraw).toBe(1); // it did withdraw this tick
    expect(creep.memory.logistics?.current).toMatchObject({ kind: "pickup", from: { kind: "structure", id: "cont2" } });
  });

  it("tops off from a nearby container in a remote room instead of advancing to travelHome-bound idle", () => {
    // The scenario: transport was sent to pick up a dropped pile, but another (non-logistics) creep
    // grabbed most of it first, leaving only scraps. A container one tile away still has energy.
    // Rather than going idle with a near-empty load (which allocate.ts would then send straight home),
    // it should splice in a live top-off pickup for the nearby container.
    const drop = { id: "drop1", pos: { x: 5, y: 5 }, resourceType: RESOURCE_ENERGY, amount: 0 };
    const container = {
      id: "cont1",
      pos: { x: 5, y: 5 },
      structureType: STRUCTURE_CONTAINER,
      store: { getUsedCapacity: () => 500 }
    };
    stubGame({ objects: { drop1: drop, cont1: container }, roomLinearDistance: () => 1 });
    const { creep, calls } = transportCreep({
      memory: {
        role: "transport",
        home: "W1N1",
        logistics: {
          current: { kind: "pickup", from: { kind: "dropped", id: "drop1" as Id<Resource> }, resource: RESOURCE_ENERGY, amount: 100 }
        }
      },
      free: 620, // 650 - 30 already carried; still lots of room
      inRange: true,
      pos: { x: 5, y: 5 },
      nearby: { [FIND_STRUCTURES]: [container] }
    });
    (creep.room as unknown as { name: string }).name = "W2N1"; // remote room, not home

    runTransport(creep);

    expect(calls.pickup).toBe(1); // withdrew/picked up the original drop (now empty)
    expect(creep.memory.logistics?.current).toMatchObject({ kind: "pickup", from: { kind: "structure", id: "cont1" } });
  });

  it("does not top off inside the home room — lets normal idle re-planning handle it", () => {
    const drop = { id: "drop1", pos: { x: 5, y: 5 }, resourceType: RESOURCE_ENERGY, amount: 0 };
    const container = { id: "cont1", pos: { x: 5, y: 5 }, structureType: STRUCTURE_CONTAINER, store: { getUsedCapacity: () => 500 } };
    stubGame({ objects: { drop1: drop, cont1: container } });
    const { creep, calls } = transportCreep({
      memory: {
        role: "transport",
        home: "W1N1",
        logistics: { current: { kind: "pickup", from: { kind: "dropped", id: "drop1" as Id<Resource> }, resource: RESOURCE_ENERGY, amount: 100 } }
      },
      free: 620,
      inRange: true,
      pos: { x: 5, y: 5 },
      nearby: { [FIND_STRUCTURES]: [container] }
    });
    // room defaults to memory.home (W1N1) — already home

    runTransport(creep);

    expect(calls.pickup).toBe(1);
    expect(creep.memory.logistics?.current).toBeUndefined(); // released to idle, not auto-chained
  });

  it("does NOT top off from a container 3 tiles away one room out (detour budget too small there)", () => {
    // 1 room from home: topoffRange = min(5, 1 + 1*2) = 3. A container 4 tiles away exceeds that budget,
    // so no candidate qualifies and the creep is released to travelHome planning instead of detouring.
    const drop = { id: "drop1", pos: { x: 5, y: 5 }, resourceType: RESOURCE_ENERGY, amount: 0 };
    const farContainer = { id: "cont1", pos: { x: 9, y: 5 }, structureType: STRUCTURE_CONTAINER, store: { getUsedCapacity: () => 500 } };
    stubGame({ objects: { drop1: drop, cont1: farContainer }, roomLinearDistance: () => 1 });
    const { creep, calls } = transportCreep({
      memory: {
        role: "transport",
        home: "W1N1",
        logistics: { current: { kind: "pickup", from: { kind: "dropped", id: "drop1" as Id<Resource> }, resource: RESOURCE_ENERGY, amount: 100 } }
      },
      free: 620,
      inRange: true,
      pos: { x: 5, y: 5 },
      nearby: { [FIND_STRUCTURES]: [farContainer] } // 4 tiles from (5,5), beyond a range-3 budget
    });
    (creep.room as unknown as { name: string }).name = "W2N1"; // 1 room from home

    runTransport(creep);

    expect(calls.pickup).toBe(1);
    expect(creep.memory.logistics?.current).toBeUndefined(); // too far for this trip's detour budget
  });

  it("widens the topoff detour range on a longer remote trip", () => {
    // 2 rooms from home: topoffRange = min(5, 1 + 2*2) = 5, wide enough to reach the same container that
    // a 1-room trip's range-3 budget (previous test) couldn't.
    const drop = { id: "drop1", pos: { x: 5, y: 5 }, resourceType: RESOURCE_ENERGY, amount: 0 };
    const farContainer = { id: "cont1", pos: { x: 9, y: 5 }, structureType: STRUCTURE_CONTAINER, store: { getUsedCapacity: () => 500 } };
    stubGame({ objects: { drop1: drop, cont1: farContainer }, roomLinearDistance: () => 2 });
    const { creep, calls } = transportCreep({
      memory: {
        role: "transport",
        home: "W1N1",
        logistics: { current: { kind: "pickup", from: { kind: "dropped", id: "drop1" as Id<Resource> }, resource: RESOURCE_ENERGY, amount: 100 } }
      },
      free: 620,
      inRange: true,
      pos: { x: 5, y: 5 },
      nearby: { [FIND_STRUCTURES]: [farContainer] } // 4 tiles away, within a range-5 budget
    });
    (creep.room as unknown as { name: string }).name = "W3N1"; // 2 rooms from home

    runTransport(creep);

    expect(calls.pickup).toBe(1);
    expect(creep.memory.logistics?.current).toMatchObject({ kind: "pickup", from: { kind: "structure", id: "cont1" } });
  });

  it("does NOT advance a pickup that is still filling a provider that still has energy", () => {
    // The provider still holds energy and the creep still has room: keep pulling from it next tick.
    const cont = { id: "cont1", pos: { x: 5, y: 5 }, structureType: STRUCTURE_CONTAINER, store: { getUsedCapacity: () => 500 } };
    stubGame({ objects: { cont1: cont } });
    const { creep } = transportCreep({
      memory: {
        role: "transport",
        home: "W1N1",
        logistics: { current: { kind: "pickup", from: { kind: "structure", id: "cont1" as Id<AnyStoreStructure> }, resource: RESOURCE_ENERGY, amount: 200 } }
      },
      free: 100, // still room, provider not empty
      inRange: true
    });

    runTransport(creep);

    expect(creep.memory.logistics?.current).toMatchObject({ kind: "pickup", from: { kind: "structure", id: "cont1" } });
  });

  it("clears the current task and promotes next once a deliver empties the creep", () => {
    const { creep } = transportCreep({
      memory: {
        role: "transport",
        home: "W1N1",
        logistics: {
          current: { kind: "deliver", to: { kind: "structure", id: "ext1" as Id<AnyStoreStructure> }, resource: RESOURCE_ENERGY, amount: 50 }
        }
      },
      used: 0 // already empty — task is done
    });

    runTransport(creep);

    expect(creep.memory.logistics?.current).toBeUndefined();
  });

  it("completes a deliver the tick its transfer executes in range, even while still loaded", () => {
    // A builder consumer with little free capacity: the transfer succeeds (in range) but the creep is
    // still carrying energy. The task must complete so the still-loaded creep is released back to
    // reallocation next tick instead of babysitting the builder.
    const builder = { id: "builder1", pos: { x: 5, y: 5 }, store: {} };
    stubGame({ objects: { builder1: builder } });
    const { creep, calls } = transportCreep({
      memory: {
        role: "transport",
        home: "W1N1",
        logistics: { current: { kind: "deliver", to: { kind: "creep", id: "builder1" as Id<Creep> }, resource: RESOURCE_ENERGY, amount: 50 } }
      },
      used: 48, // still loaded after the transfer
      free: 2,
      inRange: true
    });

    runTransport(creep);

    expect(calls.transfer).toBe(1);
    expect(creep.memory.logistics?.current).toBeUndefined(); // released, not stuck on the builder
  });

  it("advances a deliver whose target is already full on arrival, without babysitting it", () => {
    // ext1 filled up between planning and now: skip to the next queued deliver, don't travel/transfer.
    const ext1 = { id: "ext1", pos: { x: 5, y: 5 }, structureType: STRUCTURE_EXTENSION, store: { getFreeCapacity: () => 0 } };
    stubGame({ objects: { ext1 } });
    const { creep, calls } = transportCreep({
      memory: {
        role: "transport",
        home: "W1N1",
        logistics: {
          current: {
            kind: "deliver",
            to: { kind: "structure", id: "ext1" as Id<AnyStoreStructure> },
            resource: RESOURCE_ENERGY,
            amount: 50,
            next: { kind: "deliver", to: { kind: "structure", id: "ext2" as Id<AnyStoreStructure> }, resource: RESOURCE_ENERGY, amount: 50 }
          }
        }
      },
      used: 100,
      free: 0,
      inRange: false // even out of range, a full target must not be traveled to
    });

    runTransport(creep);

    expect(calls.transfer).toBe(0);
    expect(creep.memory.logistics?.current).toMatchObject({ kind: "deliver", to: { kind: "structure", id: "ext2" } });
  });

  it("flows deliver->deliver: after filling one sink in range it promotes the next deliver", () => {
    const ext1 = { id: "ext1", pos: { x: 5, y: 5 }, structureType: STRUCTURE_EXTENSION, store: { getFreeCapacity: () => 50 } };
    stubGame({ objects: { ext1 } });
    const { creep, calls } = transportCreep({
      memory: {
        role: "transport",
        home: "W1N1",
        logistics: {
          current: {
            kind: "deliver",
            to: { kind: "structure", id: "ext1" as Id<AnyStoreStructure> },
            resource: RESOURCE_ENERGY,
            amount: 50,
            next: { kind: "deliver", to: { kind: "structure", id: "ext2" as Id<AnyStoreStructure> }, resource: RESOURCE_ENERGY, amount: 50 }
          }
        }
      },
      used: 100,
      free: 0,
      inRange: true
    });

    runTransport(creep);

    expect(calls.transfer).toBe(1);
    expect(creep.memory.logistics?.current).toMatchObject({ kind: "deliver", to: { kind: "structure", id: "ext2" } });
  });

  it("does NOT complete a deliver when out of range (it travels, task stays)", () => {
    const ext = { id: "ext1", pos: { x: 45, y: 45 }, structureType: STRUCTURE_EXTENSION, store: {} };
    stubGame({ objects: { ext1: ext } });
    const { creep, travelTargets } = transportCreep({
      memory: {
        role: "transport",
        home: "W1N1",
        logistics: { current: { kind: "deliver", to: { kind: "structure", id: "ext1" as Id<AnyStoreStructure> }, resource: RESOURCE_ENERGY, amount: 50 } }
      },
      used: 50,
      free: 0,
      inRange: false
    });

    runTransport(creep);

    expect(travelTargets).toHaveLength(1);
    expect(creep.memory.logistics?.current).toEqual({ kind: "deliver", to: { kind: "structure", id: "ext1" }, resource: RESOURCE_ENERGY, amount: 50 });
  });

  it("drops a task whose target has vanished rather than retrying it forever", () => {
    stubGame({ objects: {} }); // resolves to nothing
    const { creep, calls } = transportCreep({
      memory: {
        role: "transport",
        home: "W1N1",
        logistics: { current: { kind: "pickup", from: { kind: "structure", id: "gone" as Id<AnyStoreStructure> }, resource: RESOURCE_ENERGY, amount: 50 } }
      },
      free: 50
    });

    runTransport(creep);

    expect(calls).toEqual({ withdraw: 0, pickup: 0, transfer: 0 });
    expect(creep.memory.logistics?.current).toBeUndefined();
  });

  it("parks near the bunker anchor when it has no task and an anchor is known", () => {
    stubGame({});
    (Memory as unknown as { colonies: Record<string, { anchor: { x: number; y: number } }> }).colonies = {
      W1N1: { anchor: { x: 20, y: 20 } }
    };
    const { creep, travelTargets } = transportCreep({
      memory: { role: "transport", home: "W1N1" },
      pos: { x: 40, y: 40 } // far from the anchor
    });

    runTransport(creep);

    expect(travelTargets).toHaveLength(1);
    // Parks within a few tiles of the anchor (a spread-out spot, not exactly on it).
    const [target] = travelTargets;
    expect(Math.max(Math.abs(target.x - 20), Math.abs(target.y - 20))).toBeLessThanOrEqual(3);
  });

  it("does not move when already parked near the anchor with no task", () => {
    stubGame({});
    (Memory as unknown as { colonies: Record<string, { anchor: { x: number; y: number } }> }).colonies = {
      W1N1: { anchor: { x: 20, y: 20 } }
    };
    const { creep, travelTargets } = transportCreep({
      memory: { role: "transport", home: "W1N1" },
      pos: { x: 21, y: 20 } // already adjacent to the anchor
    });

    runTransport(creep);

    expect(travelTargets).toHaveLength(0);
  });

  it("does nothing (no crash) when idle and no anchor is known yet", () => {
    stubGame({});
    (Memory as unknown as { colonies: Record<string, unknown> }).colonies = {};
    const { creep, travelTargets } = transportCreep({ memory: { role: "transport", home: "W1N1" } });
    runTransport(creep);
    expect(travelTargets).toHaveLength(0);
  });

  describe("travelHome task", () => {
    it("travels toward the home room without acting when still outside it", () => {
      stubGame({});
      (Memory as unknown as { colonies: Record<string, { anchor: { x: number; y: number } }> }).colonies = {
        W1N1: { anchor: { x: 20, y: 20 } }
      };
      const { creep, calls, travelTargets } = transportCreep({
        memory: {
          role: "transport",
          home: "W1N1",
          logistics: { current: { kind: "travelHome", resource: RESOURCE_ENERGY, amount: 80 } }
        },
        used: 80,
        free: 0
      });
      (creep.room as unknown as { name: string }).name = "W2N1"; // still away from home

      runTransport(creep);

      expect(travelTargets).toEqual([{ x: 20, y: 20 }]);
      expect(calls).toEqual({ withdraw: 0, pickup: 0, transfer: 0 });
      expect(creep.memory.logistics?.current).toMatchObject({ kind: "travelHome" }); // task stays until arrival
    });

    it("falls back to the room center when no bunker anchor is known yet", () => {
      stubGame({});
      (Memory as unknown as { colonies: Record<string, unknown> }).colonies = {};
      const { creep, travelTargets } = transportCreep({
        memory: {
          role: "transport",
          home: "W1N1",
          logistics: { current: { kind: "travelHome", resource: RESOURCE_ENERGY, amount: 80 } }
        },
        used: 80,
        free: 0
      });
      (creep.room as unknown as { name: string }).name = "W2N1";

      runTransport(creep);

      expect(travelTargets).toEqual([{ x: 25, y: 25 }]);
    });

    it("completes and clears the task once the creep is back in its home room", () => {
      stubGame({});
      (Memory as unknown as { colonies: Record<string, unknown> }).colonies = {};
      const { creep, travelTargets } = transportCreep({
        memory: {
          role: "transport",
          home: "W1N1",
          logistics: { current: { kind: "travelHome", resource: RESOURCE_ENERGY, amount: 80 } }
        },
        used: 80,
        free: 0
      }); // room defaults to memory.home (W1N1) — already arrived

      runTransport(creep);

      expect(travelTargets).toHaveLength(0);
      expect(creep.memory.logistics?.current).toBeUndefined();
    });
  });

  it("resolves a spawnSystem ref to the nearest structure that can still take energy", () => {
    const ext = { id: "ext1", pos: { x: 5, y: 5 }, structureType: STRUCTURE_EXTENSION, store: { getFreeCapacity: () => 50 } };
    stubGame({});
    const { creep, calls } = transportCreep({
      memory: {
        role: "transport",
        home: "W1N1",
        logistics: { current: { kind: "deliver", to: { kind: "spawnSystem" }, resource: RESOURCE_ENERGY, amount: 50 } }
      },
      used: 50,
      free: 0
    });
    (creep.room.find as unknown as () => object[]) = () => [ext];

    runTransport(creep);

    expect(calls.transfer).toBe(1);
  });
});
