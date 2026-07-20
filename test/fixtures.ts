// Snapshot fixtures for planner tests — plain objects, no game engine.

import type {
  ColonySnapshot,
  EmpireSnapshot,
  SnapContainer,
  SnapSpawn,
  SnapTower,
  SnapUnit
} from "../src/snapshot/types";

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
    sources: 1,
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
