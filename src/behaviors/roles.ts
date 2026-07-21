// Role table: body calculator + behavior per role (docs/rewrite-skeleton.md §5).
// Adding a role is adding a row here — not five files and two registries.

import type { RoleName } from "../memory/schema";
import { affordableSets, bodyCost, countPart, parts } from "./body";
import type { BodyContext, RoleDef } from "./types";

// [WORK,CARRY,MOVE,MOVE] sets — 250 energy each. The doubled MOVE is the point:
// a loaded creep generates 2 fatigue per WORK/CARRY and clears 2 per MOVE, so
// one MOVE per weight-part is the minimum that keeps it at road speed carrying
// energy. Anything leaner (e.g. [WORK,CARRY,MOVE]) crawls 1 tile every 2 ticks
// loaded and spends its life on the road — the harvest-throughput leak the
// WORK-dense body caused (gh #23 follow-up). Floor of one set (buildable at the
// RCL1 300 cap, 50 unavoidable spare); capped so a big room doesn't field
// oversized allrounders instead of specialists.
const BOOTSTRAP_SET: BodyPartConstant[] = [WORK, CARRY, MOVE, MOVE];
const MAX_BOOTSTRAP_SETS = 5;
// A CARRY+MOVE pair — one weight-part and one MOVE, so it keeps the 1:1 ratio
// the set is built on.
const BOOTSTRAP_PAIR: BodyPartConstant[] = [CARRY, MOVE];
// Carry parts one WORK's harvest can usefully fill on a trip. Past this the
// creep spends more of its life standing at the source filling up than it saves
// in trips, so the remainder is better held back for the next whole set.
const MAX_CARRY_PER_WORK = 3;

function wholeSets(energy: number): BodyPartConstant[] {
  const sets = affordableSets(energy, BOOTSTRAP_SET, 1, MAX_BOOTSTRAP_SETS);
  let body: BodyPartConstant[] = [];
  for (let i = 0; i < sets; i++) {
    body = body.concat(BOOTSTRAP_SET);
  }
  return body;
}

/**
 * Whole [WORK,CARRY,MOVE,MOVE] sets, plus CARRY+MOVE pairs bought out of the
 * leftover energy between sets.
 *
 * Sets alone only step every 250 energy, so a room's first extensions bought
 * nothing: at 350 and 450 capacity it still spawned the 250 runt and threw the
 * rest away. The pairs turn each 100 of that remainder into carry capacity —
 * fatigue-neutral, so the creep still moves at full road speed loaded — and the
 * next whole set takes over as soon as it is affordable, because a second WORK
 * doubles the harvest rate and that is the real bottleneck.
 *
 * Rungs: 250 [W C MM] -> 350 [W CC MMM] -> 450 [W CCC MMMM] -> 500 [W C MM]x2
 * -> 600 -> 700 -> 750 [W C MM]x3, and so on.
 */
function bootstrapBody(energy: number): BodyPartConstant[] {
  const base = wholeSets(energy);
  const work = countPart(base, WORK);

  const spare = Math.max(0, energy - bodyCost(base));
  const room = work * MAX_CARRY_PER_WORK - countPart(base, CARRY);
  const pairs = Math.max(0, Math.min(room, Math.floor(spare / bodyCost(BOOTSTRAP_PAIR))));
  if (pairs === 0) return base;

  // Spread the pairs across the sets rather than appending them, so the CARRY
  // and its matching MOVE are decided together and the 1:1 ratio is visible in
  // the shape. The final part order is not decided here — orderBody sorts the
  // assembled body by survival priority before it is spawned.
  const carryPerSet = 1 + Math.floor(pairs / work);
  let extra = pairs % work; // the sets that get one more than the rest
  let body: BodyPartConstant[] = [];
  for (let i = 0; i < work; i++) {
    const carry = carryPerSet + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;
    body = body.concat([WORK, ...parts(CARRY, carry), ...parts(MOVE, carry + 1)]);
  }
  return body;
}

// Ported from Builder.getBody: whole full-speed sets, remainder unspent.
const builderBody = wholeSets;

// Ported from Upgrader.getBody: a WORK/CARRY/MOVE base plus WORK,WORK,MOVE sets
// (heavy WORK, standard 2:1 move ratio) bought from whatever the base leaves,
// up to 15 sets (the 50-body-part cap).
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

