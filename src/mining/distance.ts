// Route-length estimate home storage -> remote source, in tiles. This is the cheap ranking metric
// pickRemotes uses to sort/filter every scouted candidate every throttle tick without touching Game.* —
// the real PathFinder path (see src/lib/remotePath.ts) is only computed once, for whichever source
// actually gets selected, and cached from then on. Both remoteEconomics (haul upkeep) and Logistics
// (round-trip sizing) key off whichever of the two is currently recorded.
//
// rooms-apart * one crossing + how far each endpoint sits into its own room. No vision dependency, so it
// works off scout memory before any creep enters the remote.

import type { XY } from "../lib/geometry";

// Tiles to cross one room. A room is 50x50; a straight traversal edge-to-edge is ~50 tiles.
export const ROOM_CROSSING_TILES = 50;

const ROOM_CENTER = 25;

// How far a tile sits into its room, as a stand-in for the in-room leg to/from the exit. 0 at the
// center, growing toward the edges (Chebyshev to center). Coarse on purpose — see the module note.
function insetFromCenter(p: XY): number {
  return Math.max(Math.abs(p.x - ROOM_CENTER), Math.abs(p.y - ROOM_CENTER));
}

export interface RemoteDistanceInput {
  // Real room-graph hops home -> remote (see scoutGraph.ts's BFS) — never a Chebyshev/linear-distance
  // recomputation, which misprices a diagonal room as distance 1 even though a room only connects to
  // its N/S/E/W neighbours.
  roomDistance: number;
  source: XY; // source position in the remote room's coordinate space
  storage: XY; // home storage/anchor position in the home room's coordinate space
}

export function remoteDistanceEstimate(input: RemoteDistanceInput): number {
  return input.roomDistance * ROOM_CROSSING_TILES + insetFromCenter(input.source) + insetFromCenter(input.storage);
}
