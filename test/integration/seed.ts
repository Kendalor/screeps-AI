// Puts a colony into a mid-game state, so a scenario can measure one leg of the climb instead of
// re-measuring every leg before it (seeding only the controller level would trigger a recovery
// cold-start instead, since there's no workforce or stocked extensions).
//
// `seedColony` reconstructs structures, workforce and energy by asking the bot's own planners
// (`wantedStructures` and the spawn requesters) rather than listing them here, so a scenario seeded
// through here moves automatically with layout/quota/body changes.

import type { PlacedStructure } from "../../src/layouts/stamp";
import type { RoleName } from "../../src/memory/schema";
import type { ColonySnapshot } from "../../src/snapshot/types";
import { builderRequests, wantedStructures } from "../../src/systems/building";
import { operationsFor } from "../../src/operations";
import { bootstrapRequests } from "../../src/systems/spawning";
import { upgraderRequests } from "../../src/systems/upgrading";
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

// Attributes a *finished* structure needs to not be inert (store, storeCapacity, hits, ...).
// Extensions specifically need their real per-RCL storeCapacityResource seeded — unlike the
// engine's own build.js, there's no processor tick to fix up a 0 before makeGameObject sums it,
// and omitting the field entirely crashes the bot's loop.
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

// Not simply "which tiles are empty" — a placement is also satisfied once the room holds as many
// of that type as the RCL cap allows, even on a different tile (otherwise an off-layout spawn
// makes the layout's own spawn slot look outstanding forever, since the colony can't build a second).
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

/** One seeded creep: the body the spawner would give it and the memory it would carry. */
export interface SeededCreep {
  name: string;
  role: RoleName;
  /** The requesting memory verbatim, so a seeded creep is claimed by its requester exactly as a spawned one is. */
  memory: CreepMemory;
  body: BodyPartConstant[];
  /** Ticks of life left — see `spreadTtl`. */
  ttl: number;
}

// Staggers TTLs across the back two-thirds of a creep lifetime — a shared TTL would make the
// whole seeded workforce die in one lump, reproducing the cold-start recovery seeding avoids.
export function spreadTtl(index: number, total: number): number {
  const floor = Math.floor(CREEP_LIFE_TIME / 3);
  if (total <= 1) return CREEP_LIFE_TIME;
  const span = CREEP_LIFE_TIME - floor;
  return Math.round(floor + (span * index) / (total - 1));
}

// Pure — returns the plan without touching the world, so a scenario can assert on what it will seed.
//
// Asks the requesters themselves what the colony is missing, so the seeded workforce moves with the
// quotas rather than being restated here. Recovery is excluded deliberately: it only fires on a
// wipe, and seeding is the opposite of a wipe.
//
// Caveat worth knowing when reading a seeded scenario: `colony` here comes from layoutSnapshot(),
// whose `creeps` is always empty, so every satisfaction check sees a colony with nothing alive.
// That lands on the cold-start branches — miner demand is clamped to the one-miner floor because no
// hauler exists, and hauler demand is zero because seeded containers start empty. This is what
// the census-based version did too, so scenarios are unchanged; it is *not* the steady-state
// workforce a running RCL3 colony fields.
export function plannedWorkforce(colony: ColonySnapshot): SeededCreep[] {
  const wrapped = { snapshot: colony, operations: operationsFor(colony.name) };
  const requests = [
    ...bootstrapRequests(wrapped),
    // The operations' own demand, polled exactly as planSpawning polls it.
    ...wrapped.operations.flatMap(op => op.desiredCreeps(colony)),
    ...upgraderRequests(wrapped),
    ...builderRequests(wrapped)
  ].filter(r => r.body.length > 0);

  return requests.map((r, i) => ({
    name: `seed_${r.memory.role}_${i}`,
    role: r.memory.role,
    memory: r.memory,
    body: r.body,
    ttl: spreadTtl(i, requests.length)
  }));
}

// Both the world object and the Memory entry are required: a creep with no Memory is
// unrecognised by the census and gets re-spawned; a Memory entry with no creep gets reaped.
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
      // A creep left spawning never acts but still counts toward the census.
      spawning: false,
      fatigue: 0,
      ageTime: gameTime + c.ttl
    });
  }

  await colony.patchMemory(mem => {
    const creepMem = (mem.creeps ??= {}) as Record<string, CreepMemory>;
    // home comes from the request, not from the room being seeded: a request's own `home` is what
    // binds the creep to its sponsoring colony.
    for (const c of creeps) creepMem[c.name] = { ...c.memory };
  });

  return creeps.length;
}

// `count` walkable tiles nearest (x, y) that no structure or creep occupies, in expanding rings.
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

// Fills whole structures at a time (not smeared evenly) — that's how a real room fills, and
// starting part-full avoids the seeded colony's first several spawns being runts off just the
// spawn's own 300 energy.
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
  /** Controller progress toward the next level. Default 0. */
  progress?: number;
  /** Fraction of the room's spawn+extension capacity to start stocked with. Default 0.7. */
  energyFraction?: number;
}

export interface SeededState {
  structures: PlacedStructure[];
  creeps: SeededCreep[];
  energy: number;
}

// Colony must already have cached its bunker anchor (run a few ticks after boot()) — throws
// rather than silently seeding nothing if it has not.
export async function seedColony(colony: BootedColony, opts: SeedOptions): Promise<SeededState> {
  const { level, progress = 0, energyFraction = 0.7 } = opts;

  // Level first: both the buildable caps and the body budgets read it.
  await colony.setControllerLevel(level, progress);

  const snapshot = await colony.layoutSnapshot();
  if (!snapshot.anchor) {
    throw new Error("cannot seed: the colony has not cached a bunker anchor yet — run a few ticks after boot()");
  }

  // Operations' claims are passed in, as planBuilding does — without them the seed builds the bunker
  // stamp but none of mining's source containers.
  const structures = wantedStructures(
    snapshot,
    operationsFor(snapshot.name).flatMap(op => op.structures(snapshot))
  );
  await seedStructures(colony, structures);

  // Re-read after building so the workforce is sized against the seeded room, not the empty one.
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
