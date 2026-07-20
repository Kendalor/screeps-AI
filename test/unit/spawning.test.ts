import { describe, expect, it } from "vitest";
import { planSpawning } from "../../src/systems/spawning";
import { colony, containerAt, empire, spawn } from "../fixtures";

describe("spawning planner", () => {
  it("spawns a bootstrap when the colony is below quota", () => {
    const snap = empire(
      colony({
        census: {},
        spawns: [{ id: "spawn1" as Id<StructureSpawn>, busy: false }],
        energyAvailable: 300,
        sources: 1
      })
    );

    expect(planSpawning(snap)).toEqual([
      {
        kind: "spawn",
        spawn: "spawn1",
        role: "bootstrap",
        body: [WORK, CARRY, MOVE],
        memory: { home: "W1N1", role: "bootstrap" }
      }
    ]);
  });

  it("emits nothing when the census already meets quota", () => {
    const snap = empire(
      colony({
        // 1 source -> bootstrap 2; no containers so no miners or haulers, and
        // RCL1 wants no upgraders. Every quota met.
        census: { bootstrap: 2 },
        spawns: [spawn()],
        sources: 1
      })
    );

    expect(planSpawning(snap)).toEqual([]);
  });

  it("does not spawn from a busy spawn", () => {
    const snap = empire(
      colony({
        census: {},
        spawns: [spawn("spawn1", true)],
        sources: 1
      })
    );

    expect(planSpawning(snap)).toEqual([]);
  });

  it("spawns an upgrader once the bootstrap and miner quotas are met", () => {
    const snap = empire(
      colony({
        census: { bootstrap: 2 }, // 1 source, no containers -> both quotas met
        spawns: [spawn()],
        energyAvailable: 300,
        controllerLevel: 3,
        sources: 1
      })
    );

    expect(planSpawning(snap)).toEqual([
      {
        kind: "spawn",
        spawn: "spawn1",
        role: "upgrader",
        body: [WORK, CARRY, CARRY, MOVE, MOVE],
        memory: { home: "W1N1", role: "upgrader" }
      }
    ]);
  });

  it("does not spawn miners before a container exists to receive them", () => {
    // A miner with no container has nowhere to put energy: it fills its one
    // CARRY and stalls, starving the upgrade that gets the colony to RCL2.
    const snap = empire(
      colony({
        census: { bootstrap: 4 },
        spawns: [spawn()],
        energyAvailable: 300,
        sources: 2,
        containers: []
      })
    );

    expect(planSpawning(snap)).not.toMatchObject([{ role: "miner" }]);
  });

  it("spawns one miner per source once containers exist", () => {
    const snap = empire(
      colony({
        census: { bootstrap: 4 }, // 2 sources -> bootstrap quota met
        spawns: [spawn()],
        energyAvailable: 300,
        sources: 2,
        containers: [containerAt(10, 10), containerAt(40, 40)]
      })
    );

    expect(planSpawning(snap)).toEqual([
      {
        kind: "spawn",
        spawn: "spawn1",
        role: "miner",
        body: [WORK, WORK, MOVE], // container present -> no CARRY needed
        memory: { home: "W1N1", role: "miner" }
      }
    ]);
  });

  it("spawns a hauler once the miner quota is met and a container is filling", () => {
    const snap = empire(
      colony({
        census: { bootstrap: 2, miner: 1 },
        spawns: [spawn()],
        energyAvailable: 300,
        sources: 1,
        containers: [containerAt(10, 10, 500)]
      })
    );

    expect(planSpawning(snap)).toMatchObject([{ kind: "spawn", role: "hauler" }]);
  });

  it("spawns a builder once a construction backlog exists and higher-priority quotas are met", () => {
    const snap = empire(
      colony({
        census: { bootstrap: 2, upgrader: 4 }, // everything above builder satisfied
        spawns: [spawn()],
        energyAvailable: 300,
        controllerLevel: 4,
        sources: 1,
        storageEnergy: 200_000,
        constructionProgress: 4_000
      })
    );

    expect(planSpawning(snap)).toEqual([
      {
        kind: "spawn",
        spawn: "spawn1",
        role: "builder",
        body: [WORK, CARRY, MOVE],
        memory: { home: "W1N1", role: "builder" }
      }
    ]);
  });

  it("fills the upgrader deficit before the builder one — builder is lowest priority", () => {
    const snap = empire(
      colony({
        census: { bootstrap: 2 }, // upgrader AND builder both under quota
        spawns: [spawn()],
        energyAvailable: 300,
        controllerLevel: 4,
        sources: 1,
        storageEnergy: 200_000,
        constructionProgress: 4_000
      })
    );

    const [intent] = planSpawning(snap);
    expect(intent).toMatchObject({ role: "upgrader" });
  });

  it("scales the bootstrap body to available energy", () => {
    const snap = empire(
      colony({
        census: {},
        spawns: [spawn()],
        energyAvailable: 550,
        sources: 1
      })
    );

    const [intent] = planSpawning(snap);
    expect(intent).toMatchObject({ kind: "spawn", role: "bootstrap" });
    expect(intent.kind === "spawn" && intent.body.filter(p => p === WORK)).toHaveLength(2);
  });
});
