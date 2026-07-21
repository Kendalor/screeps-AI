// Putting a colony into a mid-game state, so a scenario can measure one leg of
// the climb instead of re-measuring every leg before it.
//
// The problem this solves: seeding only a controller level (setControllerLevel)
// gives a room at RCL N with none of RCL N's buildings, no workforce and empty
// extensions. The bot's first act is then a *recovery* — recoveryRole fires on
// the empty census, spawns a runt body off the spawn's own 300 energy, and the
// colony re-bootstraps. Any measurement taken across that window is dominated
// by a cold start the real colony at that milestone never performs. Seeding the
// buildings alone is not enough either: the workforce and the stocked
// extensions are what make the state continuous with the leg before it.
//
// So `seedColony` reconstructs all three, and reconstructs them by asking the
// bot's own planners rather than by listing them here:
//
//   structures — `wantedStructures` (systems/building.ts), the same function the
//                tick uses to decide what to place. Layout, CONTROLLER_STRUCTURES
//                caps, the road/container gates and the source-biased extension
//                order therefore all flow through automatically.
//   workforce  — `desiredCensus` + `roleDef().body` (systems/spawning.ts), the
//                same quota and body formulas the spawner runs, so the seeded
//                creeps are the ones the colony would actually be operating.
//   energy     — a fraction of the room's real capacity, spread across spawn and
//                extensions the way filling leaves it.
//
// A scenario that seeds by hand goes stale the moment any of those change. One
// that seeds through here moves with them.

import { roleDef } from "../../src/behaviors/roles";
import { orderBody } from "../../src/behaviors/body";
import type { PlacedStructure } from "../../src/layouts/stamp";
import type { RoleName } from "../../src/memory/schema";
import type { ColonySnapshot } from "../../src/snapshot/types";
import { wantedStructures } from "../../src/systems/building";
import { bodyContext, desiredCensus } from "../../src/systems/spawning";
import type { BootedColony } from "./harness";

// Engine constants, taken from the same package the running server uses rather
// than restated — a seeded structure that disagrees with the engine's own idea
// of its hits or capacity is a subtly broken building.
import {
  CARRY_CAPACITY,
  CONTAINER_CAPACITY,
  CONTAINER_HITS,
  CREEP_LIFE_TIME,
  EXTENSION_ENERGY_CAPACITY,
  EXTENSION_HITS,
  RAMPART_HITS,
  ROAD_HITS,
  SPAWN_ENERGY_CAPACITY,
  SPAWN_HITS,
  STORAGE_CAPACITY,
  STORAGE_HITS,
  TOWER_CAPACITY,
  TOWER_HITS,
  WALL_HITS
} from "@screeps/common/lib/constants";

/** A tile key, for "is this already here" checks. */
const at = (o: { type: string; x: number; y: number }): string => `${o.type}@${o.x},${o.y}`;

// ---------------------------------------------------------------------------
// Structures
// ---------------------------------------------------------------------------

/**
 * The db attributes a *finished* structure of `type` carries, mirroring what
 * the engine writes when a construction site completes (@screeps/engine
 * processor/intents/creeps/build.js). A structure injected without them is
 * inert: an extension with no `store` is never filled, an unowned tower never
 * fires, a container with no `storeCapacity` cannot be hauled from — and the
 * colony would then be measured against buildings that exist but do nothing.
 *
 * Extensions must carry their *real* per-RCL capacity here, which is the one
 * place this deliberately diverges from `build.js`. That writes
 * `storeCapacityResource: {energy: 0}` and lets the extension processor tick
 * correct it — safe there, because a structure the processor creates is fixed up
 * before user code next runs. A seeded structure has no such grace: the runtime
 * builds `Game` first, and `makeGameObject` sums
 * `object.storeCapacityResource.energy` over every owned extension. Seeding 0
 * there gives the colony an energyCapacity of 0 for a tick; omitting the field
 * entirely crashes the bot's whole loop with "Cannot read properties of
 * undefined (reading 'energy')".
 *
 * Containers, roads and walls are unowned in Screeps and take no `user`.
 */
