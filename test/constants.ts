// Stubs the Screeps global constants for unit tests (see docs/rewrite-skeleton.md §8).
// @types/screeps declares these as ambient globals; the game engine provides them at
// runtime. Tests run in plain node, so we define the ones src/ actually references.
// Add here as new systems need them.

Object.assign(globalThis, {
  OK: 0,
  ERR_NOT_OWNER: -1,
  ERR_NO_PATH: -2,
  ERR_NAME_EXISTS: -3,
  ERR_BUSY: -4,
  ERR_NOT_FOUND: -5,
  ERR_NOT_ENOUGH_ENERGY: -6,
  ERR_NOT_ENOUGH_RESOURCES: -6,
  ERR_INVALID_TARGET: -7,
  ERR_FULL: -8,
  ERR_NOT_IN_RANGE: -9,
  ERR_INVALID_ARGS: -10,
  ERR_TIRED: -11,
  ERR_NO_BODYPART: -12,
  ERR_RCL_NOT_ENOUGH: -14,
  ERR_GCL_NOT_ENOUGH: -15,

  RESOURCE_ENERGY: "energy",

  FIND_CREEPS: 101,
  FIND_MY_CREEPS: 102,
  FIND_HOSTILE_CREEPS: 103,
  FIND_SOURCES_ACTIVE: 104,
  FIND_SOURCES: 105,
  FIND_DROPPED_RESOURCES: 106,
  FIND_STRUCTURES: 107,
  FIND_MY_STRUCTURES: 108,
  FIND_CONSTRUCTION_SITES: 111,
  FIND_MY_CONSTRUCTION_SITES: 114,
  FIND_TOMBSTONES: 118,

  STRUCTURE_SPAWN: "spawn",
  STRUCTURE_EXTENSION: "extension",
  STRUCTURE_ROAD: "road",
  STRUCTURE_WALL: "constructedWall",
  STRUCTURE_RAMPART: "rampart",
  STRUCTURE_LINK: "link",
  STRUCTURE_STORAGE: "storage",
  STRUCTURE_TOWER: "tower",
  STRUCTURE_CONTAINER: "container",
  STRUCTURE_CONTROLLER: "controller",
  STRUCTURE_TERMINAL: "terminal",

  WORK: "work",
  CARRY: "carry",
  MOVE: "move",
  ATTACK: "attack",
  RANGED_ATTACK: "ranged_attack",
  HEAL: "heal",
  CLAIM: "claim",
  TOUGH: "tough"
});
