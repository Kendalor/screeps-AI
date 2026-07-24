import { affordableSets } from "../body";
import type { Step } from "../types";
import { Role } from "./role";

// 1:1 CARRY:MOVE — a loaded hauler never fatigues, on or off road. Heavy carry capacity comes from
// stacking many sets, not from a lean move ratio: the colony runs pre-road for a long stretch and a
// 2:1 body would crawl off-road while loaded, so equal parts is the safe default at every RCL.
const HAULER_SET: BodyPartConstant[] = [CARRY, MOVE];
const MAX_HAULER_SETS = 25; // 25 sets = 50 parts, the hard body cap

export function haulerBody(energy: number): BodyPartConstant[] {
  const sets = affordableSets(energy, HAULER_SET, 1, MAX_HAULER_SETS);
  let body: BodyPartConstant[] = [];
  for (let i = 0; i < sets; i++) {
    body = body.concat(HAULER_SET);
  }
  return body;
}

export class Hauler extends Role {
  static override readonly priority = 90;
  static override body(energy: number): BodyPartConstant[] {
    return haulerBody(energy);
  }
  // Drains mining containers and drop piles into the colony's sinks. Source side: a container is a
  // concentrated load a hauler empties in one visit, so it comes before scattered ground piles
  // (which are the pre-container fallback). Sink side: storage first when it exists (the steady-state
  // sink), else keep the spawning structures topped up — spawn, extensions, towers. The *last* sink
  // is the consumers themselves: once every structure is full, a hauler still holding energy hands it
  // straight to a builder or upgrader rather than sitting on it or dropping it to decay. That step
  // only fires when the structure sinks have no not-full target, so it never diverts energy the
  // spawn/extensions still need. Consumers also pull from haulers themselves (see their roles), so
  // the two meet in the middle — whichever acts first moves the load.
  //
  // Gather-first, then deliver: fill the store completely before delivering, then deliver until
  // empty before gathering again. The plain wrap-around loop gives this for free — a gather step is
  // complete only at free===0, so the hauler stays on the collect phase (topping off from container
  // then drops) until full; a spend step is complete only at used===0, so it stays on the deliver
  // phase until empty. No `when` gate is needed: gates were only there to invert this into the old
  // "deliver on any load" behaviour. Deliver steps resolve to the closest matching sink already
  // (resolveTarget uses findClosestByPath); pickup prefers the largest drop pile.
  static override readonly steps: Step[] = [
    { do: "withdraw", from: { find: "structure", type: STRUCTURE_CONTAINER, where: "hasEnergy" } },
    { do: "pickup", from: { find: "dropped", prefer: "largest" } },
    { do: "transfer", to: { find: "structure", type: STRUCTURE_STORAGE, where: "notFull" } },
    { do: "transfer", to: { find: "structure", type: STRUCTURE_TOWER, where: "notFull" } },
    { do: "transfer", to: { find: "structure", type: STRUCTURE_EXTENSION, where: "notFull" } },
    { do: "transfer", to: { find: "structure", type: STRUCTURE_SPAWN, where: "notFull" } },
    // oneShot: an actively-working consumer keeps draining its own carry, so it re-validates as
    // notFull practically forever — without oneShot the hauler would lock on and dump its whole
    // load into one upgrader/builder, never re-checking extensions that free up mid-trip. One
    // transfer, then the loop wraps to step 0 and re-scans every sink in priority order with
    // whatever energy remains, instead of pinning to this bottomless last resort.
    { do: "transfer", to: { find: "creep", role: ["builder", "upgrader"], where: "notFull", prefer: "nearest" }, oneShot: true }
  ];
}
