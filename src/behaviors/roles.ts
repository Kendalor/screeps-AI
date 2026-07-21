// Role table: body calculator + behavior per role. Adding a role is adding a row here.

import type { RoleName } from "../memory/schema";
import { affordableSets, bodyCost, parts } from "./body";
import type { BodyContext, RoleDef } from "./types";

// Doubled MOVE keeps a loaded creep at road speed (2 fatigue/tick from WORK+CARRY needs 2 MOVE to clear). Capped so a big room fields specialists, not oversized allrounders.
const BOOTSTRAP_SET: BodyPartConstant[] = [WORK, CARRY, MOVE, MOVE];
const MAX_BOOTSTRAP_SETS = 5;

// Sub-500 capacities stated outright: each is a one-off floor, not worth deriving from a formula. Highest rung at or below the budget wins.
const BOOTSTRAP_RUNGS: { at: number; body: BodyPartConstant[] }[] = [
  { at: 450, body: [WORK, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE, MOVE] },
  { at: 350, body: [WORK, CARRY, CARRY, MOVE, MOVE, MOVE] },
  { at: 250, body: [WORK, CARRY, MOVE, MOVE] }
];

function wholeSets(energy: number): BodyPartConstant[] {
  const sets = affordableSets(energy, BOOTSTRAP_SET, 1, MAX_BOOTSTRAP_SETS);
  let body: BodyPartConstant[] = [];
  for (let i = 0; i < sets; i++) {
    body = body.concat(BOOTSTRAP_SET);
  }
  return body;
}

// Repeats the 250 [WORK,CARRY,MOVE,MOVE] set as many times as the budget buys, reading sub-500 capacities from BOOTSTRAP_RUNGS.
// Remainder above 500 is deliberately unspent: a bootstrap fills at 2 energy/tick per WORK, so the next whole WORK always beats extra CARRY.
function bootstrapBody(energy: number): BodyPartConstant[] {
  const rung = BOOTSTRAP_RUNGS.find(r => energy >= r.at);
  if (rung && energy < bodyCost(BOOTSTRAP_SET) * 2) return [...rung.body];
  return wholeSets(energy);
}

const builderBody = wholeSets;

// Base WORK/CARRY/MOVE plus heavy-WORK sets (2:1 move ratio) bought from whatever the base leaves, up to the 50-part cap.
const UPGRADER_BASE: BodyPartConstant[] = [WORK, CARRY, CARRY, MOVE, MOVE];
const UPGRADER_SET: BodyPartConstant[] = [WORK, WORK, MOVE];
const MAX_UPGRADER_SETS = 15;

function upgraderBody(energy: number): BodyPartConstant[] {
  const spare = Math.max(0, energy - bodyCost(UPGRADER_BASE));
  const sets = affordableSets(spare, UPGRADER_SET, 0, MAX_UPGRADER_SETS);
  let body: BodyPartConstant[] = UPGRADER_BASE;
  for (let i = 0; i < sets; i++) {
    body = body.concat(UPGRADER_SET);
  }
  return body;
}

const SOURCE_SATURATING_WORK = 5; // 5 WORK * 2 energy/tick == a source's 10/tick

// A miner's shape follows where it puts the energy: no container means it must carry to the spawn; on a container CARRY is dead weight; feeding a link brings CARRY back.
function minerBody(energy: number, ctx: BodyContext): BodyPartConstant[] {
  if (!ctx.hasContainer) return [WORK, WORK, CARRY, MOVE];

  // 5 WORK drains a source completely (10 energy/tick, 2/WORK); anything past that wastes parts the room paid for.
  const carry = ctx.hasLink ? 1 : 0; // a link must be transferred into
  // Reserve one MOVE up front for the walk to the source; WORK is sized from what's left.
  const budget = energy - bodyCost(parts(CARRY, carry)) - BODYPART_COST[MOVE];
  const work = Math.min(SOURCE_SATURATING_WORK, Math.max(1, Math.floor(budget / BODYPART_COST[WORK])));
  const spare = energy - bodyCost([...parts(WORK, work), ...parts(CARRY, carry)]);
  const move = Math.max(1, Math.min(Math.ceil(work / 2), Math.floor(spare / BODYPART_COST[MOVE])));

  return [...parts(WORK, work), ...parts(CARRY, carry), ...parts(MOVE, move)];
}

