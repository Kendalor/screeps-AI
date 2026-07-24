export function bodyCost(body: BodyPartConstant[]): number {
  return body.reduce((sum, part) => sum + BODYPART_COST[part], 0);
}

// Cost is derived from the set rather than passed in, so a set's energy thresholds move automatically if its parts change.
export function affordableSets(energy: number, set: BodyPartConstant[], min: number, max: number): number {
  const cost = bodyCost(set);
  if (cost === 0) return min;
  return Math.min(max, Math.max(min, Math.floor(energy / cost)));
}

// Ascending survival priority: Screeps damages body[0] first, so index == expendability. MOVE last — losing it strands the creep.
const PART_PRIORITY: BodyPartConstant[] = [TOUGH, WORK, CARRY, CLAIM, RANGED_ATTACK, ATTACK, HEAL, MOVE];

export function orderBody(body: BodyPartConstant[]): BodyPartConstant[] {
  return [...body].sort((a, b) => PART_PRIORITY.indexOf(a) - PART_PRIORITY.indexOf(b));
}

export function countPart(body: BodyPartConstant[], part: BodyPartConstant): number {
  return body.filter(p => p === part).length;
}

export function parts(part: BodyPartConstant, n: number): BodyPartConstant[] {
  return new Array<BodyPartConstant>(Math.max(0, n)).fill(part);
}
