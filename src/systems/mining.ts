// Mining: per-source infrastructure. minedStructures declares each source's container/link (mining never places sites itself —
// systems/building.ts owns construction); planMining records source-spot bookkeeping as intents so roles avoid re-pathing.
// Pure — reads the snapshot, returns plain data, never touches Game.*/Memory.

import type { Intent } from "../intents/types";
import { buildCostMatrix, sourceRoadPath } from "../layouts/roads";
import type { PlacedStructure } from "../layouts/stamp";
import type { XY } from "../lib/geometry";
import type { ColonySnapshot, EmpireSnapshot, SnapSource } from "../snapshot/types";

// Deliberately not gated on storage: the container-backed economy is what funds storage, so gating on it would deadlock the colony.
const MIN_CONTAINER_RCL = 2;
// A link beats a container from RCL7: the miner drops straight into the link network instead of needing a hauler round trip.
const LINK_RCL = 7;

function sourceStructureType(rcl: number): BuildableStructureConstant {
  return rcl >= LINK_RCL ? "link" : "container";
}

// Both exported functions are thin views over this, so the recorded spot can never disagree with the built spot.
function sourceSpots(colony: ColonySnapshot): Map<SnapSource, XY> {
  const out = new Map<SnapSource, XY>();
  const anchor = colony.anchor;
  if (!anchor) return out;

  // buildCostMatrix treats containers as walkable, so a built container doesn't deflect the path off the declared spot.
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
      // Direct id handle so roles avoid scanning the room every tick.
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
