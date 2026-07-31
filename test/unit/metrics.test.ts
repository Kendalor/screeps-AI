import { describe, expect, it } from "vitest";
import { buildingsFor, collectMetrics, HARVEST_WINDOW, type ColonyMetrics } from "../../src/colony/metrics";
import type { PlacedStructure } from "../../src/layouts/stamp";
import type { ColonyMetricsMemory, RoleName } from "../../src/memory/schema";
import type { RoleTarget } from "../../src/operations/operation";
import type { SnapStructure } from "../../src/snapshot/types";
import type { CreepRequest } from "../../src/spawn/request";
import { colonySnap, containerAt, dropAt, remoteEnergyAt, snapCreeps, spawn } from "../fixtures";

// A blank harvest window per test — the persisted state collectMetrics folds into.
const mem = (): ColonyMetricsMemory => ({ harvestSamples: [] });

// A creep request for `role` — census reads only memory.role off it.
function want(role: CreepRequest["memory"]["role"], n = 1): CreepRequest[] {
  return Array.from({ length: n }, () => ({
    body: [WORK],
    priority: 1,
    memory: { role, home: "W1N1" },
    targetRoom: "W1N1"
  }));
}

function collect(
  snap = colonySnap(),
  requests: CreepRequest[] = [],
  ops: string[] = [],
  targeted: PlacedStructure[] = [],
  m = mem(),
  roleTargets: RoleTarget[] = []
): ColonyMetrics {
  return collectMetrics(snap, requests, ops, targeted, m, roleTargets);
}

// A per-role staffing target, as an operation would report it via roleTargets().
const roleTarget = (role: RoleName, n: number): RoleTarget[] => [{ role, target: n }];

// Terse constructors for the built/targeted structure lists.
const built = (type: BuildableStructureConstant, n: number): SnapStructure[] =>
  Array.from({ length: n }, (_, i) => ({ type, x: i, y: 0 }));
const target = (type: BuildableStructureConstant, n: number): PlacedStructure[] =>
  Array.from({ length: n }, (_, i) => ({ type, x: i, y: 0 }));

describe("metrics: census", () => {
  it("counts alive creeps per role as current", () => {
    const snap = colonySnap({ creeps: [...snapCreeps("miner", 2), ...snapCreeps("hauler", 1)] });
    const rows = collect(snap).census;

    expect(rows.find(r => r.role === "miner")).toMatchObject({ current: 2 });
    expect(rows.find(r => r.role === "hauler")).toMatchObject({ current: 1 });
  });

  it("desired is current plus the outstanding requests for that role", () => {
    const snap = colonySnap({ creeps: snapCreeps("miner", 2) });
    // Two miners alive, one more requested -> desired 3.
    const rows = collect(snap, want("miner", 1)).census;

    expect(rows.find(r => r.role === "miner")).toMatchObject({ current: 2, desired: 3 });
  });

  it("a fully staffed role has desired equal to current (no requests)", () => {
    const snap = colonySnap({ creeps: snapCreeps("upgrader", 3) });
    const rows = collect(snap).census;

    expect(rows.find(r => r.role === "upgrader")).toMatchObject({ current: 3, desired: 3 });
  });

  it("includes a role that is wanted but not yet alive", () => {
    const rows = collect(colonySnap({ creeps: [] }), want("builder", 2)).census;

    expect(rows.find(r => r.role === "builder")).toMatchObject({ current: 0, desired: 2 });
  });

  it("omits roles that are neither present nor wanted", () => {
    const rows = collect(colonySnap({ creeps: snapCreeps("miner", 1) })).census;

    expect(rows.map(r => r.role)).toEqual(["miner"]);
  });

  it("shows a surplus as current over target when an operation reports a target below the live count", () => {
    // 5 builders alive, but the operation now targets 0 (nothing left to build) -> 5/0, not 5/5.
    const snap = colonySnap({ creeps: snapCreeps("builder", 5) });
    const rows = collect(snap, [], [], [], mem(), roleTarget("builder", 0)).census;

    expect(rows.find(r => r.role === "builder")).toMatchObject({ current: 5, desired: 0 });
  });

  it("uses the reported target as the denominator even when the role is understaffed", () => {
    // A reported target overrides the request-derived count so both directions come from one source.
    const snap = colonySnap({ creeps: snapCreeps("upgrader", 1) });
    const rows = collect(snap, [], [], [], mem(), roleTarget("upgrader", 3)).census;

    expect(rows.find(r => r.role === "upgrader")).toMatchObject({ current: 1, desired: 3 });
  });

  it("includes a role with a positive target but none alive", () => {
    const rows = collect(colonySnap({ creeps: [] }), [], [], [], mem(), roleTarget("builder", 2)).census;

    expect(rows.find(r => r.role === "builder")).toMatchObject({ current: 0, desired: 2 });
  });

  it("falls back to the request-derived denominator for roles with no reported target", () => {
    // miner has no roleTarget entry -> old behavior: current + requests.
    const snap = colonySnap({ creeps: snapCreeps("miner", 2) });
    const rows = collect(snap, want("miner", 1), [], [], mem(), roleTarget("builder", 0)).census;

    expect(rows.find(r => r.role === "miner")).toMatchObject({ current: 2, desired: 3 });
  });
});

