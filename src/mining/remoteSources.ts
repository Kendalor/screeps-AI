// Joins the cached remote selection (ColonyMemory.remotes) with any live vision of the remote rooms into
// the SnapRemoteSource[] the home snapshot carries. Pure: the live vision is pre-extracted into a plain
// map by the snapshot builder (the only place Game.* is read), so this stays testable with plain data.
//
// Live per-tick fields (reserved, danger, openTiles, containerId) are only known when a creep gives us
// vision of the remote room that tick. Without it we fall back to what memory recorded — reserved from the
// cached flag, danger from the cached dangerUntil (an invader's own ticksToLive, so losing vision doesn't
// heal the room early), openTiles to a default, container to the recorded id.

import type { RemoteMemory } from "../memory/schema";
import type { SnapRemoteSource, SnapStructure } from "../snapshot/types";

// The NPC username a STRUCTURE_INVADER_CORE reserves a controller under. Shared so every reservedBy/owner
// comparison (observeRoom's `hostile`, pickRemotes' selection gate, remoteInvaderAttacks' target detection)
// treats it the same way: a room the Invader NPC holds is not "owned/reserved by a player" for any of
// those purposes, even though it's still not staffable (see SnapRemoteSource.reservedBy).
export const INVADER_USERNAME = "Invader";

// What live vision of a remote room contributes this tick. Absent for a room no creep is standing in.
export interface RemoteRoomVision {
  reserved: boolean; // controller.reservation is us
  // Username currently holding the controller reservation, when it isn't us (e.g. "Invader"). Undefined
  // when unreserved or reserved by us — see `reserved` above for that case.
  reservedBy?: string;
  danger: number; // hostile count in the room right now
  // Game.time until which the room's hostiles are expected to still be present — the max of their own
  // ticksToLive, so losing vision (e.g. the miner that saw them dies) doesn't reset danger to "safe"
  // before the invader that caused it actually leaves. Undefined when danger is 0.
  dangerUntil: number | undefined;
  openTilesBySource: Partial<Record<Id<Source>, number>>; // walkable tiles adjacent, per source
  containerBySource: Partial<Record<Id<Source>, Id<StructureContainer>>>; // built drop container, per source
  // Room-wide (not per-source) — the construction arbiter's dedup source for a remote claim. Not
  // threaded onto SnapRemoteSource; the snapshot builder copies these straight onto ColonySnapshot's
  // remoteStructures/remoteSites, keyed by room, since a room can host several mined sources sharing one
  // structure list.
  structures: SnapStructure[];
  sites: SnapStructure[];
}

// A source we've selected but have no adjacency data for yet defaults to this many open tiles — enough to
// not clamp the first miner to zero before a creep actually measures the room.
const DEFAULT_OPEN_TILES = 3;

export function buildRemoteSources(
  remotes: readonly RemoteMemory[],
  vision: Partial<Record<string, RemoteRoomVision>>,
  now: number
): SnapRemoteSource[] {
  const out: SnapRemoteSource[] = [];
  for (const remote of remotes) {
    const live = vision[remote.room];
    // No vision this tick: danger stays live until the last-seen invader's own ticksToLive runs out,
    // instead of resetting to 0 the instant we can no longer see the room.
    const danger = live ? live.danger : remote.dangerUntil !== undefined && remote.dangerUntil > now ? 1 : 0;
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
        // Live vision wins when present; otherwise fall back to the persisted memory value. Unlike
        // dangerUntil, a reservation doesn't decay on its own — no time-based expiry here, it only
        // clears the next time the room is seen with no foreign reservation (see recordRemoteDanger).
        reservedBy: live ? live.reservedBy : remote.reservedBy,
        danger,
        route: src.route
      });
    }
  }
  return out;
}