// 2:1 CARRY:MOVE keeps a loaded hauler at road speed.
const HAULER_SET: BodyPartConstant[] = [CARRY, CARRY, MOVE];
const MAX_HAULER_SETS = 16; // 16 sets = 48 parts, just under the 50-part cap

function haulerBody(energy: number): BodyPartConstant[] {
  const sets = affordableSets(energy, HAULER_SET, 1, MAX_HAULER_SETS);
  let body: BodyPartConstant[] = [];
  for (let i = 0; i < sets; i++) {
    body = body.concat(HAULER_SET);
  }
  return body;
}

export const ROLES = {
  // Steps with no valid target are skipped, so this single wrap-around loop covers supply, build and upgrade.
  bootstrap: {
    body: bootstrapBody,
    steps: [
      { do: "harvest", from: { find: "source" } },
      { do: "transfer", to: { find: "structure", type: STRUCTURE_EXTENSION, where: "notFull" } },
      { do: "transfer", to: { find: "structure", type: STRUCTURE_SPAWN, where: "notFull" } },
      { do: "transfer", to: { find: "structure", type: STRUCTURE_TOWER, where: "notFull" } },
      { do: "build" },
      { do: "upgrade" }
    ]
  },
  // Refill from storage, then a container, then harvest directly; deliberately not bootstrapBody since a builder withdraws a full load in one tick, so the next WORK always beats extra CARRY.
  builder: {
    body: builderBody,
    steps: [
      { do: "withdraw", from: { find: "structure", type: STRUCTURE_STORAGE, where: "hasEnergy" } },
      { do: "withdraw", from: { find: "structure", type: STRUCTURE_CONTAINER, where: "hasEnergy" } },
      { do: "harvest", from: { find: "source" } },
      { do: "build" }
    ]
  },
  // Refill from the controller link, then storage, then upgrade.
  upgrader: {
    body: upgraderBody,
    steps: [
      { do: "withdraw", from: { find: "structure", type: STRUCTURE_LINK, where: "hasEnergy" } },
      { do: "withdraw", from: { find: "structure", type: STRUCTURE_STORAGE, where: "hasEnergy" } },
      { do: "upgrade" }
    ]
  },
  // With a container underneath, the transfer steps mostly no-op since harvest overflow already lands in it.
  miner: {
    body: minerBody,
    steps: [
      { do: "harvest", from: { find: "source" } },
      { do: "transfer", to: { find: "structure", type: STRUCTURE_LINK, where: "notFull" } },
      { do: "transfer", to: { find: "structure", type: STRUCTURE_CONTAINER, where: "notFull" } }
    ]
  },
  // Inverse of hauler: moves energy OUT of storage to keep spawning structures full. Container fallback covers a room without storage yet.
  supply: {
    body: haulerBody,
    steps: [
      { do: "withdraw", from: { find: "structure", type: STRUCTURE_STORAGE, where: "hasEnergy" } },
      { do: "withdraw", from: { find: "structure", type: STRUCTURE_CONTAINER, where: "hasEnergy" } },
      { do: "transfer", to: { find: "structure", type: STRUCTURE_EXTENSION, where: "notFull" } },
      { do: "transfer", to: { find: "structure", type: STRUCTURE_SPAWN, where: "notFull" } }
    ]
  },
  // Drains mining containers into storage; before storage exists, the spawn is the only sink worth filling.
  hauler: {
    body: haulerBody,
    steps: [
      { do: "withdraw", from: { find: "structure", type: STRUCTURE_CONTAINER, where: "hasEnergy" } },
      { do: "transfer", to: { find: "structure", type: STRUCTURE_STORAGE, where: "notFull" } },
      { do: "transfer", to: { find: "structure", type: STRUCTURE_SPAWN, where: "notFull" } }
    ]
  }
} satisfies Partial<Record<RoleName, RoleDef>>;

export function roleDef(role: RoleName): RoleDef | undefined {
  return (ROLES as Partial<Record<RoleName, RoleDef>>)[role];
}