describe("metrics: operations", () => {
  it("lists the operation names it is handed", () => {
    const m = collect(colonySnap(), [], ["mining:W1N1", "defense:W1N1"]);
    expect(m.operations).toEqual(["mining:W1N1", "defense:W1N1"]);
  });
});

describe("metrics: buildings (buildingsFor)", () => {
  it("reports built vs targeted per structure type", () => {
    const rows = buildingsFor(built("extension", 3), target("extension", 5));
    expect(rows).toEqual([{ type: "extension", built: 3, targeted: 5 }]);
  });

  it("shows a type that is planned but not yet built as 0/N", () => {
    const rows = buildingsFor([], target("tower", 1));
    expect(rows).toEqual([{ type: "tower", built: 0, targeted: 1 }]);
  });

  it("shows a type built but no longer planned as N/0", () => {
    const rows = buildingsFor(built("container", 2), []);
    expect(rows).toEqual([{ type: "container", built: 2, targeted: 0 }]);
  });

  it("orders the most-remaining type first", () => {
    const rows = buildingsFor(
      [...built("extension", 4), ...built("tower", 0)],
      [...target("extension", 5), ...target("tower", 2)] // extension short 1, tower short 2
    );
    expect(rows.map(r => r.type)).toEqual(["tower", "extension"]);
  });

  it("collectMetrics counts the room's structures against the targeted plan", () => {
    const snap = colonySnap({ structures: [...built("extension", 2), ...built("spawn", 1)] });
    const m = collect(snap, [], [], [...target("extension", 5), ...target("spawn", 1)]);
    expect(m.buildings).toContainEqual({ type: "extension", built: 2, targeted: 5 });
    expect(m.buildings).toContainEqual({ type: "spawn", built: 1, targeted: 1 });
  });

  it("collectMetrics counts remote-room structures as built, not just home-room ones", () => {
    // Remote containers/roads are claimed structures included in `targeted` (see wantedStructures), so
    // built structures standing in a remote room must count too or they read as permanently missing.
    const snap = colonySnap({
      structures: [...built("road", 1)],
      remoteStructures: { W2N1: built("container", 2), W3N1: built("road", 1) }
    });
    const m = collect(snap, [], [], [...target("container", 8), ...target("road", 3)]);
    expect(m.buildings).toContainEqual({ type: "container", built: 2, targeted: 8 });
    expect(m.buildings).toContainEqual({ type: "road", built: 2, targeted: 3 });
  });
});

describe("metrics: energy levels", () => {
  it("reports spawn energy, capacity, and storage", () => {
    const m = collect(colonySnap({ energyAvailable: 250, energyCapacity: 550, storageEnergy: 120_000 }));
    expect(m.energy).toMatchObject({ available: 250, capacity: 550, storage: 120_000 });
  });

  it("sums dropped energy across all ground piles", () => {
    const m = collect(colonySnap({ drops: [dropAt(10, 10, 40), dropAt(11, 11, 60)] }));
    expect(m.energy.dropped).toBe(100);
  });

  it("sums remote energy across all remote containers/drops/tombstones", () => {
    const m = collect(
      colonySnap({
        remoteEnergy: [
          remoteEnergyAt("W2N1", 200, "container"),
          remoteEnergyAt("W2N1", 50, "dropped"),
          remoteEnergyAt("W3N1", 30, "tombstone")
        ]
      })
    );
    expect(m.energy.remoteEnergy).toBe(280);
  });

  it("reads 0 remote energy without remote vision", () => {
    const m = collect(colonySnap());
    expect(m.energy.remoteEnergy).toBe(0);
  });
});

