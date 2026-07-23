// Mining owns the source-to-storage capability end to end, not "the miner role": the miners, the
// haulers that carry what miners produce, and the per-source container/link they drop into.
// systems/logistics.ts was deleted for this — there was never a logistics capability, there was a
// hauler role that belonged to mining all along.
//
// Pure — reads the snapshot, returns plain data, never touches Game.*/Memory.

import { countPart, orderBody } from "../behaviors/body";
import { roleDef } from "../behaviors/roles";
import type { Intent } from "../intents/types";
import { buildCostMatrix, sourceRoadPath } from "../layouts/roads";
import type { PlacedStructure } from "../layouts/stamp";
import type { XY } from "../lib/geometry";
import type { ColonySnapshot, SnapCreep, SnapSource } from "../snapshot/types";
import { DEFAULT_PRIORITY, fillTo, type CreepRequest } from "../spawn/request";
import { bodyContext } from "../systems/spawnContext";
import { Operation } from "./operation";

// Deliberately not gated on storage: the container-backed economy is what funds storage, so gating on it would deadlock the colony.
const MIN_CONTAINER_RCL = 2;
// A link beats a container from RCL7: the miner drops straight into the link network instead of needing a hauler round trip.
const LINK_RCL = 7;
// A container placed before miners exist is 5000 energy nobody can use, sitting in a scarce focus slot starving extensions.
// Moved here from building.ts: gating a source container on RCL is mining's knowledge of what it needs *when*.
export const CONTAINERS_FROM_RCL = 3;

const MIN_HAULER_ENERGY = 150; // one CARRY,CARRY,MOVE set — the cheapest body

// A source yields 10 energy/tick and one WORK harvests 2/tick (5 WORK is exact); the colony
// provisions slightly above that to cover the walk to the source and the gap between a miner
// dying and its replacement arriving.
const WORK_PER_SOURCE = 6;

const roleIs = (role: string) => (c: SnapCreep) => c.role === role;

function sourceStructureType(rcl: number): BuildableStructureConstant {
  return rcl >= LINK_RCL ? "link" : "container";
}

// Asks the role table rather than restating its formula, so the quota tracks any change to the miner
// body automatically. Sized against the same context the request body uses: asking with a hardcoded
// {hasContainer:false} while spawning a container-shaped body makes the per-source target disagree
// with the creeps that fill it (a container miner carries up to 5 WORK, a drop miner 2).
function minerWorkParts(colony: ColonySnapshot): number {
  const body = roleDef("miner")?.body(colony.energyCapacity, bodyContext(colony)) ?? [];
  return Math.max(1, countPart(body, WORK));
}

export class Mining extends Operation {
  public readonly kind = "mining";

