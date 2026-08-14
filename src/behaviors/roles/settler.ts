import { affordableSets, bodyCost } from "../../spawn/body";
import { energySourceGroup } from "../targets";
import type { Step } from "../types";
import { Role } from "./role";

// A settler is a Bootstrap creep that first has to travel to a freshly-claimed, spawnless room: it
// harvests, then fills spawn/extensions/towers, builds, and upgrades in the same wraparound loop
// Bootstrap uses to recover a wiped colony — a brand-new claim starts in exactly that same "zero
// structures, zero infrastructure" state. Body sizing is copied from Bootstrap verbatim; see
// bootstrap.ts's own comments for the reasoning (doubled MOVE for road speed, sub-500 rungs, etc).
const SETTLER_SET: BodyPartConstant[] = [WORK, CARRY, MOVE, MOVE];
const MAX_SETTLER_SETS = 5;

const SETTLER_RUNGS: { at: number; body: BodyPartConstant[] }[] = [
  { at: 450, body: [WORK, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE, MOVE] },
  { at: 350, body: [WORK, CARRY, CARRY, MOVE, MOVE, MOVE] },
  { at: 250, body: [WORK, CARRY, MOVE, MOVE] }
];

// Below this many ticksToLive, top up at the target room's own spawn (once one exists) rather than
// waiting to be replaced — a fresh settler costs a whole travel time across rooms just to reach the
// target, which renewing in place avoids for as long as the room still needs its work.
const RENEW_BELOW = 500;

// Below this many ticksToDowngrade, a settler drops everything else — including building the room's
// first spawn — and upgrades instead: losing the controller loses the claim outright, which is strictly
// worse than a delayed spawn. See the gated "upgrade" step below (urgentBelow), which is a no-op
// fall-through above this threshold so it never pre-empts the normal build-first order otherwise.
const DOWNGRADE_URGENT_BELOW = 1000;

// Once the target room's own energyCapacityAvailable reaches this, it's expected to sustain itself
// through its own normal operations (Bootstrap et al) rather than the sponsor's settlers — see the
// "recycle" step below. Also read by operations/colonize.ts (re-exported from there as
// SELF_SUFFICIENT_ENERGY_CAP) to stop requesting/sponsoring settlers at the same threshold, so a
// settler's own decision to recycle and Colonize's decision to stop backing it never disagree.
export const SELF_SUFFICIENT_ENERGY_CAP = 550;

function wholeSets(energy: number): BodyPartConstant[] {
  const sets = affordableSets(energy, SETTLER_SET, 1, MAX_SETTLER_SETS);
  let body: BodyPartConstant[] = [];
  for (let i = 0; i < sets; i++) {
    body = body.concat(SETTLER_SET);
  }
  return body;
}

function settlerBody(energy: number): BodyPartConstant[] {
  const rung = SETTLER_RUNGS.find(r => energy >= r.at);
  if (rung && energy < bodyCost(SETTLER_SET) * 2) return [...rung.body];
  return wholeSets(energy);
}

export class Settler extends Role {
  // Same tier as builder (65), NOT Colonizer/Claimer's 25 despite spawning alongside the colonizer —
  // a settler is the entire workforce of a brand-new colony (it alone builds that room's first spawn),
  // not a background luxury. At 25 it starved indefinitely behind any sponsor with a normal running
  // economy (bootstrap/supply/transport=100, miner=95, hauler=90 always outrank it, and planSpawning's
  // per-tick livelock guard blocks a colony from serving a lower-priority request at all once a higher
  // one it can't yet afford has "stopped" it for that tick) — confirmed live via the integration harness
  // (test/integration/colonize.test.ts): the settler request sat in the spawn queue for 4000+ ticks
  // without ever being fulfilled. Still below defender/bootstrap/supply/transport(100+) and miner/hauler,
  // so the sponsor's own survival is never sacrificed for a new colony's benefit.
  static override readonly priority = 65;
  static override body(energy: number): BodyPartConstant[] {
    return settlerBody(energy);
  }
  // Walk to the target room first (unlike Bootstrap, which is always already home), then run the same
  // supply/build/upgrade wraparound loop. renew is checked first every tick (falls through when not
  // needed/possible, see renewStep in interpreter.ts) so a low-ticksToLive settler tops off before doing
  // anything else, rather than risking dying mid-task. The gated urgent-upgrade step comes next and
  // outranks even the spawn build: losing the controller loses the claim outright, so that's the one
  // thing allowed to pre-empt "get the spawn built." The rest of the time (ticksToDowngrade comfortably
  // above DOWNGRADE_URGENT_BELOW) it's a no-op and the spawn's own construction site jumps ahead of
  // everything else below it: a brand-new claim has no spawn at all, so until one exists the colony can't
  // spawn replacements for this very settler (or anything else) — getting the spawn built outranks
  // topping off extensions/tower or any other site.
  static override readonly steps: Step[] = [
    { do: "renew", below: RENEW_BELOW },
    // Checked right after renew, before any travel/work step: once the target room can sustain itself
    // (see SELF_SUFFICIENT_ENERGY_CAP's doc), the settler's job is done and it recycles for a partial
    // energy refund rather than idling out its natural lifespan. A no-op fall-through below the
    // threshold or before the room has its own spawn yet (recycleStep's own gate).
    { do: "recycle", aboveEnergyCapacity: SELF_SUFFICIENT_ENERGY_CAP },
    { do: "moveToRoom", to: "targetRoom", avoidDanger: true },
    // gather (not pickup) over the combined energySourceGroup: dropped piles plus tombstones/ruins plus
    // any storage/container that already has energy, ranked by largest pile rather than a fixed
    // priority order. A brand-new claim room routinely has tombstones/ruins (a scout/claimer that died
    // en route, a wrecked hostile structure) with no hauler around to otherwise collect them.
    { do: "gather", from: energySourceGroup("largest") },
    { do: "harvest", from: { find: "source" } },
    // Jump the queue ahead of even the first-spawn build when the claim is genuinely about to be lost —
    // see DOWNGRADE_URGENT_BELOW. A no-op fall-through the rest of the time.
    { do: "upgrade", urgentBelow: DOWNGRADE_URGENT_BELOW },
    { do: "build", at: { find: "constructionSite", structureType: STRUCTURE_SPAWN } },
    { do: "transfer", to: { find: "structure", type: [STRUCTURE_EXTENSION], where: "notFull" } },
    { do: "transfer", to: { find: "structure", type: [STRUCTURE_SPAWN], where: "notFull" } },
    { do: "transfer", to: { find: "structure", type: [STRUCTURE_TOWER], where: "notFull" } },
    { do: "build" },
    { do: "upgrade" }
  ];
}

// Cheapest legal settler body, for affordability gates — mirrors CLAIMER_MIN_COST/COLONIZER_COST.
export const SETTLER_MIN_COST = bodyCost(SETTLER_RUNGS[SETTLER_RUNGS.length - 1].body);
