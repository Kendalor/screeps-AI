// Spawning without a queue (docs/rewrite-skeleton.md §4). Each tick: compute a
// desired census per colony (pure function of RCL/energy/sources), diff against
// the actual census in the snapshot, and emit spawn intents for the highest
// deficit at an available spawn. No persisted spawn list, no name bookkeeping.

import { roleDef } from "../behaviors/roles";
import type { BodyContext } from "../behaviors/types";
import type { Intent } from "../intents/types";
import type { RoleName } from "../memory/schema";
import type { Census, ColonySnapshot, EmpireSnapshot } from "../snapshot/types";
import { desiredBuilderCount } from "./building";
import { desiredHaulerCount, desiredMinerCount } from "./logistics";
import { desiredUpgraderCount } from "./upgrading";

// Priority order — earlier roles are filled first when a colony is under CPU or
// energy pressure. Bootstrap keeps the colony alive before anything specialised.
const PRIORITY: RoleName[] = ["bootstrap", "miner", "hauler", "upgrader", "builder"];

// The cheapest body any role can produce. Body calculators clamp their energy
// argument up to this floor, so below it they return a body the room cannot
// pay for — the spawn dry run then rejects it every tick.
const MIN_SPAWN_ENERGY = 300;

export function planSpawning(snap: EmpireSnapshot): Intent[] {
  const out: Intent[] = [];
  for (const colony of snap.colonies) {
    const spawn = colony.spawns.find(s => !s.busy);
    if (!spawn) continue;
    if (colony.energyAvailable < MIN_SPAWN_ENERGY) continue;

    const role = isWipedOut(colony)
      ? recoveryRole(colony)
      : firstDeficit(desiredCensus(colony), colony.census);
    if (!role) continue;

    const def = roleDef(role);
    if (!def) continue;

    out.push({
      kind: "spawn",
      spawn: spawn.id,
      role,
      body: def.body(colony.energyAvailable, bodyContext(colony)),
      memory: { home: colony.name, role }
    });
  }
  return out;
}

// Total creep loss with an idle spawn — the one state a colony cannot leave on
// its own. Nothing is alive to refill the extensions, so energyAvailable only
// ever climbs to the spawn's own 300 regen, and every normal quota is free to
// evaluate to zero and leave the room dead forever.
//
// The legacy port (InitRoomOperation.checkForEmergency) needed ~1000 persisted
// ticks of pinned energy to call this, because it watched energy level alone —
// a healthy room sits at 300 constantly, so only duration separated a drained
// room from a deadlocked one. Watching the census instead makes duration
// irrelevant: zero creeps with an idle spawn is terminal the tick it is true,
// and waiting 1000 ticks to confirm it only wastes 1000 ticks.
//
// Callers check `!spawn.busy` before this, which covers the one transient case
// (a recovery creep already mid-build). When colonize operations land, a colony
// awaiting a claim is the other legitimate empty-census state and belongs here.
function isWipedOut(colony: ColonySnapshot): boolean {
  return Object.values(colony.census).every(n => !n);
}

// Recovery spends the room's one affordable body on refilling the spawn. A
// hauler drains existing storage into it, which is far faster than harvesting,
// so it wins wherever storage still holds energy. Otherwise bootstrap harvests
// a source and transfers to the extensions and spawn directly — the only role
// that needs no infrastructure to function.
function recoveryRole(colony: ColonySnapshot): RoleName {
  return colony.storageEnergy > 0 ? "hauler" : "bootstrap";
}

// P0 bootstrap quota plus the P1 miner/hauler/upgrader/builder quotas. Miners
// are one per container-backed source; haulers follow from what they fill.
function desiredCensus(colony: ColonySnapshot): Census {
  return {
    bootstrap: colony.sources * 2,
    miner: desiredMinerCount(colony),
    hauler: desiredHaulerCount(colony),
    upgrader: desiredUpgraderCount(colony),
    builder: desiredBuilderCount(colony)
  };
}

// Structures that change what a body should look like — see BodyContext.
function bodyContext(colony: ColonySnapshot): BodyContext {
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
