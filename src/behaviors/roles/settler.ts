import { affordableSets, bodyCost } from "../../spawn/body";
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
  // anything else, rather than risking dying mid-task. The spawn's own construction site jumps ahead of
  // everything else in the loop: a brand-new claim has no spawn at all, so until one exists the colony
  // can't spawn replacements for this very settler (or anything else) — getting the spawn built outranks
  // topping off extensions/tower or any other site.
  static override readonly steps: Step[] = [
    { do: "renew", below: RENEW_BELOW },
    { do: "moveToRoom", to: "targetRoom" },
    { do: "pickup", from: { find: "dropped", prefer: "largest" } },
    { do: "harvest", from: { find: "source" } },
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
