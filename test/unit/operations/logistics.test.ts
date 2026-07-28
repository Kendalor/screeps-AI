// Mirrors supply.test.ts's structure — the smallest existing operation test. Every case constructs the
// operation directly and hands it a snapshot: no Game mock, no Colony.

import { describe, expect, it } from "vitest";
import { Logistics } from "../../../src/operations/logistics";
import { colonySnap, containerAt, sinkAt, snapCreep, snapCreeps } from "../../fixtures";
import { bodyCost } from "../../../src/spawn/body";

const logistics = new Logistics("W1N1");

describe("Logistics.desiredCreeps", () => {
  // A fresh colony has no containers/drops and no spawn deficit — nothing for a transport creep to
  // do yet, so asking anyway would outrank upgrader for a spawn slot on work that doesn't exist.
  it("wants nothing when there is no provider or consumer work yet", () => {
    expect(logistics.desiredCreeps(colonySnap({}))).toEqual([]);
  });

  // A miner with live WORK parts is what makes wantedTransport's income-based sizing nonzero —
  // without one, harvestIncome is 0 and Logistics correctly asks for nothing (see the case above).
  const withWork = (over: Parameters<typeof colonySnap>[0] = {}) =>
    colonySnap({
      containers: [containerAt(10, 10, 300)],
      controller: { x: 25, y: 25 },
      energyAvailable: 200,
      energyCapacity: 300,
      creeps: [snapCreep("miner", { body: [WORK, WORK, WORK, WORK, WORK, MOVE] })],
      ...over
    });

  it("wants at least one transport creep once a provider and consumer both exist", () => {
    expect(logistics.desiredCreeps(withWork()).length).toBeGreaterThanOrEqual(1);
  });

  // Regression: the transport request must NOT vanish the moment the spawn fills to capacity. The
  // spawnSystem consumer's `wanted` is (capacity - available), which hits 0 at a full spawn; if that
  // was the only consumer, desiredCreeps returned [] exactly when there was finally energy to spawn
  // the transport — an oscillation where a lower-priority miner spawned instead, drained the spawn,
  // and the transport reappeared next tick. A live provider is enough demand on its own.
  it("still wants a transport creep when the spawn is full but a provider has energy", () => {
    const full = withWork({ energyAvailable: 300, energyCapacity: 300 });
    expect(logistics.desiredCreeps(full).length).toBeGreaterThanOrEqual(1);
  });

  // With no transport alive, the first one must be sized off base spawn capacity (300, always
  // affordable) rather than full energyCapacity — otherwise the room stalls waiting for extensions
  // to fill, which is the very job the transport exists to do. Capacity is 550 here (RCL2 + all
  // extensions), but nothing is alive to fill them, so the body must cost <= 300.
  it("sizes the first transport off base spawn capacity, not full energyCapacity", () => {
    const highCapNoneAlive = withWork({ energyAvailable: 300, energyCapacity: 550 });
    const [request] = highCapNoneAlive ? logistics.desiredCreeps(highCapNoneAlive) : [];
    expect(bodyCost(request.body)).toBeLessThanOrEqual(300);
  });

  // Once one transport is alive it can fill the extensions, so subsequent ones size off full capacity.
  // Two full-income miners plus a long haul warrant more than one transport, so a second request is
  // still emitted with one alive; its body must be sized off the 550 capacity, not the 300 bootstrap.
  it("sizes subsequent transports off full energyCapacity once one is alive", () => {
    const miner = snapCreep("miner", { body: [WORK, WORK, WORK, WORK, WORK, MOVE] });
    // A far anchor lengthens the haul enough that income warrants more than one transport, so a
    // second request is still emitted with one alive — and its body is sized off the 550 capacity.
    const oneAlive = withWork({
      energyAvailable: 550,
      energyCapacity: 550,
      anchor: { x: 49, y: 49 },
      creeps: [miner, ...snapCreeps("transport", 1)]
    });
    const [request] = logistics.desiredCreeps(oneAlive);
    expect(request).toBeDefined();
    expect(bodyCost(request.body)).toBeGreaterThan(300);
  });

  it("returns nothing once the live transport creeps meet the quota", () => {
    const miner = snapCreep("miner", { body: [WORK, WORK, WORK, WORK, WORK, MOVE] });
    expect(logistics.desiredCreeps(withWork({ creeps: [miner, ...snapCreeps("transport", 6)] }))).toEqual([]);
  });

  it("stamps its own op name on every request", () => {
    const [request] = logistics.desiredCreeps(withWork());
    expect(request.memory).toMatchObject({ role: "transport", home: "W1N1", op: "logistics:W1N1" });
  });

  // The regression this guards: an earlier version staggered transport's priority against live
  // miner/transport counts to avoid miners monopolising every spawn slot, but the two operations'
  // live-count reads didn't line up closely enough in practice — miners kept winning regardless.
  // Fixed with a flat top-tier priority (100, same as bootstrap/supply) instead: since
  // desiredCreeps only ever returns a request once there's real provider/consumer work, a flat top
  // priority can't fire before the first miner has produced anything, but always wins once it does.
  it("ranks above any number of live miners once there is real work to do", () => {
    const sixMiners = Array.from({ length: 6 }, () => snapCreep("miner", { body: [WORK, WORK, WORK, WORK, WORK, MOVE] }));
    const [request] = logistics.desiredCreeps(withWork({ creeps: sixMiners }));

    expect(request.priority).toBe(100);
  });
});

describe("Logistics.intents", () => {
  it("emits an assignLogisticsTask intent for an idle transport creep with work available", () => {
    const creep = snapCreeps("transport", 1, { storeEnergy: 0, storeCapacity: 100 })[0];
    const container = containerAt(10, 10, 300);
    const intents = logistics.intents(
      colonySnap({
        creeps: [creep],
        containers: [container],
        controller: { x: 25, y: 25 },
        spawnSinks: [sinkAt(20, 20, 0, 100, "spawn1")], // open sink so allocate has a consumer to assign to
        energyAvailable: 200,
        energyCapacity: 300
      })
    );

    expect(intents).toEqual([
      expect.objectContaining({ kind: "assignLogisticsTask", creep: creep.id })
    ]);
  });

  it("emits nothing when there are no idle transport creeps or no work", () => {
    expect(logistics.intents(colonySnap({}))).toEqual([]);
  });
});
