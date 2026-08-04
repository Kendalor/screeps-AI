// The spawn arbiter — an Empire capability. It gathers every colony's requests, sorts by priority,
// and routes each to a spawn. The single-colony budget/livelock/take-once cases are ported from
// systems/spawning.test.ts; the cross-colony routing cases are new (that capability did not exist
// when the arbiter was per-colony).

import { describe, expect, it } from "vitest";
import { bodyCost } from "../../../src/spawn/body";
import { planSpawning } from "../../../src/empire/spawning";
import type { Intent } from "../../../src/intents/types";
import { colonySnap, containerAt, dropAt, roomDistance, snapCreep, snapCreeps, sourceAt, spawn, testEmpire } from "../../fixtures";

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
    // A single-tile source seats exactly one miner; that 1-WORK miner's output warrants one hauler.
    // No container energy or drops, so no pre-storage upgraders; no construction, so no builders.
    // A live supply creep satisfies supply's own RCL1-and-up quota of 1.
    const source = sourceAt(20, 10, "source_20_10", 1);
    expect(
      arbitrate({
        spawns: [spawn()],
        sources: [source],
        creeps: [
          snapCreep("miner", { memory: { sourceId: source.id, op: "mining:W1N1" } }),
          ...snapCreeps("hauler", 1, { memory: { op: "mining:W1N1" } }),
          ...snapCreeps("supply", 1)
        ]
      })
    ).toEqual([]);
  });

  // Regression: an RCL1 colony (300 capacity) with the economy staffed and energy on the ground wants
  // a dedicated upgrader, but the upgrader body was sized to a fixed 350-cost base — more than a
  // 300-capacity room can ever hold. The arbiter *silently skips* a body costing more than the room's
  // full capacity (it can never afford it, so it never waits either), so the upgrader sat at 0/N with
  // the spawn idle and full, forever. The body must degrade to something the room can pay for; the
  // arbiter must then actually emit the spawn.
  it("spawns a dedicated upgrader at the RCL1 floor rather than silently skipping an unaffordable body", () => {
    const source = sourceAt(20, 10, "source_20_10", 1);
    const intents = arbitrate({
      spawns: [spawn()],
      energyAvailable: 300,
      energyCapacity: 300,
      controllerLevel: 1,
      sources: [source],
      // Economy (and supply, priority 100) staffed so upgrading is the only outstanding demand.
      creeps: [
        snapCreep("miner", { memory: { sourceId: source.id, op: "mining:W1N1" } }),
        ...snapCreeps("hauler", 1, { memory: { op: "mining:W1N1" } }),
        ...snapCreeps("supply", 1)
      ],
      // Energy in the controller container (a logistics *consumer*, not a provider) gives the upgrader
      // something to draw from without also creating a transport provider — a ground drop would, and
      // transport (priority 100) would then take the single spawn slot ahead of the upgrader (60),
      // which is correct behaviour but a different scenario than this body-affordability regression.
      containers: [containerAt(25, 25, 200)]
    });

    expect(intents).toHaveLength(1);
    const spawnIntent = intents[0] as Extract<Intent, { kind: "spawn" }>;
    expect(spawnIntent.memory.role).toBe("upgrader");
    expect(bodyCost(spawnIntent.body)).toBeLessThanOrEqual(300);
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
    // With no creeps alive, recovery (1000) leads; the next request is a miner (95) — the economy
    // roles lead now that the bootstrap workforce is gone.
    expect(intents.map(i => i.kind === "spawn" && i.memory.op)).toEqual(["recovery:W1N1", "mining:W1N1"]);
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
        // A live supply creep satisfies supply's own quota (wanted from RCL1 on) so it doesn't take
        // the spawn slot ahead of the refill-wait behaviour this test targets.
        creeps: [...snapCreeps("bootstrap", 1), ...snapCreeps("supply", 1)],
        spawns: [spawn()],
        energyAvailable: 300,
        energyCapacity: 500,
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

  // The bug: after a wipe recovers, the room's energy sits between the (capacity-sized) miner body
  // cost and the cheaper upgrader body. Skipping the unaffordable miner to spawn the affordable
  // upgrader inverts priority — the very report that motivated this. The colony must stop, not skip.
  it("does not spawn a cheaper lower-priority creep when a higher-priority one is unaffordable", () => {
    const source = sourceAt(20, 10);
    const intents = arbitrate({
      // One miner alive so recovery is silent; a source container makes the miner body capacity-sized
      // (5 WORK + MOVE = 550) and the hauler 500, while the upgrader base is only 350 — so 350 energy
      // buys the upgrader but neither of the higher-priority economy creeps.
      creeps: snapCreeps("miner", 1),
      spawns: [spawn()],
      energyAvailable: 350,
      energyCapacity: 550,
      controllerLevel: 3,
      sources: [source],
      containers: [containerAt(source.x + 1, source.y, 500)],
      // Standing energy so the upgrader quota is non-zero — the cheaper request that must NOT jump ahead.
      drops: [dropAt(25, 25, 500)],
      constructionProgress: 0
    });

    // Either nothing spawns (the colony stopped on the unaffordable miner) or a miner spawns — never
    // an upgrader ahead of the miner.
    const spawned = intents.filter(i => i.kind === "spawn") as Extract<Intent, { kind: "spawn" }>[];
    expect(spawned.every(i => i.memory.role !== "upgrader")).toBe(true);
  });

  // The counterpart to the stop rule: a body the room can never pay for — cost above its full
  // energyCapacity, not merely above what is available now — is skipped, not stopped, because
  // waiting for a refill that can never reach it would freeze the colony's cheaper work forever.
  it("skips a request whose body exceeds energy capacity and spawns the affordable one behind it", () => {
    const empire = testEmpire(
      colonySnap({ name: "W1N1", spawns: [spawn()], energyAvailable: 300, energyCapacity: 300, sources: [] })
    );
    // Two hand-built requests: an impossible one (600 > capacity 300) at top priority, and a cheap
    // affordable one behind it. No requester emits an over-capacity body, so this drives the arbiter directly.
    empire.colonies[0].requests = () => [
      {
        body: [WORK, WORK, WORK, WORK, WORK, WORK], // 600, over the 300 cap
        priority: 500,
        memory: { role: "upgrader", home: "W1N1", op: "toobig:W1N1" },
        targetRoom: "W1N1"
      },
      {
        body: [WORK, CARRY, MOVE], // 200, affordable
        priority: 100,
        memory: { role: "builder", home: "W1N1", op: "cheap:W1N1" },
        targetRoom: "W1N1"
      }
    ];

    const intents = planSpawning(empire.colonies, roomDistance);
    const ops = intents.filter(i => i.kind === "spawn").map(i => (i as Extract<Intent, { kind: "spawn" }>).memory.op);
    // The impossible request is skipped; the cheap one behind it still spawns.
    expect(ops).toEqual(["cheap:W1N1"]);
  });

  // Real-operation regression (not hand-built requests): a colony with simultaneous miner, upgrader
  // and transport demand must spawn transport first, and never let a cheaper miner/upgrader leapfrog
  // it just because transport's body happens to cost more. Exercises Mining + Upgrading + Logistics
  // together through the actual Colony/operationsFor() pipeline, since desiredCreeps() unit tests for
  // each operation in isolation can't catch a cross-operation priority inversion.
  it("spawns transport ahead of a competing miner/upgrader deficit when it can afford its body", () => {
    const miner = snapCreep("miner", { body: [WORK, WORK, MOVE, MOVE], memory: { sourceId: "s0" as Id<Source> } });
    const upgrader = snapCreep("upgrader", { body: [WORK, CARRY, MOVE, MOVE] });

    const intents = arbitrate({
      name: "W8N3",
      spawns: [spawn()],
      energyAvailable: 550,
      energyCapacity: 550,
      controllerLevel: 3,
      sources: [sourceAt(20, 10, "s0", 3), sourceAt(20, 12, "s1", 3)],
      creeps: [miner, upgrader],
      drops: [dropAt(33, 21, 500), dropAt(33, 20, 400)],
      containers: [containerAt(21, 10, 300)],
      anchor: { x: 25, y: 15 }
    });

    expect(intents).toHaveLength(1);
    const spawned = intents[0] as Extract<Intent, { kind: "spawn" }>;
    expect(spawned.memory.role).toBe("transport");
  });

  // The counterpart: when transport can't yet afford its body, the arbiter must stop the colony
  // (per the "stops on an unaffordable request" rule above) rather than let the cheaper miner or
  // upgrader deficit spawn instead — that would be exactly the priority inversion this covers.
  it("does not let miner or upgrader spawn ahead of an unaffordable transport request", () => {
    const miner = snapCreep("miner", { body: [WORK, WORK, MOVE, MOVE], memory: { sourceId: "s0" as Id<Source> } });
    const upgrader = snapCreep("upgrader", { body: [WORK, CARRY, MOVE, MOVE] });

    const intents = arbitrate({
      name: "W8N3",
      spawns: [spawn()],
      energyAvailable: 250, // transport's body (500) is unaffordable, but within capacity (550)
      energyCapacity: 550,
      controllerLevel: 3,
      sources: [sourceAt(20, 10, "s0", 3), sourceAt(20, 12, "s1", 3)],
      creeps: [miner, upgrader],
      drops: [dropAt(33, 21, 500), dropAt(33, 20, 400)],
      containers: [containerAt(21, 10, 300)],
      anchor: { x: 25, y: 15 }
    });

    const spawned = intents.filter(i => i.kind === "spawn") as Extract<Intent, { kind: "spawn" }>[];
    expect(spawned.every(i => i.memory.role !== "miner" && i.memory.role !== "upgrader")).toBe(true);
  });

  it("does not block a lower-priority request an unaffordable recovery request cannot pay for", () => {
    // Recovery sizes down to affordability and stands aside when it still cannot pay, rather than
    // stopping the arbiter on request zero. The cheapest possible supply body is one [CARRY, MOVE]
    // set (100 energy), so energyAvailable must fall below that floor to stay unaffordable.
    expect(
      arbitrate({
        spawns: [spawn()],
        energyAvailable: 50,
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

  it("stamps memory.targetRoom on a creep spawned for a room other than where it spawns", () => {
    // A remote miner: home W1N1 requests it for the remote room W2N1, and W1N1's own spawn serves it.
    const a = colonySnap({ name: "W1N1", spawns: [spawn("aSpawn")], energyAvailable: 1000, sources: [], creeps: snapCreeps("miner", 1) });
    const empire = testEmpire(a);
    empire.colonies[0].requests = () => [
      { body: [WORK, MOVE], priority: 90, memory: { role: "miner", home: "W1N1", op: "mining:W1N1" }, targetRoom: "W2N1" }
    ];

    const intents = planSpawning(empire.colonies, roomDistance);
    const spawned = intents.find(i => i.kind === "spawn");
    expect(spawned && spawned.kind === "spawn" && spawned.memory.targetRoom).toBe("W2N1");
  });

  it("leaves memory.targetRoom unset for a creep spawned in its own target room", () => {
    const a = colonySnap({ name: "W1N1", spawns: [spawn("aSpawn")], energyAvailable: 1000, sources: [], creeps: snapCreeps("miner", 1) });
    const empire = testEmpire(a);
    empire.colonies[0].requests = () => [
      { body: [WORK, MOVE], priority: 90, memory: { role: "miner", home: "W1N1", op: "mining:W1N1" }, targetRoom: "W1N1" }
    ];

    const intents = planSpawning(empire.colonies, roomDistance);
    const spawned = intents.find(i => i.kind === "spawn");
    expect(spawned && spawned.kind === "spawn" && spawned.memory.targetRoom).toBeUndefined();
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
