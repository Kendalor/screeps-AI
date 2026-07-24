import { affordableSets, bodyCost, parts } from "../body";
import type { BodyContext, Step } from "../types";
import { Role } from "./role";

// A source yields 10 energy/tick and one WORK harvests 2/tick (5 WORK is exact); provisioned
// slightly above that to absorb the walk to the source and the gap between a miner dying and
// its replacement arriving.
const SOURCE_SATURATING_WORK = 6;

const DROP_MINER_BASE: BodyPartConstant[] = [WORK, WORK, MOVE, MOVE];
const DROP_MINER_SET: BodyPartConstant[] = [WORK, MOVE];

// A miner's shape follows where it puts the energy: no container means it drops to the ground and needs no CARRY at all; on a container CARRY is dead weight; feeding a link brings CARRY back.
function minerBody(energy: number, ctx: BodyContext): BodyPartConstant[] {
  if (!ctx.hasContainer) {
    const maxSets = SOURCE_SATURATING_WORK - 2; // base already carries 2 WORK; each set adds 1 more
    const sets = affordableSets(energy - bodyCost(DROP_MINER_BASE), DROP_MINER_SET, 0, maxSets);
    let body = [...DROP_MINER_BASE];
    for (let i = 0; i < sets; i++) body = body.concat(DROP_MINER_SET);
    return body;
  }

  // 5 WORK drains a source completely (10 energy/tick, 2/WORK); anything past that wastes parts the room paid for.
  const carry = ctx.hasLink ? 1 : 0; // a link must be transferred into
  // Reserve one MOVE up front for the walk to the source; WORK is sized from what's left.
  const budget = energy - bodyCost(parts(CARRY, carry)) - BODYPART_COST[MOVE];
  const work = Math.min(5, Math.max(1, Math.floor(budget / BODYPART_COST[WORK])));
  const spare = energy - bodyCost([...parts(WORK, work), ...parts(CARRY, carry)]);
  const move = Math.max(1, Math.min(Math.ceil(work / 2), Math.floor(spare / BODYPART_COST[MOVE])));

  return [...parts(WORK, work), ...parts(CARRY, carry), ...parts(MOVE, move)];
}

export class Miner extends Role {
  static override readonly priority = 95;
  static override body(energy: number, ctx: BodyContext): BodyPartConstant[] {
    return minerBody(energy, ctx);
  }
  // With a container underneath, the transfer steps mostly no-op since harvest overflow already lands in it.
  static override readonly steps: Step[] = [
    { do: "harvest", from: { find: "source" } },
    { do: "transfer", to: { find: "structure", type: STRUCTURE_LINK, where: "notFull" } },
    { do: "transfer", to: { find: "structure", type: STRUCTURE_CONTAINER, where: "notFull" } }
  ];
}
