// Types for @screeps/common's constants table (ships no types of its own). The harness imports
// these rather than restating them, so a constant that changes under us changes seeded objects too.
// Only the members actually used are declared; add more as needed.

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
  export const LAB_ENERGY_CAPACITY: number;
  export const LAB_MINERAL_CAPACITY: number;
  export const LAB_HITS: number;
  export const LINK_CAPACITY: number;
  export const LINK_HITS: number;
  export const TERMINAL_CAPACITY: number;
  export const TERMINAL_HITS: number;
  /** Controller progress required to advance FROM the given level, indexed by controller level. */
  export const CONTROLLER_LEVELS: Record<number, number>;
  export const COLOR_WHITE: number;
}
