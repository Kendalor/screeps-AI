import { describe, expect, it } from "vitest";
import { planBoostLabAllocation } from "../../../src/empire/boostLabAllocation";
import type { LabState } from "../../../src/empire/boostReadiness";
import type { ColonySnapshot, SnapCreep } from "../../../src/snapshot/types";

// Minimal SnapCreep fabricator — only the fields spawningBoostedCreeps/allocation actually read matter.
function creep(id: string, boosts: string[], spawning = true): SnapCreep {
  return {
    id: id as Id<Creep>,
    name: id,
    body: [],
    spawning,
    role: "upgrader" as SnapCreep["role"],
    home: "W1N1",
    room: "W1N1",
    x: 10,
    y: 10,
    hits: 100,
    hitsMax: 100,
    fatigue: 0,
    storeEnergy: 0,
    storeCapacity: 0,
    memory: { role: "upgrader", home: "W1N1", boosts } as SnapCreep["memory"]
  };
}

// Minimal ColonySnapshot fabricator — every other field is irrelevant to this pure function, so they're
// left at cheap empty/zero defaults. Only `creeps` is ever read by planBoostLabAllocation.
function colonyWith(creeps: SnapCreep[]): ColonySnapshot {
  return {
    name: "W1N1",
    tick: 100,
    towers: [],
    hostiles: [],
    woundedFriendlies: [],
    safeModeAvailable: false,
    safeModeActive: 0,
    safeModeCount: 0,
    creeps,
    spawns: [],
    spawnSinks: [],
    energyAvailable: 0,
    energyCapacity: 0,
    sources: [],
    remoteSources: [],
    remoteStrikes: {},
    remoteEnergy: [],
    drops: [],
    tombstones: [],
    ruins: [],
    terrain: new Uint8Array(0),
    controller: { x: 0, y: 0 },
    controllerLevel: 8,
    controllerProgress: 0,
    controllerProgressTotal: 0,
    storageEnergy: 0,
    storageCapacity: 0,
    storageMineral: 0,
    containers: [],
    links: [],
    terminalEnergy: 0,
    terminalCapacity: 0,
    anchor: null,
    sourceMemory: {},
    mineralMemory: {},
    linkNetwork: {},
    roadsBuilt: true,
    structures: [],
    sites: [],
    remoteStructures: {},
    remoteSites: {},
    remoteDanger: {},
    remoteReservedBy: {},
    siteSummary: [],
    constructionProgress: 0,
    remoteConstructionProgress: 0,
    scoutTargets: [],
    visibleRooms: [],
    colonizing: [],
    attacking: [],
    defending: [],
    singleTargetOps: {},
    drainRoute: [],
    hostileRoomTowers: {},
    hostileRoomUnits: {},
    visibleRoomRoads: {},
    hostileRoomStorageEnergy: {},
    drainRoomTerrain: {},
    drainRoomOccupancy: {},
    paradeRoomTerrain: {},
    paradeRoomOccupancy: {}
  };
}

const LAB_A = "labA" as Id<StructureLab>;
const LAB_B = "labB" as Id<StructureLab>;
const LAB_C = "labC" as Id<StructureLab>;
const boostLabIds = [LAB_A, LAB_B, LAB_C] as const;

const emptyLabs: LabState[] = [
  { labId: LAB_A, amount: 0 },
  { labId: LAB_B, amount: 0 },
  { labId: LAB_C, amount: 0 }
];

