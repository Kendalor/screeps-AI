// The body-sizing context every requester passes to roleDef().body. Exported so a caller
// reconstructing a workforce (integration seeding) sizes bodies exactly as the requesters would.

import type { BodyContext } from "../behaviors/types";
import type { ColonySnapshot } from "../snapshot/types";

// sourceId narrows hasContainer/hasContainerSite to one source's own tile — a miner's body must reflect
// what sits at ITS source, not "does any source in the colony have a container" (which a multi-source
// room, or a remote source sharing this call, would answer wrong). Omitted, it falls back to "any
// source", preserving every other caller (builder/upgrader/etc., which don't key off a single source).
//
// roads defaults to controllerLevel >= 5 rather than false: a colony has been building for a while by
// RCL5 and its home routes are typically paved by then. Previously this asked the planner's own
// roadsBuilt verdict (ColonyMemory.roadsBuilt, construction/planner.ts), which required storage AND
// every last claimed road built — a single unbuilt remote road could hold it false indefinitely, long
// after the colony's own home routes were realistically usable. A caller sizing a body that never leaves
// the home room (or that deliberately wants the off-road-safe ratio regardless of road state) can still
// pass an explicit value.
export function bodyContext(colony: ColonySnapshot, roads = colony.controllerLevel >= 5, sourceId?: Id<Source>): BodyContext {
  return {
    // Only a SOURCE container flips a miner onto the container-miner body — the controller container is a
    // hauler's deposit target, no miner ever stands on it, so it must not count here.
    hasContainer: hasSourceContainer(colony, sourceId),
    hasLink: colony.structures.some(s => s.type === STRUCTURE_LINK),
    hasContainerSite: hasSourceContainerSite(colony, sourceId),
    roads,
    controllerLevel: colony.controllerLevel
  };
}

// Adjacency test shared by the built-container and container-site checks: a container tile counts only
// when it sits next to one of the room's sources (or, if sourceId is given, that source specifically),
// i.e. it's a source container a miner stands on.
function adjacentToSource(colony: ColonySnapshot, x: number, y: number, sourceId?: Id<Source>): boolean {
  const sources = sourceId ? colony.sources.filter(s => s.id === sourceId) : colony.sources;
  return sources.some(source => Math.abs(source.x - x) <= 1 && Math.abs(source.y - y) <= 1);
}

// True when a built container sits adjacent to a source. Excludes the controller container (range 2 of
// the controller, never adjacent to a source), so it can't push a source's miner onto the container body.
function hasSourceContainer(colony: ColonySnapshot, sourceId?: Id<Source>): boolean {
  return colony.containers.some(c => adjacentToSource(colony, c.x, c.y, sourceId));
}

// True when a container construction site sits adjacent to a source — the tile a source container is
// planned on. Grants that source's miner a CARRY so it can help build (and later repair) its container.
function hasSourceContainerSite(colony: ColonySnapshot, sourceId?: Id<Source>): boolean {
  return colony.sites.some(site => site.type === STRUCTURE_CONTAINER && adjacentToSource(colony, site.x, site.y, sourceId));
}
