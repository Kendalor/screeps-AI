// The body-sizing context every requester passes to roleDef().body. Exported so a caller
// reconstructing a workforce (integration seeding) sizes bodies exactly as the requesters would.

import type { BodyContext } from "../behaviors/types";
import type { ColonySnapshot } from "../snapshot/types";

export function bodyContext(colony: ColonySnapshot, roads = false): BodyContext {
  return {
    // Only a SOURCE container flips a miner onto the container-miner body — the controller container is a
    // hauler's deposit target, no miner ever stands on it, so it must not count here.
    hasContainer: hasSourceContainer(colony),
    hasLink: colony.structures.some(s => s.type === STRUCTURE_LINK),
    hasContainerSite: hasSourceContainerSite(colony),
    roads
  };
}

// Adjacency test shared by the built-container and container-site checks: a container tile counts only
// when it sits next to one of the room's sources, i.e. it's a source container a miner stands on.
function adjacentToSource(colony: ColonySnapshot, x: number, y: number): boolean {
  return colony.sources.some(source => Math.abs(source.x - x) <= 1 && Math.abs(source.y - y) <= 1);
}

// True when a built container sits adjacent to a source. Excludes the controller container (range 2 of
// the controller, never adjacent to a source), so it can't push a source's miner onto the container body.
function hasSourceContainer(colony: ColonySnapshot): boolean {
  return colony.containers.some(c => adjacentToSource(colony, c.x, c.y));
}

// True when a container construction site sits adjacent to a source — the tile a source container is
// planned on. Grants that source's miner a CARRY so it can help build (and later repair) its container.
function hasSourceContainerSite(colony: ColonySnapshot): boolean {
  return colony.sites.some(site => site.type === STRUCTURE_CONTAINER && adjacentToSource(colony, site.x, site.y));
}
