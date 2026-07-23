// The spawn arbiter — an Empire capability. It gathers every colony's requests, sorts by priority,
// and routes each to a spawn. The single-colony budget/livelock/take-once cases are ported from
// systems/spawning.test.ts; the cross-colony routing cases are new (that capability did not exist
// when the arbiter was per-colony).

import { describe, expect, it } from "vitest";
import { bodyCost } from "../../../src/behaviors/body";
import { planSpawning } from "../../../src/empire/spawning";
import type { Intent } from "../../../src/intents/types";
import { desiredBootstrapCount } from "../../../src/colony/requests";
import { colonySnap, containerAt, roomDistance, snapCreep, snapCreeps, sourceAt, spawn, testEmpire } from "../../fixtures";

// The arbiter takes colonies + a room-distance function. Every ported single-colony case wraps one
// colony snapshot into an empire and reads back its colonies.
const arbitrate = (over: Parameters<typeof colonySnap>[0]) => planSpawning(testEmpire(colonySnap(over)).colonies, roomDistance);

describe("spawn arbiter — single colony", () => {
  it("emits a spawn intent for the highest-priority request", () => {
    expect(arbitrate({ spawns: [spawn()], energyAvailable: 300, sources: [sourceAt(20, 10)] })).toEqual([
      {
        kind: "spawn",
        spawn: "spawn1",
        body: [WORK, CARRY, MOVE, MOVE],
        memory: { home: "W1N1", role: "bootstrap", op: "recovery:W1N1" }
      }
    ]);
  });

  it("emits nothing when every requester is satisfied", () => {
    const source = sourceAt(20, 10, "source_20_10", 1);
    expect(
      arbitrate({
        spawns: [spawn()],
        sources: [source],
        creeps: [
          ...snapCreeps("bootstrap", desiredBootstrapCount(colonySnap({ sources: [source] }))),
          ...snapCreeps("hauler", 1),
          snapCreep("miner", { memory: { sourceId: source.id } })
        ]
      })
    ).toEqual([]);
  });

  it("does not spawn from a busy spawn", () => {
    expect(arbitrate({ spawns: [spawn("spawn1", true)], sources: [sourceAt(20, 10)] })).toEqual([]);
  });

  // The trap: "for each spawn, find the best request" hands the same top-priority request to every
  // idle spawn, spawning it N times in one tick.
  it("consumes a request at most once per tick", () => {
    expect(
      arbitrate({
        spawns: [spawn("spawn1"), spawn("spawn2")],
        sources: [],
        energyAvailable: 1000,
        energyCapacity: 1000,
        storageEnergy: 50_000
      })
    ).toHaveLength(1);
  });

  it("gives N idle spawns N distinct requests, in priority order", () => {
    const intents = arbitrate({
      spawns: [spawn("spawn1"), spawn("spawn2")],
      sources: [sourceAt(20, 10)],
      energyAvailable: 2000,
      energyCapacity: 300
    });

    expect(intents).toHaveLength(2);
    expect(intents.map(i => i.kind === "spawn" && i.spawn)).toEqual(["spawn1", "spawn2"]);
    expect(intents.map(i => i.kind === "spawn" && i.memory.op)).toEqual(["recovery:W1N1", "bootstrap:W1N1"]);
  });

  it("deducts each spawn from a running energy budget", () => {
    const intents = arbitrate({
      spawns: [spawn("spawn1"), spawn("spawn2")],
      sources: [sourceAt(20, 10)],
      energyAvailable: 300,
      energyCapacity: 300
    });

    expect(intents).toHaveLength(1);
    expect(bodyCost((intents[0] as Extract<Intent, { kind: "spawn" }>).body)).toBeLessThanOrEqual(300);
  });

  it("waits for a refill rather than spawning a runt sized to a drained room", () => {
    expect(
      arbitrate({
        creeps: snapCreeps("bootstrap", 1),
        spawns: [spawn()],
        energyAvailable: 400,
        energyCapacity: 800,
        sources: [sourceAt(20, 10)]
      })
    ).toEqual([]);
  });

  // Filling with affordable creeps first would consume the colony's energy on cheap ones forever, so
  // the expensive high-priority request never becomes affordable. A livelock, not an inversion.
  it("stops on an unaffordable request instead of skipping to a cheaper one", () => {
    expect(
      arbitrate({
        creeps: [...snapCreeps("bootstrap", 1), ...snapCreeps("miner", 1)],
        spawns: [spawn()],
        energyAvailable: 200,
        energyCapacity: 800,
        controllerLevel: 2,
        sources: [sourceAt(20, 10)],
        containers: [containerAt(10, 10, 500)]
      })
    ).toEqual([]);
  });

  it("does not block a lower-priority request an unaffordable recovery request cannot pay for", () => {
    // Recovery sizes down to affordability and stands aside when it still cannot pay, rather than
    // stopping the arbiter on request zero.
    expect(
      arbitrate({
        spawns: [spawn()],
        energyAvailable: 100,
        energyCapacity: 300,
        sources: [sourceAt(20, 10)],
        storageEnergy: 50_000
      })
    ).toEqual([]);
  });
});

