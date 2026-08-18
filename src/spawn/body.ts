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

// 1:1 CARRY:MOVE so a loaded carrier never fatigues, even off-road — the default until roads confirms
// every route it could work is actually paved.
const CARRIER_SET: BodyPartConstant[] = [CARRY, MOVE];
// 2:1 CARRY:MOVE once the relevant route is built: a loaded creep on road only needs 1 MOVE per 2 CARRY
// to stay at full speed.
const CARRIER_SET_ROADS: BodyPartConstant[] = [CARRY, CARRY, MOVE];
const MAX_CARRIER_SETS = 25; // 25 sets = 50 parts, the hard body cap

// Shared CARRY/MOVE body shape for the colony's carrier-style roles (supply, transport) — sized by
// affordable sets of the CARRY:MOVE ratio, road-aware.
export function haulerBody(energy: number, roads = false): BodyPartConstant[] {
  const set = roads ? CARRIER_SET_ROADS : CARRIER_SET;
  const sets = affordableSets(energy, set, 1, MAX_CARRIER_SETS);
  let body: BodyPartConstant[] = [];
  for (let i = 0; i < sets; i++) {
    body = body.concat(set);
  }
  return body;
}
