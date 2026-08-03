// Mirrors supply.test.ts's structure — the smallest existing operation test. Every case constructs the
// operation directly and hands it a snapshot: no Game mock, no Colony.

import { describe, expect, it } from "vitest";
import { Logistics } from "../../../src/operations/logistics";
import GOAL_JSON from "../../../src/layouts/Base_2.json";
import type { GoalLayout } from "../../../src/layouts/sync";
import { colonySnap, containerAt, linkAt, sinkAt, snapCreep, snapCreeps } from "../../fixtures";
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

  // Regression: transport hitting 0 alive isn't proof of a cold start — the sole transport in a
  // mature room can die of old age without a queued handoff. A live supply creep means the room's
  // economy is already established (supply only spawns past its own energy minimum, RCL3+), so the
  // replacement must size off full capacity even though transport's own live count is 0 — otherwise
  // the room is stuck forever with a 300-energy transport whose small body throughput headcount math
  // (which assumes a capacity-sized body) then reports as sufficient on its own.
  it("sizes the transport off full energyCapacity when none is alive but supply is", () => {
    // op stamped as the real Supply operation would (operations/supply.ts) — NOT left undefined,
    // since a real live supply creep is never op-less and this.owned() would wrongly reject it as
    // belonging to a different operation if the check used owned() instead of a plain role scan.
    const supplyCreep = snapCreep("supply", { memory: { role: "supply", home: "W1N1", op: "supply:W1N1" } });
    const supplyAliveNoTransport = withWork({
      energyAvailable: 550,
      energyCapacity: 550,
      creeps: [snapCreep("miner", { body: [WORK, WORK, WORK, WORK, WORK, MOVE] }), supplyCreep]
    });
    const [request] = logistics.desiredCreeps(supplyAliveNoTransport);
    expect(request).toBeDefined();
    expect(bodyCost(request.body)).toBeGreaterThan(300);
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

describe("Logistics.desiredCreeps steward", () => {
  const withStorage = (over: Parameters<typeof colonySnap>[0] = {}) =>
    colonySnap({
      storageId: "storage1" as Id<StructureStorage>,
      storageEnergy: 1000,
      storageCapacity: 10000,
      energyCapacity: 550,
      controllerLevel: 5,
      links: [linkAt(10, 10), linkAt(20, 20)],
      ...over
    });

  it("wants no steward before storage exists", () => {
    const noStorage = colonySnap({ energyCapacity: 550 });
    expect(noStorage.storageId).toBeUndefined();
    expect(logistics.desiredCreeps(noStorage).some(r => r.memory.role === "steward")).toBe(false);
  });

  // Regression: a steward has nothing to referee before RCL5/2 links exist even if storage is already
  // built (storage lands at RCL4, a full level ahead of links) — asking anyway wastes a spawn slot on
  // a creep that just parks and idles.
  it("wants no steward before RCL5, even with storage", () => {
    const belowRcl5 = withStorage({ controllerLevel: 4 });
    expect(logistics.desiredCreeps(belowRcl5).some(r => r.memory.role === "steward")).toBe(false);
  });

  it("wants no steward with only one link built", () => {
    const oneLink = withStorage({ links: [linkAt(10, 10)] });
    expect(logistics.desiredCreeps(oneLink).some(r => r.memory.role === "steward")).toBe(false);
  });

  it("wants exactly one steward once storage exists at RCL5 with 2 links", () => {
    const requests = logistics.desiredCreeps(withStorage());
    expect(requests.filter(r => r.memory.role === "steward")).toHaveLength(1);
  });

  it("stops asking once a steward is already alive", () => {
    const requests = logistics.desiredCreeps(withStorage({ creeps: [snapCreep("steward")] }));
    expect(requests.some(r => r.memory.role === "steward")).toBe(false);
  });

  it("stamps its own op name on the steward request", () => {
    const [request] = logistics.desiredCreeps(withStorage()).filter(r => r.memory.role === "steward");
    expect(request.memory).toMatchObject({ role: "steward", home: "W1N1", op: "logistics:W1N1" });
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

describe("Logistics.intents anchor link recording", () => {
  const anchor = { x: 25, y: 25 };
  const linkPlacement = (GOAL_JSON as GoalLayout).placements.find(p => p.type === "link")!;
  const anchorLinkPos = { x: linkPlacement.x + anchor.x, y: linkPlacement.y + anchor.y };

  it("records the built link sitting at the goal layout's anchor-link offset", () => {
    const link = linkAt(anchorLinkPos.x, anchorLinkPos.y, 0);
    const intents = logistics.intents(colonySnap({ anchor, links: [link] }));

    expect(intents).toContainEqual({ kind: "recordLinkNetwork", room: "W1N1", storage: link.id });
  });

  it("does not record anything before a link is built at that spot", () => {
    const intents = logistics.intents(colonySnap({ anchor, links: [] }));
    expect(intents.some(i => i.kind === "recordLinkNetwork")).toBe(false);
  });

  it("does not re-record once the anchor link is already known", () => {
    const link = linkAt(anchorLinkPos.x, anchorLinkPos.y, 0);
    const intents = logistics.intents(
      colonySnap({ anchor, links: [link], linkNetwork: { storage: link.id } })
    );
    expect(intents.some(i => i.kind === "recordLinkNetwork")).toBe(false);
  });

  it("ignores a link built somewhere other than the anchor-link offset", () => {
    const elsewhere = linkAt(anchorLinkPos.x + 10, anchorLinkPos.y, 0);
    const intents = logistics.intents(colonySnap({ anchor, links: [elsewhere] }));
    expect(intents.some(i => i.kind === "recordLinkNetwork")).toBe(false);
  });
});