function structureAttrs(type: string, user: string, level: number): Record<string, unknown> {
  switch (type) {
    case "extension":
      return {
        user,
        store: { energy: 0 },
        storeCapacityResource: { energy: EXTENSION_ENERGY_CAPACITY[level] ?? 0 },
        hits: EXTENSION_HITS,
        hitsMax: EXTENSION_HITS
      };
    case "tower":
      return { user, store: { energy: 0 }, storeCapacityResource: { energy: TOWER_CAPACITY }, hits: TOWER_HITS, hitsMax: TOWER_HITS };
    case "container":
      return { store: { energy: 0 }, storeCapacity: CONTAINER_CAPACITY, hits: CONTAINER_HITS, hitsMax: CONTAINER_HITS };
    case "storage":
      return { user, store: { energy: 0 }, storeCapacity: STORAGE_CAPACITY, hits: STORAGE_HITS, hitsMax: STORAGE_HITS };
    case "road":
      return { hits: ROAD_HITS, hitsMax: ROAD_HITS };
    case "rampart":
      return { user, hits: RAMPART_HITS, hitsMax: RAMPART_HITS };
    case "constructedWall":
      return { hits: WALL_HITS, hitsMax: WALL_HITS };
    case "spawn":
      return {
        user,
        store: { energy: 0 },
        storeCapacityResource: { energy: SPAWN_ENERGY_CAPACITY },
        hits: SPAWN_HITS,
        hitsMax: SPAWN_HITS,
        spawning: null
      };
    default:
      return { user };
  }
}

/**
 * The placements in `wanted` that the room does not already satisfy, at `level`.
 *
 * Not simply "which tiles are empty". A wanted placement is also satisfied when
 * the room already holds as many of that type as the RCL permits, even on other
 * tiles. The spawn is the case that bites: the goal layout puts a spawn on the
 * bunker anchor, but `addBot` has already placed the room's real spawn wherever
 * the scenario asked for it, and `CONTROLLER_STRUCTURES.spawn` is 1 until RCL7.
 * A tile-only check therefore reports that spawn as outstanding forever — the
 * colony cannot build a second one, so seeding it gives the room two spawns and
 * double the throughput, while a benchmark waiting for it to be built waits for
 * something that can never happen.
 *
 * Shared by `seedStructures` and by scenarios computing a build target, so both
 * agree on what "this RCL is finished" means.
 */
export function outstanding(
  wanted: PlacedStructure[],
  present: { type: string; x: number; y: number }[],
  level: number
): PlacedStructure[] {
  const tiles = new Set(present.map(at));
  const countByType = new Map<string, number>();
  for (const p of present) countByType.set(p.type, (countByType.get(p.type) ?? 0) + 1);

  const out: PlacedStructure[] = [];
  for (const w of wanted) {
    if (tiles.has(at(w))) continue;
    const cap = CONTROLLER_STRUCTURES[w.type]?.[level] ?? 0;
    const have = countByType.get(w.type) ?? 0;
    if (have >= cap) continue;
    countByType.set(w.type, have + 1);
    out.push(w);
  }
  return out;
}

/**
 * Stand up every structure in `wanted` the room does not already satisfy — see
 * `outstanding`. Returns how many were injected.
 */
export async function seedStructures(colony: BootedColony, wanted: PlacedStructure[]): Promise<number> {
  const objects = await colony.roomObjects();
  const level = (await colony.controller()).level;
  const todo = outstanding(wanted, objects, level);

  for (const s of todo) {
    await colony.addStructure(s.type, s.x, s.y, structureAttrs(s.type, colony.bot.id, level));
  }
  return todo.length;
}

// ---------------------------------------------------------------------------
// Workforce
// ---------------------------------------------------------------------------

/** One seeded creep: the role it plays and the body the spawner would give it. */
export interface SeededCreep {
  name: string;
  role: RoleName;
  body: BodyPartConstant[];
  /** Ticks of life left — see `spreadTtl`. */
  ttl: number;
}

/**
 * Life left for the `n`th of `total` creeps, spread evenly across the back
 * two-thirds of a creep lifetime.
 *
 * A seeded workforce that all shares one TTL dies in one lump, and the colony
 * spends the tick after that lump in exactly the total-wipe recovery the
 * seeding exists to avoid — so the run would measure a cold start after all,
 * just delayed. Staggering them reproduces what a running colony actually looks
 * like: creeps replaced a few at a time, spawn pressure spread out. The floor at
 * a third of a lifetime keeps the oldest creep useful long enough to matter.
 */
