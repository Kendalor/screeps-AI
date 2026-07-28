// Scratch repro using REAL pserver numbers from W8N3: 6 miners, 1 bootstrap, 1 upgrader, energy
// 82/300, six drop piles totaling 7098 energy, zero containers, spawn idle. Logistics reports 0
// transport creeps wanted/alive live, despite this. Delete once the investigation is done.
import { describe, expect, it } from "vitest";
import { Logistics } from "../../../src/operations/logistics";
import { Mining } from "../../../src/operations/mining";
import { providers, consumers } from "../../../src/logistics/graph";
import { colonySnap, dropAt, snapCreep } from "../../fixtures";
import { bodyCost } from "../../../src/spawn/body";

describe("repro", () => {
  it("reproduces the exact W8N3 live scenario", () => {
    const miners = Array.from({ length: 6 }, (_, i) =>
      snapCreep("miner", { body: [WORK, WORK, MOVE, MOVE], memory: { sourceId: `s${i % 2}` as Id<Source> } })
    );
    const bootstrap = snapCreep("bootstrap", { body: [WORK, CARRY, MOVE, MOVE] });
    const upgrader = snapCreep("upgrader", { body: [WORK, CARRY, MOVE, MOVE] });

    const snap = colonySnap({
      energyAvailable: 82,
      energyCapacity: 300,
      sources: [
        { id: "s0" as Id<Source>, x: 20, y: 10, openTiles: 3 },
        { id: "s1" as Id<Source>, x: 20, y: 12, openTiles: 3 }
      ],
      creeps: [...miners, bootstrap, upgrader],
      drops: [
        dropAt(33, 21, 1447),
        dropAt(33, 20, 1411),
        dropAt(33, 19, 1409),
        dropAt(29, 20, 1235),
        dropAt(30, 20, 1023),
        dropAt(31, 20, 573)
      ],
      containers: [],
      anchor: { x: 25, y: 15 }
    });

    console.log("providers:", JSON.stringify(providers(snap)));
    console.log("consumers:", JSON.stringify(consumers(snap)));

    const logistics = new Logistics("W8N3");
    const mining = new Mining("W8N3");
    const logisticsReqs = logistics.desiredCreeps(snap);
    const miningReqs = mining.desiredCreeps(snap);
    console.log("logistics requests:", JSON.stringify(logisticsReqs.map(r => ({ role: r.memory.role, priority: r.priority, cost: bodyCost(r.body) }))));
    console.log("mining requests:", JSON.stringify(miningReqs.map(r => ({ role: r.memory.role, priority: r.priority, cost: bodyCost(r.body) }))));

    const merged = [...logisticsReqs, ...miningReqs].sort((a, b) => b.priority - a.priority);
    console.log("merged sorted:", JSON.stringify(merged.map(r => ({ role: r.memory.role, priority: r.priority, cost: bodyCost(r.body) }))));
    console.log("energyAvailable:", snap.energyAvailable);

    expect(true).toBe(true);
  });
});