describe("metrics: harvest rate", () => {
  it("is undefined on the first sample (nothing to diff against)", () => {
    const m = collect(colonySnap({ tick: 100, containers: [containerAt(5, 5, 500)] }));
    expect(m.energy.harvestPerTick).toBeUndefined();
  });

  it("averages the rise in stored+dropped+container energy per tick", () => {
    const window = mem();
    // Tick 0: 100 in a container. Tick 10: 300. +200 over 10 ticks -> 20/tick.
    collect(colonySnap({ tick: 0, containers: [containerAt(5, 5, 100)] }), [], [], [], window);
    const m = collect(colonySnap({ tick: 10, containers: [containerAt(5, 5, 300)] }), [], [], [], window);

    expect(m.energy.harvestPerTick).toBeCloseTo(20);
  });

  it("does not count a drained container (a sink spending) as negative harvest", () => {
    const window = mem();
    // Rise of 200 over ticks 0->10, then a drop of 300 over 10->20. Only the rise counts.
    collect(colonySnap({ tick: 0, containers: [containerAt(5, 5, 100)] }), [], [], [], window);
    collect(colonySnap({ tick: 10, containers: [containerAt(5, 5, 300)] }), [], [], [], window);
    const m = collect(colonySnap({ tick: 20, containers: [containerAt(5, 5, 0)] }), [], [], [], window);

    // gained = 200 over a 20-tick span -> 10/tick, never negative.
    expect(m.energy.harvestPerTick).toBeCloseTo(10);
  });

  it("ages samples out of the window", () => {
    const window = mem();
    collect(colonySnap({ tick: 0, containers: [containerAt(5, 5, 0)] }), [], [], [], window);
    collect(colonySnap({ tick: HARVEST_WINDOW + 50, containers: [containerAt(5, 5, 0)] }), [], [], [], window);
    collect(colonySnap({ tick: HARVEST_WINDOW + 100, containers: [containerAt(5, 5, 0)] }), [], [], [], window);

    // The tick-0 sample is older than HARVEST_WINDOW before the newest, so it is dropped.
    expect(window.harvestSamples.every(s => s.tick >= 50)).toBe(true);
  });

  it("ignores a repeated tick rather than dividing by a zero span", () => {
    const window = mem();
    collect(colonySnap({ tick: 5, containers: [containerAt(5, 5, 100)] }), [], [], [], window);
    const m = collect(colonySnap({ tick: 5, containers: [containerAt(5, 5, 999)] }), [], [], [], window);

    expect(window.harvestSamples).toHaveLength(1);
    expect(m.energy.harvestPerTick).toBeUndefined();
  });
});

describe("metrics: controller and construction", () => {
  it("reports controller level, progress and the total to the next level", () => {
    const m = collect(colonySnap({ controllerLevel: 4, controllerProgress: 12_345, controllerProgressTotal: 45_000 }));
    expect(m.controller).toEqual({ level: 4, progress: 12_345, progressTotal: 45_000 });
  });

  it("reports outstanding construction work", () => {
    const m = collect(colonySnap({ constructionProgress: 8_000 }));
    expect(m.construction.remaining).toBe(8_000);
  });

  it("reports outstanding remote construction work separately from home", () => {
    const m = collect(colonySnap({ constructionProgress: 8_000, remoteConstructionProgress: 500 }));
    expect(m.construction).toEqual({ remaining: 8_000, remoteRemaining: 500 });
  });
});

