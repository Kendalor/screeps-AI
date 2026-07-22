// Computes desired census per colony each tick and emits spawn intents for the highest deficit. No persisted spawn queue.

import { bodyCost, countPart, orderBody } from "../behaviors/body";
import { roleDef } from "../behaviors/roles";
import type { BodyContext } from "../behaviors/types";
import type { Colony } from "../colony";
import type { Intent } from "../intents/types";
import type { RoleName } from "../memory/schema";
import type { Census, ColonySnapshot } from "../snapshot/types";
import { desiredBuilderCount } from "./building";
import { desiredHaulerCount, desiredMinerCount } from "./logistics";
import { desiredUpgraderCount } from "./upgrading";

// Earlier roles are filled first under energy pressure; bootstrap keeps the colony alive before anything specialised.
const PRIORITY: RoleName[] = ["bootstrap", "miner", "hauler", "upgrader", "builder"];

export function planSpawning({ snapshot: colony }: Colony): Intent[] {
  const spawn = colony.spawns.find(s => !s.busy);
  if (!spawn) return [];

  const recovery = recoveryRole(colony);
  const recovering = recovery !== undefined;
  const deficit = recovery ?? firstDeficit(desiredCensus(colony), colony.census);
  if (!deficit) return [];

  const def = roleDef(deficit);
  if (!def) return [];

  // Capacity sizing is tick-dependent (a runt if spawned right after energy is spent); recovery has no creep to fill extensions,
  // so use actual available energy — a capacity-sized body there would fail the affordability guard forever.
  const budget = recovering ? colony.energyAvailable : colony.energyCapacity;
  // Ordered once here rather than in each body formula, since damage eats parts in array order for every body.
  const body = orderBody(def.body(budget, bodyContext(colony)));
  // Price the produced body rather than a fixed threshold, so it stays honest as body formulas change.
  if (bodyCost(body) > colony.energyAvailable) return [];

  return [
    {
      kind: "spawn",
      spawn: spawn.id,
      role: deficit,
      body,
      memory: { home: colony.name, role: deficit }
    }
  ];
}

// Total creep loss: with nothing alive, energyAvailable only climbs to the spawn's own regen and every normal quota evaluates
// to zero forever, so this detects zero-census directly rather than by watching energy level over time.
// Returns the role that breaks the deadlock, or undefined when the colony is alive and the normal quota diff should run.
function recoveryRole(colony: ColonySnapshot): RoleName | undefined {
  const alive = Object.values(colony.census).some(n => n > 0);
  if (alive) return undefined;

  // Supply (not hauler, which moves energy the other way) withdraws from storage directly into extensions.
  if (colony.storageEnergy > 0) return "supply";

  // Bootstrap needs no infrastructure, but still needs a source; with none, let the normal quota path decide.
  return colony.sources.length > 0 ? "bootstrap" : undefined;
}

// A source regenerates 10 energy/tick; one WORK part harvests 2/tick, so 5 WORK saturates a source.
const WORK_PER_SOURCE = 5;
// Draining sources is only half the job — energy must also be spent on extensions/sites, so the workforce is scaled up beyond
// saturation to buy surplus work-ticks; otherwise the colony harvests at exactly regen rate and never gets ahead.
// Applied to creep count rather than the WORK target, since multiplying the target first would let integer rounding swallow it.
const WORKFORCE_MULTIPLIER = 2.5;
// Before RCL2 there's nothing for a big workforce to do (no extensions to fill); stay at a flat count until then.
const PRE_RCL2_PER_SOURCE = 2;

// Sized by WORK-part throughput needed to drain every source, not a flat per-source count. Deliberately uncapped —
// planSpawning's affordability guard is the real limit on what the room can field.
export function desiredBootstrapCount(colony: ColonySnapshot): number {
  if (colony.controllerLevel < 2) return colony.sources.length * PRE_RCL2_PER_SOURCE;
  const workNeeded = colony.sources.length * WORK_PER_SOURCE;
  const workPerCreep = bootstrapWorkParts(colony.energyCapacity);
  const saturating = Math.ceil(workNeeded / workPerCreep);
  return Math.ceil(saturating * WORKFORCE_MULTIPLIER);
}

// Asks the role table rather than restating its formula, so the quota tracks any change to the body automatically.
function bootstrapWorkParts(energyCapacity: number): number {
  const body = roleDef("bootstrap")?.body(energyCapacity, { hasContainer: false, hasLink: false }) ?? [];
  return Math.max(1, countPart(body, WORK));
}

// Exported so integration benchmarks can seed a colony with the workforce it would actually have at a milestone, rather than
// cold-starting from empty and measuring a recovery the real colony never performs.
export function desiredCensus(colony: ColonySnapshot): Census {
  return {
    bootstrap: desiredBootstrapCount(colony),
    miner: desiredMinerCount(colony),
    hauler: desiredHaulerCount(colony),
    upgrader: desiredUpgraderCount(colony),
    builder: desiredBuilderCount(colony)
  };
}

// Exported alongside desiredCensus so a caller reconstructing this colony's workforce sizes bodies exactly as the spawner would.
export function bodyContext(colony: ColonySnapshot): BodyContext {
  return {
    hasContainer: colony.containers.length > 0,
    hasLink: colony.structures.some(s => s.type === STRUCTURE_LINK)
  };
}

function firstDeficit(desired: Census, actual: Census): RoleName | undefined {
  for (const role of PRIORITY) {
    const want = desired[role] ?? 0;
    const have = actual[role] ?? 0;
    if (have < want) return role;
  }
  return undefined;
}
