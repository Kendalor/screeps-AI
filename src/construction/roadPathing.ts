// Cost-matrix construction for connecting a stamped bunker (stamp.ts) to sources and the controller.
// Pure/unit-testable — no Game access. The hand-rolled A* that used to live here (sourceRoadPath/
// controllerRoadPath/controllerContainerPath) is gone: every caller now goes through
// construction/planner.ts's findPath (real PathFinder.search) instead — see that module's own doc.
// This file's remaining job is just the RoadCostMatrix builder, still used by logistics/index.ts's
// live-structures distance queries (a different matrix-source rule than the planner's plan-only one,
// deliberately — see that call site's own doc).

import { RoadCostMatrix } from "../lib/pathing";
import type { PlacedStructure } from "./stamp";

const IMPASSABLE = 255;
const ROAD_COST = 1;
// Strictly more than ROAD_COST so an A* tie always prefers reusing a built/planned road over cutting
// a fresh line across raw ground — otherwise a route can drift off already-built infrastructure on
// any equal-length alternative, stranding the old road unclaimed and getting it demolished as stale.
const PLAIN_COST = 2;

// A miner stands *on* its container while working, so it must not be treated as an obstacle.
const WALKABLE_STRUCTURES = new Set<BuildableStructureConstant>(["road", "container", "rampart"]);

export type { RoadCostMatrix };

export interface RoomFixture {
  terrain: Uint8Array; // 1 = walkable, 0 = wall, indexed [x*50+y]
  structures: PlacedStructure[];
}

export function buildCostMatrix(room: RoomFixture): RoadCostMatrix {
  const cm = new RoadCostMatrix();
  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      cm.set(x, y, room.terrain[x * 50 + y] === 0 ? IMPASSABLE : PLAIN_COST);
    }
  }
  for (const s of room.structures) {
    // A road claim can never make a real wall tile walkable — Screeps refuses a road construction site
    // on a wall in the first place, so a "road" entry landing there is always bogus input (e.g. a
    // caller accidentally mixing in a claim from a different room whose coordinates happen to collide
    // with this room's — confirmed live on W47N14 2026-08-13, where a remote-route road claim leaked
    // into the home room's structures list this way and let A* "tunnel" straight through a wall). Wall
    // terrain wins over any structure entry, road included.
    if (room.terrain[s.x * 50 + s.y] === 0) continue;
    if (s.type === "road") {
      cm.set(s.x, s.y, ROAD_COST);
    } else if (!WALKABLE_STRUCTURES.has(s.type)) {
      cm.set(s.x, s.y, IMPASSABLE);
    }
  }
  return cm;
}
