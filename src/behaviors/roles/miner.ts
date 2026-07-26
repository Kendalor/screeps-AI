import { affordableSets, bodyCost, parts } from "../../spawn/body";
import type { BodyContext, Step } from "../types";
import { Role } from "./role";

// A source yields 10 energy/tick and one WORK harvests 2/tick (5 WORK is exact); provisioned
// slightly above that to absorb the walk to the source and the gap between a miner dying and
// its replacement arriving.
const SOURCE_SATURATING_WORK = 6;

const DROP_MINER_BASE: BodyPartConstant[] = [WORK, WORK, MOVE, MOVE];
const DROP_MINER_SET: BodyPartConstant[] = [WORK, MOVE];

// First-extension energy: below this a container miner's body is too tight to spare a CARRY part.
const CONTAINER_MINER_CARRY_ENERGY = 350;

// A miner's shape follows where it puts the energy: no container means it drops to the ground and needs no CARRY at all; a container miner carries one part-time overflow CARRY once the room can afford it; feeding a link always needs one.
function minerBody(energy: number, ctx: BodyContext): BodyPartConstant[] {
  if (!ctx.hasContainer) {
    const maxSets = SOURCE_SATURATING_WORK - 2; // base already carries 2 WORK; each set adds 1 more
    const sets = affordableSets(energy - bodyCost(DROP_MINER_BASE), DROP_MINER_SET, 0, maxSets);
    let body = [...DROP_MINER_BASE];
    for (let i = 0; i < sets; i++) body = body.concat(DROP_MINER_SET);
    return body;
  }

  // 5 WORK drains a source completely (10 energy/tick, 2/WORK); anything past that wastes parts the room paid for.
  // WORK is sized off energy alone (MOVE reserved up front) so an overflow CARRY never costs a WORK part.
  const workBudget = energy - BODYPART_COST[MOVE];
  let work = Math.min(5, Math.max(1, Math.floor(workBudget / BODYPART_COST[WORK])));
  const affordsCarryOnTop = (w: number) => energy >= w * BODYPART_COST[WORK] + BODYPART_COST[MOVE] + BODYPART_COST[CARRY];

  let carry: 0 | 1;
  if (ctx.hasLink) {
    // Feeding a link is mandatory, not a nice-to-have overflow part — shrink WORK by one rather than
    // propose a body the room can't afford, but never below the one WORK part a miner needs to function.
    carry = 1;
    if (!affordsCarryOnTop(work) && work > 1) work -= 1;
    if (!affordsCarryOnTop(work)) carry = 0; // rock-bottom energy: can't afford even one CARRY alongside WORK+MOVE
  } else {
    // A container miner unable to reach the container tile (a second miner on a shared source) still
    // needs to ferry its harvest in. Only added once it's free on top of WORK's own increment, so it
    // never shrinks WORK by a part — the miner simply goes without until the room can spare it.
    carry = energy >= CONTAINER_MINER_CARRY_ENERGY && affordsCarryOnTop(work) ? 1 : 0;
  }

  const spare = energy - bodyCost([...parts(WORK, work), ...parts(CARRY, carry)]);
  const move = Math.max(1, Math.min(Math.ceil(work / 2), Math.floor(spare / BODYPART_COST[MOVE])));

  return [...parts(WORK, work), ...parts(CARRY, carry), ...parts(MOVE, move)];
}

export class Miner extends Role {
  static override readonly priority = 95;
  static override body(energy: number, ctx: BodyContext): BodyPartConstant[] {
    return minerBody(energy, ctx);
  }
  // Standing on the container, harvest overflow already lands in it and these transfer steps no-op;
  // otherwise (an overflow CARRY miner sharing a source, or feeding a link) they fire the same tick as
  // harvest — transfer is its own engine pipeline, independent of harvest's WORK pipeline.
  static override readonly steps: Step[] = [
    { do: "harvest", from: { find: "source" } },
    { do: "transfer", to: { find: "structure", type: STRUCTURE_LINK, where: "notFull" } },
    { do: "transfer", to: { find: "structure", type: STRUCTURE_CONTAINER, where: "notFull" } }
  ];
}
