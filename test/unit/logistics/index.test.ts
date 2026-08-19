// planLogistics is thin (wires graph + allocate + reserved-folding), so one integration-style case per
// behavior is enough — the interesting logic already has its own unit tests in graph/allocate.
// allocate() now runs distance queries via real PathFinder.search (see lib/pathing.ts's header), so
// every case here needs stubPathFinderSingleRoom() — same as allocate.test.ts.
//
// gh #52 cutover: planLogistics now plans Supply's fleet ONLY — Transport is driven live by
// behaviors/transportTaskRunner.ts against the new LogisticsRequest system instead (see logistics/index.ts's
// header). The "planLogistics" describe block that used to prove transport assignment through this
// function (pickup/deliver chains, mid-task reservation folding for transport creeps) is removed — that
// behavior no longer exists here; graph.ts/allocate.ts's own unit tests still cover the underlying
// provider/consumer/allocate machinery, which Supply's path below still exercises for real.

import { beforeEach, describe, expect, it } from "vitest";
import { planLogistics } from "../../../src/logistics";
import { colonySnap, containerAt, remoteEnergyAt, sinkAt, snapCreep } from "../../fixtures";
import { clearTiles, stubPathFinderSingleRoom } from "../../constants";

beforeEach(() => {
  clearTiles();
  stubPathFinderSingleRoom();
});

