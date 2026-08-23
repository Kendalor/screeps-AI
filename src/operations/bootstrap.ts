// Bootstrap owns recovery from a total colony wipe, plus standing up any owned room that has no spawn
// at all — a wiped established colony and a freshly claimed one (Colonize's colonizer just landed the
// claim) look identical from here: zero spawns, otherwise possibly zero creeps too. Pure — reads the
// snapshot, returns plain requests.

import { bodyCost, orderBody } from "../spawn/body";
import { roleDef } from "../behaviors/roles";
import type { ColonySnapshot } from "../snapshot/types";
import { RECOVERY_PRIORITY, opName, type CreepRequest } from "../spawn/request";
import { bodyContext } from "../spawn/bodyContext";
import { Operation } from "./operation";

// Up to this many settlers work a single spawn-less room at once — matches Colonize's old MAX_SETTLERS
// (a fresh claim's workforce cap), now Bootstrap's own concern since it owns every spawn-less owned room,
// not just freshly claimed ones.
const MAX_SETTLERS = 4;

// A colony with no spawn can't be reached by supply (it only tops off an existing spawn/extensions —
// see supply.ts's dispatch: "logistics", which plans its task against creep.room, not targetRoom, so a
// creep spawned cross-colony never even walks home) and can't be rebuilt by a single bootstrap creep
// fast enough. Settler is the role actually built for "owned room, zero structures to lean on": it walks
// home via moveToRoom (targetRoom), then harvests/builds/upgrades, prioritizing the spawn construction
// site above everything else (settler.ts's step order) — exactly what's needed here, whether this room
// is mid-recovery from a wipe or a brand-new claim that has never had a spawn yet.
function noSpawnRequests(colony: ColonySnapshot): CreepRequest[] {
  if (colony.spawns.length > 0) return [];

  const def = roleDef("settler");
  if (!def) return [];

  const owned = colony.creeps.filter(c => c.role === "settler" && c.home === colony.name);
  if (owned.length >= MAX_SETTLERS) return [];

  // Sized against energyAvailable, not capacity: a spawn-less room has no spawn to grow capacity toward
  // filling anyway, same reasoning recoveryRequests uses below.
  const body = orderBody(def.body(colony.energyAvailable, bodyContext(colony)));
  if (body.length === 0) return [];
  if (bodyCost(body) > colony.energyAvailable) return [];

  const missing = MAX_SETTLERS - owned.length;
  return Array.from({ length: missing }, () => ({
    body,
    priority: RECOVERY_PRIORITY,
    memory: { role: "settler", home: colony.name, op: opName("recovery", colony.name) },
    targetRoom: colony.name
    // No spawnRoom pin, same reasoning as the old single-creep recovery request: a spawn-less colony's
    // own spawn purse can't serve this at all, so the cross-colony fallback (nearest OTHER colony's
    // spawn) is the only way these creeps ever get built.
  }));
}

// Detects total creep loss directly (zero count), since normal quotas evaluate to zero forever otherwise.
function recoveryRequests(colony: ColonySnapshot): CreepRequest[] {
  if (colony.creeps.length > 0) return [];

  // Supply withdraws storage into extensions; bootstrap needs a source instead.
  const role = colony.storageEnergy > 0 ? "supply" : colony.sources.length > 0 ? "bootstrap" : undefined;
  if (!role) return [];

  const def = roleDef(role);
  if (!def) return [];

  // Sized against energyAvailable, not capacity: no creep exists yet to fill extensions further.
  const body = orderBody(def.body(colony.energyAvailable, bodyContext(colony)));
  if (body.length === 0) return [];

  // Withhold rather than emit an unaffordable body: at RECOVERY_PRIORITY it would block everything behind it.
  if (bodyCost(body) > colony.energyAvailable) return [];

  return [
    {
      body,
      priority: RECOVERY_PRIORITY,
      memory: { role, home: colony.name, op: opName("recovery", colony.name) },
      targetRoom: colony.name
      // No spawnRoom pin, unlike every other colony-scoped request (see spawn/request.ts's fillTo doc)
      // — deliberately kept: a wiped colony with a busy/full spawn of its own is exactly the case where
      // losing extra ticks matters most, so recovery alone keeps the old cross-colony fallback (the
      // nearest OTHER colony's spawn serves it if its own can't) rather than simply waiting.
    }
  ];
}

export class Bootstrap extends Operation {
  public readonly kind = "bootstrap";

  public override desiredCreeps(colony: ColonySnapshot): CreepRequest[] {
    // No-spawn recovery takes priority over (and excludes) the zero-creep recovery path: a colony can
    // have living creeps (haulers, remote miners) but still no spawn, in which case creeps.length > 0
    // would otherwise short-circuit recoveryRequests before it ever considers the spawn-less case.
    const noSpawn = noSpawnRequests(colony);
    if (noSpawn.length > 0) return noSpawn;
    return recoveryRequests(colony);
  }
}
