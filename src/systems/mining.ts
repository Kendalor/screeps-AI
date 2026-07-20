// Mining: per-source infrastructure. Ported from
// legacy/empire/operations/economy/MinerOperation.ts (getBuildingList).
//
//   - `minedStructures` — the container/link each source wants, collected by
//     systems/building.ts. Mining never places sites itself: one system owns
//     construction, so the planner sees every wanted tile (including these)
//     before it gates roads.
//   - `planMining` — SourceMemory bookkeeping (spot / containerId / linkId) as
//     intents, so roles can find their mining spot without re-pathing.
//
// Source containers are *not* part of the bunker stamp — Base_2.json contains
// none by design.
//
// Pure — reads the snapshot, returns plain data, never touches Game.*/Memory.

import type { Intent } from "../intents/types";
import { buildCostMatrix, sourceRoadPath } from "../layouts/roads";
import type { PlacedStructure } from "../layouts/stamp";
import type { XY } from "../lib/geometry";
import type { ColonySnapshot, EmpireSnapshot, SnapSource } from "../snapshot/types";

// Containers appear as soon as the room can pay for a miner + hauler pair.
// Deliberately *not* gated on storage the way legacy was: the container-backed
// economy is what funds storage, so gating on storage deadlocks the colony.
const MIN_CONTAINER_RCL = 2;
// From RCL7 the room has enough links to give each source one, and a link
// beats a container: the miner drops straight into the link network instead of
// needing a hauler round trip (legacy MinerOperation.getLinkPosFromPath).
const LINK_RCL = 7;

function sourceStructureType(rcl: number): BuildableStructureConstant {
  return rcl >= LINK_RCL ? "link" : "container";
}

// The one piece of real work in this module: where each source's structure
// goes. Both exported functions are thin views over it, so the spot recorded
// in memory can never disagree with the spot that gets built.
function sourceSpots(colony: ColonySnapshot): Map<SnapSource, XY> {
  const out = new Map<SnapSource, XY>();
  const anchor = colony.anchor;
  if (!anchor) return out;

  // No filtering needed: buildCostMatrix treats containers as walkable (they
  // are), so a built container doesn't deflect the path and the declared spot
  // stays a fixed point once satisfied.
  const costMatrix = buildCostMatrix({ terrain: colony.terrain, structures: colony.structures });

  for (const source of colony.sources) {
    const { structurePos } = sourceRoadPath(anchor, source, costMatrix);
    if (structurePos) out.set(source, structurePos);
  }
  return out;
}

export function minedStructures(colony: ColonySnapshot): PlacedStructure[] {
  if (colony.controllerLevel < MIN_CONTAINER_RCL) return [];

  const type = sourceStructureType(colony.controllerLevel);
  return [...sourceSpots(colony).values()].map(spot => ({ x: spot.x, y: spot.y, type }));
}

export function planMining(snap: EmpireSnapshot): Intent[] {
  const out: Intent[] = [];
  for (const colony of snap.colonies) {
    for (const [source, spot] of sourceSpots(colony)) {
      // Resolve the id of whatever is already standing on the spot, so roles
      // get a direct handle instead of scanning the room every tick.
      const container = colony.containers.find(c => c.x === spot.x && c.y === spot.y);
      out.push({
        kind: "recordSourceSpot",
        room: colony.name,
        source: source.id,
        spot: { x: spot.x, y: spot.y },
        ...(container ? { container: container.id } : {})
      });
    }
  }
  return out;
}