export function spreadTtl(index: number, total: number): number {
  const floor = Math.floor(CREEP_LIFE_TIME / 3);
  if (total <= 1) return CREEP_LIFE_TIME;
  const span = CREEP_LIFE_TIME - floor;
  return Math.round(floor + (span * index) / (total - 1));
}

/**
 * The workforce this colony would be running: `desiredCensus`'s quota, with
 * each creep's body from the same `roleDef` formula the spawner uses, sized off
 * `energyCapacity` exactly as `planSpawning` sizes a non-recovery spawn.
 *
 * Pure — returns the plan without touching the world, so a scenario can assert
 * on what it is about to seed.
 */
export function plannedWorkforce(colony: ColonySnapshot): SeededCreep[] {
  const census = desiredCensus(colony);
  const context = bodyContext(colony);

  const wanted: { role: RoleName; body: BodyPartConstant[] }[] = [];
  for (const [role, count] of Object.entries(census) as [RoleName, number | undefined][]) {
    const def = roleDef(role);
    if (!def) continue;
    const body = orderBody(def.body(colony.energyCapacity, context));
    if (body.length === 0) continue;
    for (let i = 0; i < (count ?? 0); i++) wanted.push({ role, body });
  }

  return wanted.map((w, i) => ({
    name: `seed_${w.role}_${i}`,
    role: w.role,
    body: w.body,
    ttl: spreadTtl(i, wanted.length)
  }));
}

/**
 * Put `creeps` into the room and register them in the bot's Memory.
 *
 * Both halves are required and neither is sufficient: the engine only knows
 * "creep", while role and home live in the bot's own CreepMemory — a creep in
 * the world with no Memory entry is unrecognised by the census and would be
 * re-spawned; a Memory entry with no creep is reaped by the tick loop (#24).
 *
 * Creeps are placed on `spawnX/Y`-adjacent open tiles around the anchor by way
 * of the spawn position, which is where freshly spawned creeps stand anyway.
 */
export async function seedCreeps(colony: BootedColony, creeps: SeededCreep[]): Promise<number> {
  if (creeps.length === 0) return 0;
  const spawn = (await colony.structures("spawn"))[0];
  if (!spawn) throw new Error("cannot seed creeps: the colony has no spawn to place them around");

  const gameTime = await colony.server.world.gameTime;
  const spots = await openTilesNear(colony, spawn.x, spawn.y, creeps.length);

  for (let i = 0; i < creeps.length; i++) {
    const c = creeps[i];
    const spot = spots[i] ?? { x: spawn.x, y: spawn.y };
    await colony.addCreep(c.name, spot.x, spot.y, {
      body: c.body.map(type => ({ type, hits: 100 })),
      store: { energy: 0 },
      storeCapacity: c.body.filter(p => p === "carry").length * CARRY_CAPACITY,
      hits: c.body.length * 100,
      hitsMax: c.body.length * 100,
      // `spawning: false` matters — a creep left spawning never acts, and the
      // census counts it, so the colony would sit idle behind a full roster.
      spawning: false,
      fatigue: 0,
      ageTime: gameTime + c.ttl
    });
  }

  await colony.patchMemory(mem => {
    const creepMem = (mem.creeps ??= {}) as Record<string, { home: string; role: string }>;
    for (const c of creeps) creepMem[c.name] = { home: colony.room, role: c.role };
  });

  return creeps.length;
}

/**
 * `count` walkable tiles nearest `(x, y)` that no structure or creep occupies,
 * searched in expanding rings. Seeded creeps must not share a tile with a
 * structure that blocks movement, or they start the run stuck.
 */
