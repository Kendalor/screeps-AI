// The demand a colony emits that no operation owns yet: recovery, bootstrap, and the builders that
// serve construction. Each is a candidate operation — visible debt, ported straight from the old
// systems/spawning.ts and systems/building.ts requesters, unchanged but for their home.
//
// Colony.requests() gathers these plus every operation's desiredCreeps(); the empire arbiter routes
// and spawns them. Nothing here spawns — these are pure satisfaction checks returning demand.

import { bodyContext } from "../behaviors/bodyContext";
import { bodyCost, countPart, orderBody } from "../behaviors/body";
import { roleDef } from "../behaviors/roles";
import type { ColonySnapshot } from "../snapshot/types";
import { DEFAULT_PRIORITY, fillTo, opName, RECOVERY_PRIORITY, type CreepRequest } from "../spawn/request";

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

// Total creep loss: with nothing alive, energyAvailable only climbs to the spawn's own regen and
// every normal quota evaluates to zero forever, so this detects a zero creep count directly rather
// than by watching energy level over time. An ordinary request at a reserved top priority — not a
// branch in the arbiter, since in total collapse there is no other request to override.
export function recoveryRequests(colony: ColonySnapshot): CreepRequest[] {
  if (colony.creeps.length > 0) return [];

  // Supply (not hauler, which moves energy the other way) withdraws from storage directly into extensions.
  // Bootstrap needs no infrastructure, but still needs a source; with neither, there is no way back.
  const role = colony.storageEnergy > 0 ? "supply" : colony.sources.length > 0 ? "bootstrap" : undefined;
  if (!role) return [];

  const def = roleDef(role);
  if (!def) return [];

  // Sized against energyAvailable, not energyCapacity: a dead colony has no creep to fill its
  // extensions, so a capacity-sized body would fail the affordability guard forever.
  const body = orderBody(def.body(colony.energyAvailable, bodyContext(colony)));
  if (body.length === 0) return [];

  // Sizing against available energy still does not guarantee affordability: every body formula
  // clamps to at least one whole set, so below that floor (250 for bootstrap, 150 for supply) it
  // hands back a body the room cannot pay for. Withhold it rather than emit it — at
  // RECOVERY_PRIORITY it sorts first, so an unaffordable recovery request would trip the arbiter's
  // stop and block every other request behind it while the room refills.
  if (bodyCost(body) > colony.energyAvailable) return [];

  return [
    {
      body,
      priority: RECOVERY_PRIORITY,
      memory: { role, home: colony.name, op: opName("recovery", colony.name) },
      targetRoom: colony.name
    }
  ];
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

// A source regenerates 10 energy/tick; one WORK part harvests 2/tick, so 5 WORK saturates a source.
const WORK_PER_SOURCE = 5;
// Draining sources is only half the job — energy must also be spent on extensions/sites, so the workforce is scaled up beyond
// saturation to buy surplus work-ticks; otherwise the colony harvests at exactly regen rate and never gets ahead.
// Applied to creep count rather than the WORK target, since multiplying the target first would let integer rounding swallow it.
const WORKFORCE_MULTIPLIER = 2.5;
// Before RCL2 there's nothing for a big workforce to do (no extensions to fill); stay at a flat count until then.
const PRE_RCL2_PER_SOURCE = 2;

// Sized by WORK-part throughput needed to drain every source, not a flat per-source count. Deliberately uncapped —
// the arbiter's affordability guard is the real limit on what the room can field.
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

export function bootstrapRequests(colony: ColonySnapshot): CreepRequest[] {
  // Capacity sizing, not availability: sizing from what happens to be in the room would make body
  // size depend on which tick the planner ran. Capacity is the room's persistent budget, and the
  // arbiter's guard turns "cannot pay yet" into "wait" rather than "spawn a runt".
  // Ordered here rather than in each body formula, since damage eats parts in array order for every body.
  return fillTo(
    desiredBootstrapCount(colony),
    colony.creeps.filter(c => c.role === "bootstrap").length,
    orderBody(roleDef("bootstrap")?.body(colony.energyCapacity, bodyContext(colony)) ?? []),
    DEFAULT_PRIORITY.bootstrap,
    { role: "bootstrap", home: colony.name, op: opName("bootstrap", colony.name) }
  );
}

// ---------------------------------------------------------------------------
// Builders — construction's workforce
// ---------------------------------------------------------------------------

// One builder per 5k of outstanding work, never more than 4 — an uncapped quota would starve every other role of spawn capacity.
const PROGRESS_PER_BUILDER = 5_000;
const MAX_BUILDERS = 4;
// Storage must clear this reserve plus the outstanding sites' cost before dedicated builders are affordable.
const STORAGE_RESERVE = 50_000;

function wantedBuilders(colony: ColonySnapshot): number {
  if (colony.constructionProgress <= 0) return 0;
  // Pre-storage, bootstrap already builds via its step loop, so a dedicated builder would only double-staff construction.
  if (colony.storageEnergy <= 0) return 0;
  if (colony.storageEnergy < STORAGE_RESERVE + colony.constructionProgress) return 0;
  return Math.min(MAX_BUILDERS, Math.ceil(colony.constructionProgress / PROGRESS_PER_BUILDER));
}

export function builderRequests(colony: ColonySnapshot): CreepRequest[] {
  return fillTo(
    wantedBuilders(colony),
    colony.creeps.filter(c => c.role === "builder").length,
    orderBody(roleDef("builder")?.body(colony.energyCapacity, bodyContext(colony)) ?? []),
    DEFAULT_PRIORITY.builder,
    { role: "builder", home: colony.name, op: opName("building", colony.name) }
  );
}
