import { describe, expect, it } from "vitest";
import { runTransport } from "../../src/behaviors/transport";
import { stubGame } from "../helpers";

function transportCreep(over: {
  memory: CreepMemory;
  free?: number;
  used?: number;
  inRange?: boolean;
}): { creep: Creep; calls: { withdraw: number; pickup: number; transfer: number }; traveled: number } {
  const calls = { withdraw: 0, pickup: 0, transfer: 0 };
  let traveled = 0;
  const creep = {
    id: "transport1",
    memory: over.memory,
    store: {
      getFreeCapacity: () => over.free ?? 50,
      getUsedCapacity: () => over.used ?? 0
    },
    pos: {
      inRangeTo: () => over.inRange ?? true,
      findClosestByPath: (list: object[]) => list[0] ?? null
    },
    room: { find: () => [] },
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
    travelTo: () => {
      traveled++;
    }
  };
  return { creep: creep as unknown as Creep, calls, traveled };
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