async function openTilesNear(
  colony: BootedColony,
  x: number,
  y: number,
  count: number
): Promise<{ x: number; y: number }[]> {
  const terrain = await colony.terrain();
  const blocked = new Set(
    (await colony.roomObjects())
      .filter(o => o.type !== "road" && o.type !== "container" && o.type !== "rampart")
      .map(o => `${o.x},${o.y}`)
  );

  const out: { x: number; y: number }[] = [];
  for (let r = 1; r <= 12 && out.length < count; r++) {
    for (let dx = -r; dx <= r && out.length < count; dx++) {
      for (let dy = -r; dy <= r && out.length < count; dy++) {
        // Ring only — the interior was covered by a smaller radius.
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = x + dx;
        const ty = y + dy;
        if (tx < 1 || tx > 48 || ty < 1 || ty > 48) continue;
        if (terrain[tx * 50 + ty] === 0) continue;
        const key = `${tx},${ty}`;
        if (blocked.has(key)) continue;
        blocked.add(key);
        out.push({ x: tx, y: ty });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Energy
// ---------------------------------------------------------------------------

/**
 * Fill spawn and extensions to `fraction` of the room's energy capacity.
 *
 * A seeded colony with empty extensions can only spawn off the spawn's own 300,
 * so its first several spawns are runts regardless of the capacity the seeded
 * buildings imply — `planSpawning` sizes bodies from `energyCapacity` and then
 * refuses them because `energyAvailable` cannot pay. Starting part-full is what
 * a mid-game room actually looks like between filler round trips.
 *
 * Fills whole structures at a time rather than smearing the fraction evenly:
 * that is how filling actually leaves a room, and a half-filled extension is
 * not a state the game produces at rest. Returns the energy placed.
 */
export async function fillEnergy(colony: BootedColony, fraction: number): Promise<number> {
  const level = (await colony.controller()).level;
  const perExtension = EXTENSION_ENERGY_CAPACITY[level] ?? 0;

  const spawns = await colony.structures("spawn");
  const extensions = await colony.structures("extension");
  const capacity = spawns.length * SPAWN_ENERGY_CAPACITY + extensions.length * perExtension;
  let budget = Math.round(capacity * fraction);

  let placed = 0;
  for (const s of spawns) {
    const put = Math.min(budget, SPAWN_ENERGY_CAPACITY);
    if (put <= 0) break;
    await colony.setStore(s._id as string, put);
    budget -= put;
    placed += put;
  }
  for (const e of extensions) {
    const put = Math.min(budget, perExtension);
    if (put <= 0) break;
    await colony.setStore(e._id as string, put);
    budget -= put;
    placed += put;
  }
  return placed;
}

// ---------------------------------------------------------------------------
// The whole state
// ---------------------------------------------------------------------------

export interface SeedOptions {
  /** Controller level to seed. The structure set and bodies derive from it. */
  level: number;
  /** Controller progress toward the next level. Default 0 — a clean start. */
  progress?: number;
  /**
   * Fraction of the room's spawn+extension capacity to start stocked with.
   * Default 0.7 — part-full, as a running room sits between filler trips.
   */
  energyFraction?: number;
}

export interface SeededState {
  structures: PlacedStructure[];
  creeps: SeededCreep[];
  energy: number;
}

/**
 * Put `colony` into the state a real colony occupies at `level`: every
 * structure it wants there, the workforce it would be running, and part-stocked
 * extensions — so a scenario starting here measures the leg that follows rather
 * than a recovery from an empty room.
 *
 * The colony must already have cached its bunker anchor (run a few ticks after
 * `boot()`), since the anchor is the frame the whole layout is stamped onto.
 * Throws rather than silently seeding nothing if it has not.
 */
export async function seedColony(colony: BootedColony, opts: SeedOptions): Promise<SeededState> {
  const { level, progress = 0, energyFraction = 0.7 } = opts;

  // Level first: both the buildable caps and the body budgets read it.
  await colony.setControllerLevel(level, progress);

  const snapshot = await colony.layoutSnapshot();
  if (!snapshot.anchor) {
    throw new Error("cannot seed: the colony has not cached a bunker anchor yet — run a few ticks after boot()");
  }

  const structures = wantedStructures(snapshot);
  await seedStructures(colony, structures);

  // Re-read after building: energyCapacity and the container-dependent body
  // context both depend on what now stands, so the workforce is sized against
  // the seeded room rather than the empty one.
  const built = await colony.layoutSnapshot();
  const creeps = plannedWorkforce({
    ...built,
    energyCapacity: await colony.energyCapacity(),
    containers: (await colony.structures("container")).map((c, i) => ({
      id: `seed-container-${i}` as Id<StructureContainer>,
      x: c.x,
      y: c.y,
      storeEnergy: 0,
      storeCapacity: CONTAINER_CAPACITY
    }))
  });
  await seedCreeps(colony, creeps);

  const energy = await fillEnergy(colony, energyFraction);
  return { structures, creeps, energy };
}
