// MineralMining owns getting mineral out of the ground: the extractor, its container, and the
// mineralMiner that works it. Transport off the container is Logistics' job (see operations/logistics.ts),
// same split as energy Mining/Logistics. Pure — reads the snapshot only. New, sibling module to
// operations/mining.ts rather than folded into it — a mineral deposit is exactly one per room with a
// cooldown-gated yield, a genuinely different shape from a source's continuous regen and per-source WORK
// math (see docs/boosting-reactions-plan.md's M0 section for the fuller design record).

import type { Intent } from "../intents/types";
import type { FindPath } from "../construction/planner";
import type { PlacedStructure } from "../construction/stamp";
import type { ColonySnapshot } from "../snapshot/types";
import type { CreepRequest } from "../spawn/request";
import { Operation } from "./operation";

// The real engine requirement for STRUCTURE_EXTRACTOR — not an energy-capacity proxy the way Mining's
// container gate is (see mining.ts's CONTAINERS_FROM_ENERGY_CAPACITY doc): an extractor already has an
// RCL requirement to check directly, so no proxy is needed.
const EXTRACTOR_RCL = 6;

const CONTAINER: BuildableStructureConstant = "container";
const EXTRACTOR: BuildableStructureConstant = "extractor";
const ROAD: BuildableStructureConstant = "road";

export class MineralMining extends Operation {
  public readonly kind = "mineralMining";

  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    return this.minerRequest(colony);
  }

  /**
   * At most one mineralMiner, requested once the extractor and container both exist and the deposit
   * isn't currently depleted — spending ticks trying to harvest a deposit that can't yield is pointless.
   * No storage-fullness gate: mining runs unconditionally once structures exist (see this milestone's Out
   * of Scope — shortfall logic belongs to later milestones, not the producer).
   *
   * The depletion check reads the cached regeneratesAt (see intents(), below) rather than
   * colony.mineral.ticksToRegeneration directly: a live read only works while the deposit is visible,
   * which the home room always is today but a future remote/keeper-room mineral (assignedMineral's whole
   * reason for existing — see behaviors/types.ts) won't be every tick. Cached, this early-cancel keeps
   * working the same way census/metrics could read it without re-deriving anything.
   */
  private minerRequest(colony: ColonySnapshot): CreepRequest[] {
    const mineral = colony.mineral;
    if (!mineral || !mineral.extractorId || !mineral.containerId) return [];
    if (mineral.mineralAmount === 0) return [];
    const regeneratesAt = colony.mineralMemory.regeneratesAt;
    if (regeneratesAt !== undefined && regeneratesAt > colony.tick) return [];

    return this.fillRole(colony, "mineralMiner", 1, 40);
  }

  /** The extractor and its container, plus the road that reaches it. Never places sites — only claims. */
  public override structures(colony: ColonySnapshot, findPath: FindPath): PlacedStructure[] {
    if (colony.controllerLevel < EXTRACTOR_RCL) return [];
    const mineral = colony.mineral;
    const anchor = colony.anchor;
    if (!mineral || !anchor) return [];

    const anchorPos = new RoomPosition(anchor.x, anchor.y, colony.name);
    const mineralPos = new RoomPosition(mineral.x, mineral.y, colony.name);
    const route = findPath(anchorPos, mineralPos, 1);
    if (route.path.length === 0) return []; // no path found; findPath already logged

    const out: PlacedStructure[] = [
      { x: mineral.x, y: mineral.y, type: EXTRACTOR },
      { x: route.structurePos.x, y: route.structurePos.y, type: CONTAINER }
    ];
    // Same source-outward ordering as Mining's own claims: nearest-the-deposit tiles first.
    const roadTiles = route.path.slice(0, -1);
    for (let i = roadTiles.length - 1; i >= 0; i--) {
      out.push({ x: roadTiles[i].x, y: roadTiles[i].y, type: ROAD });
    }
    return out;
  }

  /**
   * Caches the deposit's regeneration deadline (see MineralMemory's own doc) whenever this tick's live
   * read disagrees with what's already recorded — moves both up (newly depleted) and down (regen
   * finished) unlike recordSourceSpot's ids-only-ever-added rule, since a mineral's depletion state is a
   * single live fact each vision tick actually re-confirms, not an accumulating list of discoveries.
   */
  public override intents(colony: ColonySnapshot): Intent[] {
    const mineral = colony.mineral;
    if (!mineral) return [];

    const regeneratesAt = mineral.ticksToRegeneration > 0 ? colony.tick + mineral.ticksToRegeneration : undefined;
    if (regeneratesAt === colony.mineralMemory.regeneratesAt) return [];

    return [{ kind: "recordMineralRegen", room: colony.name, regeneratesAt }];
  }
}
