// Bootstrap owns recovery from a total colony wipe — nothing else.
//
// It once also fielded an early-game "bootstrapper" all-rounder that harvested, filled, built and
// upgraded until storage existed. That workforce is gone: a room now stands up on the real economy
// from the first tick (drop-miners → haulers → upgraders/builders, all viable at 300 energy), so an
// all-rounder would only compete with miners for source tiles and slow the climb. Recovery still
// needs a role with no infrastructure requirement, so the bootstrap *body* survives here.
//
// Pure — reads the snapshot, returns plain requests, never touches Game.*.

import { bodyCost, orderBody } from "../behaviors/body";
import { roleDef } from "../behaviors/roles";
import type { ColonySnapshot } from "../snapshot/types";
import { RECOVERY_PRIORITY, opName, type CreepRequest } from "../spawn/request";
import { bodyContext } from "../behaviors/bodyContext";
import { Operation } from "./operation";

// Total creep loss: with nothing alive, energyAvailable only climbs to the spawn's own regen and
// every normal quota evaluates to zero forever, so this detects a zero creep count directly rather
// than by watching energy level over time. An ordinary request at a reserved top priority — not a
// branch in the arbiter, since in total collapse there is no other request to override.
function recoveryRequests(colony: ColonySnapshot): CreepRequest[] {
  if (colony.creeps.length > 0) return [];

  // Supply (not hauler, which moves energy the other way) withdraws from storage into extensions.
  // Bootstrap needs no infrastructure but still needs a source; with neither, there's no way back.
  const role = colony.storageEnergy > 0 ? "supply" : colony.sources.length > 0 ? "bootstrap" : undefined;
  if (!role) return [];

  const def = roleDef(role);
  if (!def) return [];

  // Sized against energyAvailable, not energyCapacity: a dead colony has no creep to fill its
  // extensions, so a capacity-sized body would fail the affordability guard forever.
  const body = orderBody(def.body(colony.energyAvailable, bodyContext(colony)));
  if (body.length === 0) return [];

  // Every body formula clamps to at least one whole set, so below that floor (250 for bootstrap, 150
  // for supply) it hands back a body the room can't pay for. Withhold it rather than emit it — at
  // RECOVERY_PRIORITY it sorts first, so an unaffordable request would trip the arbiter's stop and
  // block everything behind it while the room refills.
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

export class Bootstrap extends Operation {
  public readonly kind = "bootstrap";

  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    return recoveryRequests(colony);
  }
}
