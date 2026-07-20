// Snapshot fixtures for planner tests — plain objects, no game engine.

import type {
  ColonySnapshot,
  EmpireSnapshot,
  SnapContainer,
  SnapSource,
  SnapSpawn,
  SnapTower,
  SnapUnit
} from "../src/snapshot/types";

// All-walkable terrain — the default for planner fixtures that don't care
// about walls. Tests exercising pathing around obstacles carve their own.
export function openTerrain(): Uint8Array {
  return new Uint8Array(2500).fill(1);
}

export function sourceAt(x: number, y: number, id = `source_${x}_${y}`): SnapSource {
  return { id: id as Id<Source>, x, y };
}

export function empire(...colonies: ColonySnapshot[]): EmpireSnapshot {
  return { tick: 0, colonies };
}

export function colony(over: Partial<ColonySnapshot> = {}): ColonySnapshot {
  return {
    name: "W1N1",
    towers: [],
    hostiles: [],
    woundedFriendlies: [],
    safeModeAvailable: false,
    census: {},
    spawns: [],
    energyAvailable: 300,
    energyCapacity: 300,
    sources: [sourceAt(20, 10)],
    terrain: openTerrain(),
    controllerLevel: 1,
    controllerProgress: 0,
    storageEnergy: 0,
    containers: [],
    anchor: null,
    structures: [],
    sites: [],
    constructionProgress: 0,
    ...over
  };
}

export function hostileAt(x: number, y: number, id = `hostile_${x}_${y}`): SnapUnit {
  return { id: id as Id<Creep>, x, y, hits: 100, hitsMax: 100 };
}

export function woundedAt(x: number, y: number, id = `wounded_${x}_${y}`): SnapUnit {
  return { id: id as Id<Creep>, x, y, hits: 50, hitsMax: 100 };
}

export function towerAt(x: number, y: number, id = `tower_${x}_${y}`): SnapTower {
  return { id: id as Id<StructureTower>, x, y };
}

export function containerAt(
  x: number,
  y: number,
  storeEnergy = 0,
  id = `container_${x}_${y}`
): SnapContainer {
  return { id: id as Id<StructureContainer>, x, y, storeEnergy, storeCapacity: 2000 };
}

export function spawn(id = "spawn1", busy = false): SnapSpawn {
  return { id: id as Id<StructureSpawn>, busy };
}