// A miner's shape follows where it puts the energy, not just the spend cap.
// No container yet (early game): it must carry to the spawn, so it needs a
// CARRY. On a container: harvest overflow drops straight in, so CARRY is dead
// weight and every point goes to WORK. Feeding a link: CARRY comes back.
function minerBody(energy: number, ctx: BodyContext): BodyPartConstant[] {
  // Pre-container compromise: 2 WORK is the least that justifies a dedicated
  // miner, and it still has to walk its energy to the spawn itself.
  if (!ctx.hasContainer) return [WORK, WORK, CARRY, MOVE];

  // A source yields 10 energy/tick and one WORK harvests 2, so 5 WORK drains
  // it completely — anything past that is parts the room paid for and wastes.
  // A parked miner barely moves, so MOVE is bought last, out of whatever the
  // WORK parts leave behind — up to the usual 1 MOVE per 2 WORK, never zero.
  const carry = ctx.hasLink ? 1 : 0; // a link must be transferred into
  // Reserve one MOVE up front — the miner still has to walk to the source, so
  // WORK is sized from what is left after the carry and that one MOVE.
  const budget = energy - bodyCost(parts(CARRY, carry)) - BODYPART_COST[MOVE];
  const work = Math.min(SOURCE_SATURATING_WORK, Math.max(1, Math.floor(budget / BODYPART_COST[WORK])));
  const spare = energy - bodyCost([...parts(WORK, work), ...parts(CARRY, carry)]);
  const move = Math.max(1, Math.min(Math.ceil(work / 2), Math.floor(spare / BODYPART_COST[MOVE])));

  return [...parts(WORK, work), ...parts(CARRY, carry), ...parts(MOVE, move)];
}

// Ported from HaulerOperation's carry-parts math: CARRY,CARRY,MOVE sets
// (2:1, enough MOVE to stay at speed on roads) repeated up to the energy
// cap, never fewer than one set.
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
  // Old Allrounder priority order, recast as a wrap-around step loop: steps
  // with no valid target are skipped, so this covers supply, build and upgrade.
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
  // Ported from Builder's job priority (the Build* jobs, then PickupNearest),
  // recast forward: refill from storage, then a container, then fall back to
  // harvesting a source directly, and spend it on whatever site is nearest.
  // Body is legacy Builder.getBody's whole-set calculation — deliberately not
  // bootstrapBody: the extra CARRY bootstrap buys between sets pays off for a
  // creep that fills up 2 energy at a time at a source, but a builder withdraws
  // a full load from storage in one tick, so for it the next WORK is always the
  // better use of the remainder.
  builder: {
    body: builderBody,
    steps: [
      { do: "withdraw", from: { find: "structure", type: STRUCTURE_STORAGE, where: "hasEnergy" } },
      { do: "withdraw", from: { find: "structure", type: STRUCTURE_CONTAINER, where: "hasEnergy" } },
      { do: "harvest", from: { find: "source" } },
      { do: "build" }
    ]
  },
  // Ported from Upgrader's job priority (Upgrade > PickupControllerLink >
  // PickupStorage), recast forward: refill from the controller link, then
  // storage, then spend it upgrading.
  upgrader: {
    body: upgraderBody,
    steps: [
      { do: "withdraw", from: { find: "structure", type: STRUCTURE_LINK, where: "hasEnergy" } },
      { do: "withdraw", from: { find: "structure", type: STRUCTURE_STORAGE, where: "hasEnergy" } },
      { do: "upgrade" }
    ]
  },
  // Ported from Miner/MineContainer: sit on the source and fill whatever sink
  // exists. With a container underneath, the transfer steps mostly no-op —
  // harvest overflow already lands in it.
  miner: {
    body: minerBody,
    steps: [
      { do: "harvest", from: { find: "source" } },
      { do: "transfer", to: { find: "structure", type: STRUCTURE_LINK, where: "notFull" } },
      { do: "transfer", to: { find: "structure", type: STRUCTURE_CONTAINER, where: "notFull" } }
    ]
  },
  // The inverse of hauler: hauler moves energy from mining containers INTO
  // storage, supply moves it back OUT to the structures that must be kept full
  // for spawning to work. Old SupplyExtension/SupplySpawn collapse into this
  // one row (docs/rewrite-skeleton.md §5). Storage is the intended source; the
  // container fallback covers a room whose storage is empty or not yet built,
  // so supply still functions as the extension filler before storage exists.
  supply: {
    body: haulerBody,
    steps: [
      { do: "withdraw", from: { find: "structure", type: STRUCTURE_STORAGE, where: "hasEnergy" } },
      { do: "withdraw", from: { find: "structure", type: STRUCTURE_CONTAINER, where: "hasEnergy" } },
      { do: "transfer", to: { find: "structure", type: STRUCTURE_EXTENSION, where: "notFull" } },
      { do: "transfer", to: { find: "structure", type: STRUCTURE_SPAWN, where: "notFull" } }
    ]
  },
  // Ported from Hauler's pickup/deliver loop: drain mining containers into
  // storage; before storage exists, the spawn is the only sink worth filling.
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
