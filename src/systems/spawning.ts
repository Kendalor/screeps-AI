// Spawning without a queue (docs/rewrite-skeleton.md §4). Each tick: compute a
// desired census per colony (pure function of RCL/energy/sources), diff against
// the actual census in the snapshot, and emit spawn intents for the highest
// deficit at an available spawn. No persisted spawn list, no name bookkeeping.

import { roleDef } from "../behaviors/roles";
import type { Intent } from "../intents/types";
import type { RoleName } from "../memory/schema";
import type { Census, ColonySnapshot, EmpireSnapshot } from "../snapshot/types";

// Priority order — earlier roles are filled first when a colony is under CPU or
// energy pressure. Bootstrap keeps the colony alive before anything specialised.
const PRIORITY: RoleName[] = ["bootstrap", "miner", "hauler", "upgrader", "builder"];

export function planSpawning(snap: EmpireSnapshot): Intent[] {
  const out: Intent[] = [];
  for (const colony of snap.colonies) {
    const spawn = colony.spawns.find(s => !s.busy);
    if (!spawn) continue;

    const desired = desiredCensus(colony);
    const deficit = firstDeficit(desired, colony.census);
    if (!deficit) continue;

    const def = roleDef(deficit);
    if (!def) continue;

    out.push({
      kind: "spawn",
      spawn: spawn.id,
      role: deficit,
      body: def.body(colony.energyAvailable),
      memory: { home: colony.name, role: deficit }
    });
  }
  return out;
}

// Minimal P0 quota: enough bootstraps to work the sources. Miner/hauler/etc.
// quotas arrive with their P1 ports (MinerOperation, HaulerOperation, ...).
function desiredCensus(colony: ColonySnapshot): Census {
  return { bootstrap: colony.sources * 2 };
}

function firstDeficit(desired: Census, actual: Census): RoleName | undefined {
  for (const role of PRIORITY) {
    const want = desired[role] ?? 0;
    const have = actual[role] ?? 0;
    if (have < want) return role;
  }
  return undefined;
}
