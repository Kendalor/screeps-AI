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
      findClosestByPath: (list: object[]) => list[0] ?? null
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
          current: { kind: "pickup", from: { kind: "structure", id: "cont1" as Id<AnyStoreStructure> }, resource: RESOURCE_ENERGY, amount: 50 },
          next: { kind: "deliver", to: { kind: "structure", id: "ext1" as Id<AnyStoreStructure> }, resource: RESOURCE_ENERGY, amount: 50 }
        }
      },
      free: 0 // already full — task is done
    });

    runTransport(creep);

    expect(creep.memory.logistics?.current).toEqual({ kind: "deliver", to: { kind: "structure", id: "ext1" }, resource: RESOURCE_ENERGY, amount: 50 });
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
