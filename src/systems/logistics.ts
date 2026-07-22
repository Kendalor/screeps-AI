// Miner and hauler demand.

import { countPart, orderBody } from "../behaviors/body";
import { roleDef } from "../behaviors/roles";
import type { Colony } from "../colony";
import { DEFAULT_PRIORITY, fillTo, opName, type CreepRequest } from "../spawn/request";
import type { ColonySnapshot, SnapCreep } from "../snapshot/types";
import { bodyContext } from "./spawnContext";

const MIN_HAULER_ENERGY = 150; // one CARRY,CARRY,MOVE set — the cheapest body

// Asks the role table rather than restating its formula, so the quota tracks any change to the miner
// body automatically. Sized against the same context the request body uses: asking with a hardcoded
// {hasContainer:false} while spawning a container-shaped body makes the per-source target disagree
// with the creeps that fill it (a container miner carries up to 5 WORK, a drop miner 2).
function minerWorkParts(colony: ColonySnapshot): number {
  const body = roleDef("miner")?.body(colony.energyCapacity, bodyContext(colony)) ?? [];
  return Math.max(1, countPart(body, WORK));
}

// A source yields 10 energy/tick and one WORK harvests 2/tick (5 WORK is exact); the colony
// provisions slightly above that to cover the walk to the source and the gap between a miner
// dying and its replacement arriving.
const WORK_PER_SOURCE = 6;

const roleIs = (role: string) => (c: SnapCreep) => c.role === role;

/**
 * One request per source that no live miner is assigned to. The per-source deficit replaces a
 * colony-wide count: with the same formula the two produce the same spawn sequence, and they
 * diverge only where the colony total is already wrong (one source double-staffed, one bare) —
 * a case a count cannot see.
 *
 * Transitional: this body relocates wholesale into Mining.desiredCreeps() in stage 3.
 */
export function minerRequests({ snapshot: colony }: Colony): CreepRequest[] {
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
  // re-spend the whole allowance every tick. Whether either still makes sense under per-source
  // demand is a stage 3 question for Mining, not a stage 2 change.
  const ceiling = haulers === 0 ? 1 : haulers;
  let headcount = miners.length;

  // Miners that predate this stage carry no sourceId (PRD §6 — cleared by attrition, not migration).
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
          op: opName("mining", colony.name),
          sourceId: source.id
        }
      });
    }
  }
  return out;
}

export function haulerRequests({ snapshot: colony }: Colony): CreepRequest[] {
  if (colony.energyCapacity < MIN_HAULER_ENERGY) return [];
  return fillTo(
    colony.containers.filter(c => c.storeEnergy > 0).length,
    colony.creeps.filter(roleIs("hauler")).length,
    orderBody(roleDef("hauler")?.body(colony.energyCapacity, bodyContext(colony)) ?? []),
    DEFAULT_PRIORITY.hauler,
    { role: "hauler", home: colony.name, op: opName("logistics", colony.name) }
  );
}
