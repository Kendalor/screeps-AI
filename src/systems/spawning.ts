// The arbiter: gathers every requester's demand, sorts by priority, pairs it with idle spawns and
// spends the room's energy. It knows no role names and compares no counts — a requester decides
// what is missing, how big its body is and what memory it carries. No persisted spawn queue: a
// request not filled this tick is simply re-derived next tick from the live snapshot.

import { bodyCost, countPart, orderBody } from "../behaviors/body";
import { roleDef } from "../behaviors/roles";
import type { Colony } from "../colony";
import type { Intent } from "../intents/types";
import type { ColonySnapshot } from "../snapshot/types";
import { DEFAULT_PRIORITY, fillTo, opName, RECOVERY_PRIORITY, type CreepRequest } from "../spawn/request";
import { builderRequests } from "./building";
import { bodyContext } from "./spawnContext";
import { upgraderRequests } from "./upgrading";

// Demand now arrives from two sources: the colony's operations, and the roles no operation owns yet
// (recovery, bootstrap, upgrader, builder). The latter are visible debt — each is a candidate
// operation — and stay named here, the way they were when they were counts.
//
// A function rather than a module-level array: two of these are declared below and an array would
// capture them at module-evaluation time, working only by function hoisting. Converting any one of
// them to a `const` arrow — an ordinary refactor — would then throw at import and take down the
// whole loop. Resolving them per call costs nothing and cannot break that way.
function requesters(): ((colony: Colony) => CreepRequest[])[] {
  return [recoveryRequests, bootstrapRequests, upgraderRequests, builderRequests];
}

export function planSpawning(colony: Colony): Intent[] {
  // Concatenated, then flat-sorted: the arbiter treats an operation's request exactly like an
  // unowned requester's, so priority alone decides. Nothing here knows which is which.
  const requests = [
    ...colony.operations.flatMap(op => op.desiredCreeps(colony.snapshot)),
    ...requesters().flatMap(request => request(colony))
  ].sort((a, b) => b.priority - a.priority);
  if (requests.length === 0) return [];

  const idle = colony.snapshot.spawns.filter(s => !s.busy);
  // energyAvailable is a shared room pool, not per-spawn: two spawns each emitting an affordable
  // 300 body in a 300 room would produce one success and one silent ERR_NOT_ENOUGH_ENERGY.
  let budget = colony.snapshot.energyAvailable;

  const out: Intent[] = [];
  // An explicit take-from-the-list loop, not "for each spawn, find the best request" — the latter
  // hands the same top-priority request to every idle spawn. Consuming each request at most once
  // per tick is what closes the double-order window that a persisted queue would otherwise cover.
  let next = 0;
  for (const spawn of idle) {
    const request = requests[next];
    if (!request) break;
    const cost = bodyCost(request.body);
    // Stop rather than skip to a cheaper request lower down: filling with affordable creeps first
    // means the colony's energy is permanently consumed by cheap ones and the expensive
    // high-priority request never becomes affordable. That is a livelock, not priority inversion.
    if (cost > budget) break;

    out.push({ kind: "spawn", spawn: spawn.id, body: request.body, memory: request.memory });
    budget -= cost;
    next++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

// Total creep loss: with nothing alive, energyAvailable only climbs to the spawn's own regen and
// every normal quota evaluates to zero forever, so this detects a zero creep count directly rather
// than by watching energy level over time. An ordinary request at a reserved top priority — not a
// branch in the arbiter, since in total collapse there is no other request to override.
export function recoveryRequests({ snapshot: colony }: Colony): CreepRequest[] {
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
      memory: { role, home: colony.name, op: opName("recovery", colony.name) }
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

export function bootstrapRequests({ snapshot: colony }: Colony): CreepRequest[] {
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
