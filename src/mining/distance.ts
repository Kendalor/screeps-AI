// Route-length estimate home storage -> remote source, in tiles. This is the single distance metric
// both remoteEconomics (haul upkeep) and Logistics (round-trip sizing) must share, or they disagree on
// whether a remote pays off. Pure — plain numbers, no Game.*.
//
// First cut is the handoff's estimate (a): rooms-apart * one crossing + how far each endpoint sits into
// its own room. No vision dependency, so it works off scout memory before any creep enters the remote.
// TODO(remote): replace with the real road path length (uses remote terrain — needs vision or a cached
// path) once benchmarks show this estimate mispricing far remotes.

import type { XY } from "../lib/geometry";
import { roomLinearDistance } from "../lib/roomName";

// Tiles to cross one room. A room is 50x50; a straight traversal edge-to-edge is ~50 tiles.
export const ROOM_CROSSING_TILES = 50;

const ROOM_CENTER = 25;

// How far a tile sits into its room, as a stand-in for the in-room leg to/from the exit. 0 at the
// center, growing toward the edges (Chebyshev to center). Coarse on purpose — see the module note.
function insetFromCenter(p: XY): number {
  return Math.max(Math.abs(p.x - ROOM_CENTER), Math.abs(p.y - ROOM_CENTER));
}

export interface RemoteDistanceInput {
  home: string; // home room name (where storage/anchor is)
  remote: string; // the remote room the source lives in
  source: XY; // source position in the remote room's coordinate space
  storage: XY; // home storage/anchor position in the home room's coordinate space
}

export function remoteDistanceEstimate(input: RemoteDistanceInput): number {
  const rooms = roomLinearDistance(input.home, input.remote);
  return rooms * ROOM_CROSSING_TILES + insetFromCenter(input.source) + insetFromCenter(input.storage);
}