// Supply is the only fleet planLogistics plans as of gh #52 (see this file's header) — transport creeps
// appearing in a few of these fixtures are deliberate bystanders, proving Supply's plan doesn't touch
// them, not that Transport itself gets planned here.
describe("planLogistics — supply", () => {
  it("assigns an idle supply creep from storage to a spawn/extension deficit", () => {
    const storageId = "storage1" as Id<StructureStorage>;
    const creep = snapCreep("supply", { storeEnergy: 0, storeCapacity: 100 });
    const plan = planLogistics(
      colonySnap({
        creeps: [creep],
        storageId,
        storageEnergy: 5000,
        storageCapacity: 10000,
        spawnSinks: [sinkAt(20, 20, 0, 100, "spawn1")],
        energyAvailable: 200,
        energyCapacity: 300
      })
    );

    expect(plan.assignments[creep.id]).toMatchObject({ kind: "pickup", from: { kind: "structure", id: storageId } });
  });

  it("never sends a supply creep at a remote-room provider", () => {
    const creep = snapCreep("supply", { storeEnergy: 0, storeCapacity: 100 });
    const remote = remoteEnergyAt("W2N1", 500, "dropped");
    const plan = planLogistics(
      colonySnap({
        creeps: [creep],
        remoteEnergy: [remote],
        spawnSinks: [sinkAt(20, 20, 0, 100, "spawn1")],
        energyAvailable: 200,
        energyCapacity: 300
      })
    );

    const task = plan.assignments[creep.id];
    expect(task?.from).not.toEqual({ kind: "dropped", id: remote.id });
  });

  it("never delivers to the controller container, even below its fill floor", () => {
    const container = containerAt(25, 26, 300); // within range 1 of the controller, below its 0.7 floor
    const creep = snapCreep("supply", { storeEnergy: 50, storeCapacity: 100 });
    const plan = planLogistics(
      colonySnap({
        creeps: [creep],
        containers: [container],
        controller: { x: 25, y: 25 },
        energyAvailable: 300,
        energyCapacity: 300
      })
    );

    const task = plan.assignments[creep.id];
    // Nothing supply is allowed to deliver to exists here (no spawn/tower deficit) — it must not fall
    // back to the controller container the way transport would.
    if (task) {
      let deliver = task.kind === "deliver" ? task : task.next;
      while (deliver && deliver.kind !== "deliver") deliver = deliver.next;
      expect(deliver?.to).not.toEqual({ kind: "structure", id: container.id });
    }
  });

  it("reserves a spawn sink supply just claimed so a transport creep is not sent at it too", () => {
    const storageId = "storage1" as Id<StructureStorage>;
    const supplyCreep = snapCreep("supply", { storeEnergy: 0, storeCapacity: 50 });
    const transportCreep = snapCreep("transport", { storeEnergy: 0, storeCapacity: 50 });
    const plan = planLogistics(
      colonySnap({
        creeps: [supplyCreep, transportCreep],
        storageId,
        storageEnergy: 5000,
        storageCapacity: 10000,
        // Exactly 50 wanted — enough for only one creep's trip.
        spawnSinks: [sinkAt(20, 20, 50, 100, "spawn1")],
        energyAvailable: 50,
        energyCapacity: 100
      })
    );

    const supplyTask = plan.assignments[supplyCreep.id];
    const transportTask = plan.assignments[transportCreep.id];
    expect(supplyTask).toBeDefined();
    // transport must not also be sent at spawn1 — either it gets no task, or a task that doesn't
    // deliver to the same, now-fully-reserved sink.
    if (transportTask) {
      let deliver = transportTask.kind === "deliver" ? transportTask : transportTask.next;
      while (deliver && deliver.kind !== "deliver") deliver = deliver.next;
      expect(deliver?.to).not.toEqual({ kind: "structure", id: "spawn1" });
    }
  });

  it("leaves a spawn deficit supply can't reach this tick for transport to skip too, while storage backs supply", () => {
    // The one supply creep is already mid-trip elsewhere (busy, not idle), so it reserves nothing this
    // tick and spawn1's full deficit is left uncovered. Transport must still leave spawn1 alone — supply
    // owns spawn/extensions outright whenever it's alive AND storage has energy to draw from (it's
    // trusted to keep up because it can always pull from storage on its next trip).
    const container = containerAt(10, 10, 300);
    const busySupply = snapCreep("supply", {
      memory: { logistics: { current: { kind: "pickup", from: { kind: "structure", id: "storage1" as Id<AnyStoreStructure> }, resource: RESOURCE_ENERGY, amount: 50 } } }
    });
    const idleTransport = snapCreep("transport", { storeEnergy: 0, storeCapacity: 100 });
    const plan = planLogistics(
      colonySnap({
        creeps: [busySupply, idleTransport],
        containers: [container],
        controller: { x: 25, y: 25 },
        spawnSinks: [sinkAt(20, 20, 0, 100, "spawn1")],
        storageId: "storage1" as Id<StructureStorage>,
        storageEnergy: 5000,
        storageCapacity: 10000,
        energyAvailable: 200,
        energyCapacity: 300
      })
    );

    const transportTask = plan.assignments[idleTransport.id];
    if (transportTask) {
      let deliver = transportTask.kind === "deliver" ? transportTask : transportTask.next;
      while (deliver && deliver.kind !== "deliver") deliver = deliver.next;
      expect(deliver?.to).not.toEqual({ kind: "structure", id: "spawn1" });
    }
  });

  // gh #52 cutover: planLogistics no longer plans transport at all (see this file's header), so the old
  // "transport falls back to filling spawn1 when supply can't keep up" safety net (graph.ts's
  // spawnTiersOwnedBySupply low-priority fallback) no longer applies through THIS function — spawn/
  // extension/tower is exclusively Supply's pool now, with no Transport-side fallback here. Transport's
  // new rate-ranked pool (transportRegister.ts) never registers spawn/extension/tower requests at all,
  // by design (the PRD's pool-topology decision), so an idle transport creep simply gets nothing from
  // planLogistics regardless of whether supply can currently reach the deficit.
  it("leaves spawn1 alone even when supply is alive but storage is empty — transport is never planned here", () => {
    const busySupply = snapCreep("supply", {
      memory: { logistics: { current: { kind: "pickup", from: { kind: "structure", id: "storage1" as Id<AnyStoreStructure> }, resource: RESOURCE_ENERGY, amount: 50 } } }
    });
    const idleTransport = snapCreep("transport", { storeEnergy: 100, storeCapacity: 100 });
    const plan = planLogistics(
      colonySnap({
        creeps: [busySupply, idleTransport],
        controller: { x: 25, y: 25 },
        spawnSinks: [sinkAt(20, 20, 0, 100, "spawn1")],
        energyAvailable: 200,
        energyCapacity: 300
      })
    );

    expect(plan.assignments[idleTransport.id]).toBeUndefined();
  });
});
