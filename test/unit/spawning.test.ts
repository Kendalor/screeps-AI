import { describe, expect, it } from "vitest";
import { planSpawning } from "../../src/systems/spawning";
import { colony, empire, spawn } from "../fixtures";

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
        census: { bootstrap: 2 }, // 1 source -> quota of 2
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

  it("spawns an upgrader once the bootstrap quota is met", () => {
    const snap = empire(
      colony({
        census: { bootstrap: 2 }, // 1 source -> bootstrap quota met
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