describe("metrics: repair", () => {
  // A built structure carries hits/hitsMax; a construction site does not. REPAIR_BELOW is 0.8.
  const struct = (type: BuildableStructureConstant, hits: number, hitsMax: number): SnapStructure => ({
    type,
    x: 0,
    y: 0,
    id: "s" as SnapStructure["id"],
    hits,
    hitsMax
  });
  const noRemote = { remoteDecay: 0, remoteActionable: 0 };

  it("counts sub-100% decay even above the repair floor, but nothing is actionable yet", () => {
    const snap = colonySnap({ structures: [struct("road", 4_500, 5_000)] }); // 90%: 500 decayed, above 80%
    expect(collect(snap).repair).toEqual({ decay: 500, actionable: 0, ...noRemote });
  });

  it("counts fully-healthy structures as neither decay nor actionable", () => {
    const snap = colonySnap({ structures: [struct("road", 5_000, 5_000)] });
    expect(collect(snap).repair).toEqual({ decay: 0, actionable: 0, ...noRemote });
  });

  it("reports both the total decay and the actionable subset past the floor", () => {
    const snap = colonySnap({
      structures: [
        struct("road", 1_000, 5_000), // 20%: 4,000 decayed, past floor -> actionable
        struct("container", 240_000, 250_000) // 96%: 10,000 decayed, above floor -> decay only
      ]
    });
    // decay = 4,000 + 10,000; actionable = just the road's 4,000.
    expect(collect(snap).repair).toEqual({ decay: 14_000, actionable: 4_000, ...noRemote });
  });

  it("ignores structure types that are not repairable (walls/ramparts)", () => {
    const snap = colonySnap({ structures: [struct("rampart", 1, 300_000_000)] });
    expect(collect(snap).repair).toEqual({ decay: 0, actionable: 0, ...noRemote });
  });

  it("ignores construction sites (no hits to restore)", () => {
    const snap = colonySnap({ structures: [{ type: "road", x: 0, y: 0 }] });
    expect(collect(snap).repair).toEqual({ decay: 0, actionable: 0, ...noRemote });
  });

  it("tallies decay across a visible remote room separately from home", () => {
    const snap = colonySnap({
      structures: [struct("road", 4_500, 5_000)], // home: 500 decayed, not actionable
      remoteStructures: { W2N1: [struct("road", 1_000, 5_000)] } // remote: 4,000 decayed, actionable
    });
    expect(collect(snap).repair).toEqual({ decay: 500, actionable: 0, remoteDecay: 4_000, remoteActionable: 4_000 });
  });

  it("reads no remote decay for a remote room without vision", () => {
    const snap = colonySnap({ structures: [struct("road", 4_500, 5_000)] });
    expect(collect(snap).repair).toEqual({ decay: 500, actionable: 0, ...noRemote });
  });
});

describe("metrics: safe mode", () => {
  it("reports the active counter, banked count, and availability", () => {
    const m = collect(colonySnap({ safeModeActive: 12_000, safeModeCount: 2, safeModeAvailable: false }));
    expect(m.safeMode).toEqual({ active: 12_000, count: 2, available: false });
  });

  it("reads 0 active when not in safe mode", () => {
    const m = collect(colonySnap({ safeModeAvailable: true, safeModeCount: 1 }));
    expect(m.safeMode.active).toBe(0);
  });
});

describe("metrics: spawns", () => {
  it("counts total spawns and how many are busy", () => {
    const m = collect(colonySnap({ spawns: [spawn("s1", true), spawn("s2", false)] }));
    expect(m.spawns).toMatchObject({ total: 2, busy: 1 });
  });

  it("sums living body parts and reads load as the colony fraction of spawn capacity", () => {
    // 3 default creeps * 3 parts = 9 parts; 1 spawn sustains 500 -> load 9/500.
    const m = collect(colonySnap({ spawns: [spawn()], creeps: snapCreeps("miner", 3) }));
    expect(m.spawns).toMatchObject({ parts: 9, capacity: 500 });
    expect(m.spawns.load).toBeCloseTo(9 / 500);
  });

  it("counts required parts: living creeps plus every outstanding request", () => {
    // 3 living miners * 3 parts = 9, plus 2 requested creeps at 1 part each (want()'s body is [WORK]) = 11.
    const m = collect(colonySnap({ spawns: [spawn()], creeps: snapCreeps("miner", 3) }), want("miner", 2));
    expect(m.spawns).toMatchObject({ parts: 11, capacity: 500 });
    expect(m.spawns.load).toBeCloseTo(11 / 500);
  });

  it("reads load from requests alone when no creeps are alive yet", () => {
    // A cold colony with nothing alive but staffing requested reads its full required load, not 0.
    const m = collect(colonySnap({ spawns: [spawn()], creeps: [] }), want("miner", 4));
    expect(m.spawns).toMatchObject({ parts: 4, capacity: 500 });
    expect(m.spawns.load).toBeCloseTo(4 / 500);
  });

  it("scales capacity with spawn count so the fraction stays comparable as spawns grow", () => {
    // Same 9 parts, but two spawns double the sustainable capacity -> load halves.
    const m = collect(colonySnap({ spawns: [spawn("s1"), spawn("s2")], creeps: snapCreeps("miner", 3) }));
    expect(m.spawns).toMatchObject({ parts: 9, capacity: 1000 });
    expect(m.spawns.load).toBeCloseTo(9 / 1000);
  });

  it("reads load 0 for a spawnless colony rather than dividing by zero", () => {
    const m = collect(colonySnap({ spawns: [], creeps: snapCreeps("miner", 1) }));
    expect(m.spawns.load).toBe(0);
  });
});

describe("metrics: room identity", () => {
  it("carries the room name and tick from the snapshot", () => {
    const m = collect(colonySnap({ name: "W5N5", tick: 999 }));
    expect(m).toMatchObject({ room: "W5N5", tick: 999 });
  });
});