describe("spawn arbiter — cross-colony routing", () => {
  // A colony with demand but no idle spawn borrows the nearest colony that has one.
  it("routes a request to the nearest spawn-capable colony when its own cannot spawn", () => {
    const needer = colonySnap({
      name: "W1N1",
      spawns: [spawn("busy", true)],
      energyAvailable: 300,
      sources: [sourceAt(20, 10)]
    });
    const far = spareColony("W9N9", "farSpawn");
    const near = spareColony("W2N1", "nearSpawn");

    const intents = planSpawning(testEmpire(needer, far, near).colonies, roomDistance);

    // W1N1's own recovery request (top priority) goes to W2N1, the nearer of the two spawn-capable colonies.
    const first = intents.find(i => i.kind === "spawn" && i.memory.home === "W1N1");
    expect(first && first.kind === "spawn" && first.spawn).toBe("nearSpawn");
  });

  it("honours an explicit spawnRoom over the nearest-to-target search", () => {
    // Build the request stream by hand — no requester pins spawnRoom yet, so this tests the arbiter
    // mechanism directly.
    const a = spareColony("W1N1", "aSpawn");
    const b = spareColony("W2N1", "bSpawn");
    const empire = testEmpire(a, b);
    // Splice a pinned request onto colony A's stream.
    empire.colonies[0].requests = () => [
      {
        body: [WORK, CARRY, MOVE],
        priority: 500,
        memory: { role: "upgrader", home: "W1N1", op: "test:W1N1" },
        targetRoom: "W1N1",
        spawnRoom: "W2N1"
      }
    ];

    const intents = planSpawning(empire.colonies, roomDistance);
    const pinned = intents.find(i => i.kind === "spawn" && i.memory.op === "test:W1N1");
    expect(pinned && pinned.kind === "spawn" && pinned.spawn).toBe("bSpawn");
  });

  it("keeps each colony's energy budget separate", () => {
    // Two colonies, each with one 300-energy spawn and one recovery request costing ~300. Both spawn
    // — a shared budget would let only one through.
    const a = colonySnap({ name: "W1N1", spawns: [spawn("aSpawn")], energyAvailable: 300, sources: [sourceAt(20, 10)] });
    const b = colonySnap({ name: "W2N1", spawns: [spawn("bSpawn")], energyAvailable: 300, sources: [sourceAt(20, 10)] });

    const intents = planSpawning(testEmpire(a, b).colonies, roomDistance);
    const spawnsUsed = intents.filter(i => i.kind === "spawn").map(i => (i as Extract<Intent, { kind: "spawn" }>).spawn);
    expect(new Set(spawnsUsed)).toEqual(new Set(["aSpawn", "bSpawn"]));
  });
});

// A colony with a free spawn and no demand of its own, so its capacity is available to a neighbour:
// no sources (no miner/bootstrap demand), one live creep (suppresses recovery), no construction.
function spareColony(name: string, spawnId: string) {
  return colonySnap({
    name,
    spawns: [spawn(spawnId)],
    energyAvailable: 1000,
    energyCapacity: 1000,
    sources: [],
    creeps: snapCreeps("upgrader", 1)
  });
}
