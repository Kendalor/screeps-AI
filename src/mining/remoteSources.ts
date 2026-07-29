// Joins the cached remote selection (ColonyMemory.remotes) with any live vision of the remote rooms into
// the SnapRemoteSource[] the home snapshot carries. Pure: the live vision is pre-extracted into a plain
// map by the snapshot builder (the only place Game.* is read), so this stays testable with plain data.
//
// Live per-tick fields (reserved, danger, openTiles, containerId) are only known when a creep gives us
// vision of the remote room that tick. Without it we fall back to what memory recorded — reserved from the
// cached flag, danger to 0, openTiles to a default, container to the recorded id.

import type { RemoteMemory } from "../memory/schema";
import type { SnapRemoteSource } from "../snapshot/types";

// What live vision of a remote room contributes this tick. Absent for a room no creep is standing in.
export interface RemoteRoomVision {
  reserved: boolean; // controller.reservation is us
  danger: number; // hostile count (or any danger metric) in the room right now
  openTilesBySource: Partial<Record<Id<Source>, number>>; // walkable tiles adjacent, per source
  containerBySource: Partial<Record<Id<Source>, Id<StructureContainer>>>; // built drop container, per source
}

// A source we've selected but have no adjacency data for yet defaults to this many open tiles — enough to
// not clamp the first miner to zero before a creep actually measures the room.
const DEFAULT_OPEN_TILES = 3;

export function buildRemoteSources(
  remotes: readonly RemoteMemory[],
  vision: Partial<Record<string, RemoteRoomVision>>
): SnapRemoteSource[] {
  const out: SnapRemoteSource[] = [];
  for (const remote of remotes) {
    const live = vision[remote.room];
    for (const src of remote.sources) {
      out.push({
        id: src.id,
        room: remote.room,
        x: src.x,
        y: src.y,
        distance: src.distance,
        openTiles: live?.openTilesBySource[src.id] ?? DEFAULT_OPEN_TILES,
        containerId: live?.containerBySource[src.id] ?? src.containerId,
        reserved: live?.reserved ?? remote.reserved,
        danger: live?.danger ?? 0
      });
    }
  }
  return out;
}
