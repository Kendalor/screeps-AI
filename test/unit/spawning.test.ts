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

  it("recovers a wiped colony with a supply creep when storage still holds energy", () => {
    // An established room that lost every creep still has stored energy, but
    // nothing alive to move it: energyAvailable only ever climbs to the spawn's
    // own regen. Supply is the role that withdraws from storage and refills the
    // extensions — a hauler would be useless here, it only moves energy the
    // other way (container -> storage) and would strand the colony.
    const snap = empire(
      colony({
        census: {},
        spawns: [spawn()],
        energyAvailable: 300,
        sources: 2,
        storageEnergy: 50_000
      })
    );

    expect(planSpawning(snap)).toMatchObject([{ kind: "spawn", role: "supply" }]);
  });

  it("recovers a wiped colony with a bootstrap when there is no stored energy", () => {
    // Nothing to haul from, so recovery falls back to the one role that needs
    // no infrastructure at all: harvest a source, carry it to the spawn.
    const snap = empire(
      colony({
        census: {},
        spawns: [spawn()],
        energyAvailable: 300,
        sources: 1,
        storageEnergy: 0
      })
    );

    expect(planSpawning(snap)).toMatchObject([{ kind: "spawn", role: "bootstrap" }]);
  });

  it("treats a colony with any live creep as healthy, not wiped", () => {
    // Recovery must fire only on a true wipe. One live creep of any role means
    // something is still working the room, so the normal quota diff decides —
    // otherwise a single surviving creep would be joined by a supply creep the
    // colony never asked for, off the storage branch.
    const snap = empire(
      colony({
        census: { miner: 1 },
        spawns: [spawn()],
        energyAvailable: 300,
        sources: 1,
        storageEnergy: 50_000
      })
    );

    expect(planSpawning(snap)).toMatchObject([{ kind: "spawn", role: "bootstrap" }]);
  });

  it("never emits a body the colony cannot pay for", () => {
    // Body calculators clamp their energy argument UP to a floor, so below that
    // floor they hand back a body costing more than the room has: bootstrapBody
    // returns [WORK,CARRY,MOVE] (200) however little energy it is given.
    // Without this guard the spawn dry run rejects it every tick forever.
    const snap = empire(
      colony({
        census: {},
        spawns: [spawn()],
        energyAvailable: 150,
        sources: 1
      })
    );

    expect(planSpawning(snap)).toEqual([]);
  });

  it("still spawns a cheap role the colony can afford below the bootstrap floor", () => {
    // The affordability floor is per-role, not a flat 300: a hauler's cheapest
    // body is one CARRY,CARRY,MOVE set at 150, and desiredHaulerCount's own
    // MIN_HAULER_ENERGY documents 150 as sufficient. A blanket 300 floor would
    // strand a colony that can afford the hauler it actually needs.
    const snap = empire(
      colony({
        census: { bootstrap: 2, miner: 1 },
        spawns: [spawn()],
        energyAvailable: 200,
        sources: 1,
        containers: [containerAt(10, 10, 500)]
      })
    );

    expect(planSpawning(snap)).toMatchObject([{ kind: "spawn", role: "hauler" }]);
  });

  it("scales the bootstrap body to available energy", () => {
    const snap = empire(
      colony({
        census: {},
        spawns: [spawn()],
        energyAvailable: 550,
        energyCapacity: 550,
        sources: 1
      })
    );

    const [intent] = planSpawning(snap);
    expect(intent).toMatchObject({ kind: "spawn", role: "bootstrap" });
    expect(intent.kind === "spawn" && intent.body.filter(p => p === WORK)).toHaveLength(2);
  });

  it("sizes normal-path bodies from capacity, so the same room always yields the same body", () => {
    // The defect (issue #21): sizing from energyAvailable made body size depend
    // on WHICH TICK the planner happened to run. A spawn firing just after the
    // room spent energy locked in a runt that then lived ~1500 ticks. Capacity
    // is the room's persistent, timing-independent budget.
    // 800 capacity sizes a 4-WORK body costing exactly 800. Sized from
    // availability, a full room would instead yield only what that tick's
    // energy bought — the two are visibly different creeps.
    const snap = empire(
      colony({
        census: {},
        spawns: [spawn()],
        energyAvailable: 800,
        energyCapacity: 800,
        sources: 1
      })
    );

    const [intent] = planSpawning(snap);
    expect(intent.kind === "spawn" && intent.body.filter(p => p === WORK)).toHaveLength(4);
  });

  it("waits for a refill rather than spawning a runt sized to a drained room", () => {
    // The other half of issue #21: with sizing moved to capacity, a drained
    // room can no longer afford the body it wants, and the existing
    // affordability guard becomes the "wait until the room can pay" mechanism
    // for free. Previously this room would have locked in a 2-WORK runt that
    // then lived ~1500 ticks.
    const snap = empire(
      colony({
        census: {},
        spawns: [spawn()],
        energyAvailable: 400, // would have bought a 2-WORK bootstrap
        energyCapacity: 800, // wants the 4-WORK, 800-cost one
        sources: 1
      })
    );

    expect(planSpawning(snap)).toEqual([]);
  });
});