describe("planBoostLabAllocation", () => {
  it("returns an empty map when no creep is spawning with a pending boost order", () => {
    const colony = colonyWith([creep("a", []), creep("b", ["heal"], false)]);
    const result = planBoostLabAllocation(colony, boostLabIds, emptyLabs, () => ({}));
    expect(result.size).toBe(0);
  });

  it("assigns all creeps needing the SAME compound, aggregating demand rather than double-booking", () => {
    const colony = colonyWith([creep("a", ["heal"]), creep("b", ["heal"])]);
    const resolveNeeds = () => ({ LO: 400 } as Partial<Record<ResourceConstant, number>>);
    const result = planBoostLabAllocation(colony, boostLabIds, emptyLabs, resolveNeeds);

    expect(result.size).toBe(2);
    expect(result.get("a" as Id<Creep>)?.compound).toBe("LO");
    expect(result.get("b" as Id<Creep>)?.compound).toBe("LO");
    // Same compound -> same lab (no reason to split identical demand across two labs).
    expect(result.get("a" as Id<Creep>)?.labId).toBe(result.get("b" as Id<Creep>)?.labId);
  });

  it("assigns all creeps when they need DIFFERENT compounds and there's enough lab capacity", () => {
    const colony = colonyWith([creep("a", ["heal"]), creep("b", ["tough"])]);
    const resolveNeeds = (creepId: Id<Creep>) =>
      creepId === "a" ? { LO: 400 } : { GO: 300 };
    const result = planBoostLabAllocation(colony, boostLabIds, emptyLabs, resolveNeeds);

    expect(result.size).toBe(2);
    expect(result.get("a" as Id<Creep>)?.compound).toBe("LO");
    expect(result.get("b" as Id<Creep>)?.compound).toBe("GO");
    // Distinct compounds must land on distinct labs.
    expect(result.get("a" as Id<Creep>)?.labId).not.toBe(result.get("b" as Id<Creep>)?.labId);
  });

  it("under scarcity, only the highest-readiness creep(s) win a lab; losers are absent from the map", () => {
    // Only 1 free lab, but 2 creeps want 2 DIFFERENT compounds — a genuine conflict.
    const colony = colonyWith([creep("a", ["heal"]), creep("b", ["tough"])]);
    const resolveNeeds = (creepId: Id<Creep>) =>
      creepId === "a" ? { LO: 400 } : { GO: 300 };
    // Lab A is already stocked with creep b's compound (GO, >= needed amount) -> b is more ready.
    const labs: LabState[] = [
      { labId: LAB_A, resource: "GO", amount: 300 }
    ];
    const result = planBoostLabAllocation(colony, [LAB_A], labs, resolveNeeds);

    expect(result.size).toBe(1);
    expect(result.has("b" as Id<Creep>)).toBe(true);
    expect(result.get("b" as Id<Creep>)?.compound).toBe("GO");
    expect(result.get("b" as Id<Creep>)?.labId).toBe(LAB_A);
    expect(result.has("a" as Id<Creep>)).toBe(false);
  });

  it("never allocates more than 3 labs regardless of how many creeps contend", () => {
    const colony = colonyWith([
      creep("a", ["heal"]),
      creep("b", ["tough"]),
      creep("c", ["move"]),
      creep("d", ["attack"])
    ]);
    const resolveNeeds = (creepId: Id<Creep>) => {
      switch (creepId) {
        case "a": return { LO: 400 };
        case "b": return { GO: 300 };
        case "c": return { ZO: 200 };
        default: return { UO: 100 };
      }
    };
    const result = planBoostLabAllocation(colony, boostLabIds, emptyLabs, resolveNeeds);

    expect(result.size).toBeLessThanOrEqual(3);
    const usedLabs = new Set([...result.values()].map(a => a.labId));
    expect(usedLabs.size).toBeLessThanOrEqual(3);
  });

  it("does not let an unstocked compound steal a lab another granted compound is already stocked in", () => {
    // Lab A holds compound Y (creep b's need) at a sufficient amount; lab B is empty. Both compounds fit
    // (2 labs, 2 compounds -> no scarcity), so both should be granted -- the bug was that iteration order
    // let X (unstocked) grab lab A first via the "first free lab" fallback, forcing Y into cold lab B
    // despite A already holding exactly what Y needs.
    const colony = colonyWith([creep("a", ["heal"]), creep("b", ["tough"])]);
    const resolveNeeds = (creepId: Id<Creep>) => (creepId === "a" ? { XLH2O: 400 } : { GO: 300 });
    const labs: LabState[] = [
      { labId: LAB_A, resource: "GO", amount: 300 },
      { labId: LAB_B, amount: 0 }
    ];
    const result = planBoostLabAllocation(colony, [LAB_A, LAB_B], labs, resolveNeeds);

    expect(result.get("b" as Id<Creep>)?.compound).toBe("GO");
    // b's already-stocked lab (A) must go to b, not get claimed by a's unstocked compound first.
    expect(result.get("b" as Id<Creep>)?.labId).toBe(LAB_A);
    expect(result.get("a" as Id<Creep>)?.labId).toBe(LAB_B);
  });

  it("is pure: identical inputs produce an identical (deep-equal) output map every call", () => {
    const colony = colonyWith([creep("a", ["heal"]), creep("b", ["tough"])]);
    const resolveNeeds = (creepId: Id<Creep>) =>
      creepId === "a" ? { LO: 400 } : { GO: 300 };

    const first = planBoostLabAllocation(colony, boostLabIds, emptyLabs, resolveNeeds);
    const second = planBoostLabAllocation(colony, boostLabIds, emptyLabs, resolveNeeds);

    expect([...first.entries()]).toEqual([...second.entries()]);
  });
});