  /**
   * Miners (a per-source deficit) then haulers, concatenated in that order with their existing
   * priorities. The arbiter's flat sort makes emission order irrelevant; keeping source order
   * stable keeps diffs readable.
   */
  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    return [...this.minerRequests(colony), ...this.haulerRequests(colony)];
  }

  /**
   * One request per source that no live miner is assigned to. The per-source deficit replaces a
   * colony-wide count: with the same formula the two produce the same spawn sequence, and they
   * diverge only where the colony total is already wrong (one source double-staffed, one bare) —
   * a case a count cannot see.
   */
  private minerRequests(colony: ColonySnapshot): CreepRequest[] {
    const workPerBody = minerWorkParts(colony);
    const miners = colony.creeps.filter(roleIs("miner"));

    // Per-source want, from the same formula the colony-wide count used.
    const perSource = (source: { openTiles: number }): number =>
      Math.min(Math.ceil(WORK_PER_SOURCE / workPerBody), source.openTiles);

    // Cold-start seed: hauler demand derives from miner output, so zero miners means zero
    // hauler demand and this quota would never ask for the first one. Scoped to "no haulers
    // alive" so it lapses once one exists and doesn't cause over-mining later. See ADR 0001.
    const haulers = colony.creeps.filter(roleIs("hauler")).length;

    // Only haulers count toward collector capacity — bootstraps are deliberately excluded so
    // bootstrap's own quota (defined in terms of every other role's deficit) cannot chase this
    // one upward. See ADR 0001.
    //
    // Both the cold-start floor and the hauler cap were caps on *total* miner headcount, so live
    // miners are counted against the same ceiling — capping requests alone would let the colony
    // re-spend the whole allowance every tick. Now that both live inside one operation this is
    // internal arithmetic — Mining sizes its miners against its own haulers — rather than
    // cross-role coupling. Whether either still makes sense is a later question.
    const ceiling = haulers === 0 ? 1 : haulers;
    let headcount = miners.length;

    // Miners that predate stage 2 carry no sourceId (PRD §6 — cleared by attrition, not migration).
    // They still mine, so they are spread across the sources as generic cover rather than left to
    // consume the ceiling while covering nothing: counting them only in `headcount` would make every
    // source look bare *and* the ceiling look full, and the colony would stop asking for miners
    // entirely until they died of old age.
    let unassigned = miners.filter(c => c.memory.sourceId === undefined).length;

    const body = orderBody(roleDef("miner")?.body(colony.energyCapacity, bodyContext(colony)) ?? []);
    const out: CreepRequest[] = [];
    for (const source of colony.sources) {
      const wanted = perSource(source);
      const assigned = miners.filter(c => c.memory.sourceId === source.id).length;
      // Draw on the unassigned pool before asking for a new creep — an un-owned miner sitting on this
      // source is cover the colony already paid for.
      const borrowed = Math.min(unassigned, Math.max(0, wanted - assigned));
      unassigned -= borrowed;

      // One request per missing miner on this source, not one per source: a source wanting three
      // miners asks for three, exactly as the colony-wide count did.
      for (let i = assigned + borrowed; i < wanted && headcount < ceiling; i++) {
        headcount++;
        out.push({
          body,
          priority: DEFAULT_PRIORITY.miner,
          memory: {
            role: "miner",
            home: colony.name,
            op: this.name,
            sourceId: source.id
          }
        });
      }
    }
    return out;
  }

  private haulerRequests(colony: ColonySnapshot): CreepRequest[] {
    if (colony.energyCapacity < MIN_HAULER_ENERGY) return [];
    return fillTo(
      colony.containers.filter(c => c.storeEnergy > 0).length,
      colony.creeps.filter(roleIs("hauler")).length,
      orderBody(roleDef("hauler")?.body(colony.energyCapacity, bodyContext(colony)) ?? []),
      DEFAULT_PRIORITY.hauler,
      { role: "hauler", home: colony.name, op: this.name }
    );
  }

  /**
   * Each source's container/link. Mining never places sites itself — planBuilding owns construction
   * and merges this with the room planner's baseline.
   */
  public override structures(colony: ColonySnapshot): PlacedStructure[] {
    if (colony.controllerLevel < MIN_CONTAINER_RCL) return [];

    const type = sourceStructureType(colony.controllerLevel);
    // The RCL gate that lived in building.ts: an operation that cannot afford a container does not
    // ask for one, exactly as desiredCreeps() is gated by current state.
    if (type === "container" && colony.controllerLevel < CONTAINERS_FROM_RCL) return [];

    return [...this.sourceSpots(colony).values()].map(spot => ({ x: spot.x, y: spot.y, type }));
  }

  /**
   * Source-spot bookkeeping, so roles avoid re-pathing every tick.
   *
   * Known inefficiency, ported as-is: it rewrites the same values every run, unconditionally,
   * whether or not they are already recorded. Throttled only by the tick interval.
   */
  public override intents(colony: ColonySnapshot): Intent[] {
    const out: Intent[] = [];
    for (const [source, spot] of this.sourceSpots(colony)) {
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
    return out;
  }

  // Private, and the shared derivation all three channels read, so the recorded spot can never
  // disagree with the built spot.
  private sourceSpots(colony: ColonySnapshot): Map<SnapSource, XY> {
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
}
