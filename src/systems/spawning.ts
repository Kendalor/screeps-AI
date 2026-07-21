// Spawning without a queue (docs/rewrite-skeleton.md §4). Each tick: compute a
// desired census per colony (pure function of RCL/energy/sources), diff against
// the actual census in the snapshot, and emit spawn intents for the highest
// deficit at an available spawn. No persisted spawn list, no name bookkeeping.

import { bodyCost, countPart, orderBody } from "../behaviors/body";
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

export function planSpawning(snap: EmpireSnapshot): Intent[] {
  const out: Intent[] = [];
  for (const colony of snap.colonies) {
    const spawn = colony.spawns.find(s => !s.busy);
    if (!spawn) continue;

    const recovery = recoveryRole(colony);
    const recovering = recovery !== undefined;
    const deficit = recovery ?? firstDeficit(desiredCensus(colony), colony.census);
    if (!deficit) continue;

    const def = roleDef(deficit);
    if (!def) continue;

    // Normal spawns size from capacity, recovery from what is actually there
    // (issue #21). Capacity is the room's persistent budget, so the same room
    // yields the same creep whenever the planner happens to run — sizing from
    // energyAvailable made body size depend on the tick, and a spawn firing
    // just after the room spent energy locked in a runt for its whole ~1500
    // tick life. In recovery capacity is a promise nothing can fulfil: no
    // creep is alive to fill the extensions, so a capacity-sized body would be
    // rejected by the affordability guard every tick and the colony would stay
    // dead forever. The spawn's own regen is the honest budget there.
    const budget = recovering ? colony.energyAvailable : colony.energyCapacity;
    // Order once, here, rather than in each body formula: damage eats parts in
    // array order, so this is a property of every body ever spawned, and a role
    // added later cannot forget to apply it.
    const body = orderBody(def.body(budget, bodyContext(colony)));
    // Body calculators clamp their energy argument up to a per-role floor, so
    // below it they return a body the room cannot pay for. Pricing the body the
    // role actually produced keeps this honest when body formulas change —
    // a fixed threshold would silently drift out of step with them.
    if (bodyCost(body) > colony.energyAvailable) continue;

    out.push({
      kind: "spawn",
      spawn: spawn.id,
      role: deficit,
      body,
      memory: { home: colony.name, role: deficit }
    });
  }
  return out;
}

// Total creep loss — the one state a colony cannot leave on its own. Nothing is
// alive to refill the extensions, so energyAvailable only ever climbs to the
// spawn's own regen, and every normal quota is free to evaluate to zero and
// leave the room dead forever. Returns the role that breaks the deadlock, or
// undefined when the colony is alive and the normal quota diff should run.
//
// The legacy port (InitRoomOperation.checkForEmergency) needed ~1000 persisted
// ticks of pinned energy to call this, because it watched energy level alone —
// a healthy room sits near its floor constantly, so only duration separated a
// drained room from a deadlocked one. Watching the census instead makes
// duration irrelevant: zero creeps is terminal the tick it is true.
//
// Callers check `!spawn.busy` first, which covers the one transient case (a
// recovery creep already mid-build). When colonize operations land, a colony
// awaiting its claim is the other legitimate empty-census state and belongs
// here — it must not be mistaken for a wipe.
function recoveryRole(colony: ColonySnapshot): RoleName | undefined {
  const alive = Object.values(colony.census).some(n => n > 0);
  if (alive) return undefined;

  // Storage energy is the fastest way back: supply withdraws from it and
  // refills the extensions directly. A hauler would be the wrong tool — it
  // moves energy the other way (container -> storage) and would strand the
  // colony while suppressing this check by being alive.
  if (colony.storageEnergy > 0) return "supply";

  // Otherwise harvest from scratch. Bootstrap is the only role that needs no
  // infrastructure, but it still needs a source to harvest — with none there
  // is nothing any body could do, so let the normal quota path decide.
  return colony.sources.length > 0 ? "bootstrap" : undefined;
}

// A source regenerates 3000 energy every 300 ticks — 10/tick — and one WORK
// part harvests 2/tick, so 5 WORK saturates a source.
const WORK_PER_SOURCE = 5;
// Draining the sources is only half the job: the energy still has to be spent
// on extensions and construction sites, and a creep doing that is not
// harvesting. This multiplier buys the surplus work-ticks that turn harvested
// energy into built structures — without it the colony harvests at exactly the
// regen rate and never gets ahead (gh #23).
const SPEND_HEADROOM = 2;
// Bootstrap is a stopgap workforce; miners/haulers replace it. Cap the count so
// a big room cannot spend its whole spawn throughput on allrounders.
const MAX_BOOTSTRAP = 12;
// Before RCL2 there is nothing for a big workforce to do — no extensions to
// fill, and the fastest path to RCL2 is to put early energy on the controller,
// not into spawning more harvesters. Stay at the old flat count until then.
const PRE_RCL2_PER_SOURCE = 2;

/**
 * How many bootstrap creeps the colony wants, sized by harvest throughput
 * rather than a flat per-source count: enough WORK parts across the workforce
 * to drain every source with headroom left to spend what they gather. Bigger
 * bodies carry more WORK each, so the count falls as energyCapacity climbs.
 *
 * Held lean until RCL2 so the first upgrades are not delayed behind a swollen
 * workforce (gh #23) — the throughput target applies once there are extensions
 * and a construction backlog to justify it.
 */
export function desiredBootstrapCount(colony: ColonySnapshot): number {
  if (colony.controllerLevel < 2) return colony.sources.length * PRE_RCL2_PER_SOURCE;
  const workNeeded = colony.sources.length * WORK_PER_SOURCE * SPEND_HEADROOM;
  const workPerCreep = bootstrapWorkParts(colony.energyCapacity);
  return Math.min(MAX_BOOTSTRAP, Math.ceil(workNeeded / workPerCreep));
}

// The WORK parts one bootstrap body actually gets at this budget — asking the
// role table rather than restating its formula, so the quota tracks any change
// to the body automatically.
function bootstrapWorkParts(energyCapacity: number): number {
  const body = roleDef("bootstrap")?.body(energyCapacity, { hasContainer: false, hasLink: false }) ?? [];
  return Math.max(1, countPart(body, WORK));
}

// P0 bootstrap quota plus the P1 miner/hauler/upgrader/builder quotas. Miners
// are one per container-backed source; haulers follow from what they fill.
function desiredCensus(colony: ColonySnapshot): Census {
  return {
    bootstrap: desiredBootstrapCount(colony),
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
