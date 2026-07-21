// Types for the engine's own constants table.
//
// The integration harness seeds structures and creeps straight into the mockup
// db, which means writing the exact `hits`, `storeCapacity` and lifetime values
// the engine writes when it creates those objects itself. Those live in
// @screeps/common — the same package the running server reads — so the harness
// imports them rather than restating them, and a constant that changes under us
// changes the seeded objects with it.
//
// The package ships no types of its own. Only the members the harness actually
// uses are declared; add to this list as more are needed.

declare module "@screeps/common/lib/constants" {
  export const CREEP_LIFE_TIME: number;
  export const CARRY_CAPACITY: number;

  export const SPAWN_ENERGY_CAPACITY: number;
  export const SPAWN_HITS: number;
  /** Per-RCL energy capacity of one extension, indexed by controller level. */
  export const EXTENSION_ENERGY_CAPACITY: Record<number, number>;

  export const EXTENSION_HITS: number;
  export const TOWER_HITS: number;
  export const TOWER_CAPACITY: number;
  export const CONTAINER_HITS: number;
  export const CONTAINER_CAPACITY: number;
  export const STORAGE_HITS: number;
  export const STORAGE_CAPACITY: number;
  export const ROAD_HITS: number;
  export const RAMPART_HITS: number;
  export const WALL_HITS: number;
}
