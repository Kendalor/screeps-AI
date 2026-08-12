// The body-sizing context every requester passes to roleDef().body. Exported so a caller
// reconstructing a workforce (integration seeding) sizes bodies exactly as the requesters would.

import type { BodyContext } from "../behaviors/types";
import type { ColonySnapshot } from "../snapshot/types";

// sourceId narrows hasContainer/hasContainerSite to one source's own tile — a miner's body must reflect
// what sits at ITS source, not "does any source in the colony have a container" (which a multi-source
// room, or a remote source sharing this call, would answer wrong). Omitted, it falls back to "any
// source", preserving every other caller (builder/upgrader/etc., which don't key off a single source).
//
// roads defaults to allRemoteRoutesBuilt(colony) rather than false: mining.ts's road claims run
// source-outward from the home anchor (see Mining.structures), so a remote source's route[] spans the
// full home->source path — its routeBuilt reaching all-"1" means the home-room leg is paved too, not
// just the remote room's own tiles. A caller sizing a body that never leaves the home room (or that
// deliberately wants the off-road-safe ratio regardless of road state) can still pass an explicit value.
export function bodyContext(colony: ColonySnapshot, roads = allRemoteRoutesBuilt(colony), sourceId?: Id<Source>): BodyContext {
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

// True once every currently-selected remote source's route is fully paved (routeBuilt is all "1"s) —
// see the roads doc above for why that also certifies the home-room leg. False (never "roads=true") with
// no remote selected yet: there is no route to confirm built, and a colony's very first remote source
// spawns straight into an unpaved route, so the off-road-safe 1:1 ratio must stay the default until proven otherwise.
function allRemoteRoutesBuilt(colony: ColonySnapshot): boolean {
  if (colony.remoteSources.length === 0) return false;
  return colony.remoteSources.every(source => {
    const route = source.route;
    if (!route || route.length === 0) return false;
    const built = source.routeBuilt ?? "";
    return route.every((_, i) => built[i] === "1");
  });
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
