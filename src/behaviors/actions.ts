// Verb-execution leaves: given an already-resolved target (not a spec), either act (in range) or
// travelTo (out of range). Shared by interpreter.ts's spec-resolving steps and, later, the logistics
// transport executor, which resolves its own NodeRef and has no TargetSpec to hand this module.

import type { StepResult } from "./interpreter";

/** Range-check-then-act-or-travel: the common leaf under withdraw/pickup/gather/transfer/build/repair. */
export function actOnResolved(
  creep: Creep,
  target: RoomObject,
  action: (t: RoomObject) => number,
  range = 1,
  allowTravel = true,
  // Forwarded as-is to travelTo when out of range — undefined for every existing step-table caller
  // (no behavior change there), used by transport.ts's logistics executor to opt a cross-room pickup/
  // deliver leg into the same keeper/hostile-avoidance routing moveToRoom's avoidDanger step gets (see
  // interpreter.ts's dangerAvoidanceOptions doc) — that executor has no moveToRoom step of its own.
  travelOptions?: TravelToOptions
): StepResult {
  if (creep.pos.inRangeTo(target as { pos: RoomPosition }, range)) {
    action(target);
    return { acted: true, didAct: true, target: (target as unknown as { id: Id<_HasId> }).id };
  }
  // Out of range: a co-fired bonus step must not travel (see runStep's allowTravel doc) — resolving a
  // target it can't reach this tick counts as not having acted at all.
  if (!allowTravel) return { acted: false, didAct: false };
  creep.travelTo(target as { pos: RoomPosition }, travelOptions);
  return { acted: true, didAct: false, target: (target as unknown as { id: Id<_HasId> }).id };
}

/** A dropped resource pile needs creep.pickup(); everything else with a .store needs creep.withdraw(). */
export function isResource(obj: RoomObject): obj is Resource {
  return (obj as { resourceType?: ResourceConstant }).resourceType !== undefined;
}

export function withdrawOrPickup(
  creep: Creep,
  target: RoomObject,
  resource: ResourceConstant,
  allowTravel = true,
  travelOptions?: TravelToOptions
): StepResult {
  return actOnResolved(
    creep,
    target,
    t =>
      isResource(t)
        ? creep.pickup(t)
        : creep.withdraw(t as Structure & { store: StoreDefinition }, resource),
    1,
    allowTravel,
    travelOptions
  );
}

export function transferTo(
  creep: Creep,
  target: RoomObject,
  resource: ResourceConstant,
  allowTravel = true,
  travelOptions?: TravelToOptions
): StepResult {
  return actOnResolved(creep, target, t => creep.transfer(t as Structure & { store: StoreDefinition }, resource), 1, allowTravel, travelOptions);
}
