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

function builderBody(energy: number): BodyPartConstant[] {
  const BASE_BODY = [WORK,WORK,CARRY,MOVE];
  const sets = affordableSets(energy, BASE_BODY,1, 7)
  let body: BodyPartConstant[] = [];
  for (let i = 0; i < sets; i++) {
    body = body.concat(BASE_BODY);
  }
  return body;
}

// A 2:1 weight:MOVE body — fast on roads at every size. The base needs two MOVE, not one: its two
// WORK plus the CARRY are three weight parts, so a single MOVE leaves the creep at 3:1 and it crawls
// (empty upgraders barely move). Each heavy-WORK set is already a clean 2:1.
const UPGRADER_BASE: BodyPartConstant[] = [WORK, WORK, CARRY, MOVE, MOVE];
const UPGRADER_SET: BodyPartConstant[] = [WORK, WORK, MOVE];
const MAX_UPGRADER_SETS = 7;

function upgraderBody(energy: number): BodyPartConstant[] {
  const spare = Math.max(0, energy - bodyCost(UPGRADER_BASE));
  const sets = affordableSets(spare, UPGRADER_SET, 0, MAX_UPGRADER_SETS);
  let body: BodyPartConstant[] = UPGRADER_BASE;
  for (let i = 0; i < sets; i++) {
    body = body.concat(UPGRADER_SET);
  }
  return body;
}

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

// 1:1 CARRY:MOVE — a loaded hauler never fatigues, on or off road. Heavy carry capacity comes from
// stacking many sets, not from a lean move ratio: the colony runs pre-road for a long stretch and a
// 2:1 body would crawl off-road while loaded, so equal parts is the safe default at every RCL.
const HAULER_SET: BodyPartConstant[] = [CARRY, MOVE];
const MAX_HAULER_SETS = 25; // 25 sets = 50 parts, the hard body cap

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
      { do: "pickup", from: { find: "dropped" } },
      { do: "harvest", from: { find: "source" } },
      { do: "transfer", to: { find: "structure", type: STRUCTURE_EXTENSION, where: "notFull" } },
      { do: "transfer", to: { find: "structure", type: STRUCTURE_SPAWN, where: "notFull" } },
      { do: "transfer", to: { find: "structure", type: STRUCTURE_TOWER, where: "notFull" } },
      { do: "build" },
      { do: "upgrade" }
    ]
  },
  // Refill from a drop, storage, a container, then a hauler directly, then harvest as a last resort.
  // The hauler-withdraw step lets a builder pull a full load from a passing hauler instead of chasing
  // scattered drops or harvesting a trickle itself — the fast way to keep a builder loaded pre-storage
  // (haulers also push to builders, see the hauler role; the two meet in the middle). Harvest stays
  // last: a builder self-mining is the slow fallback when no carried or stored energy is available.
  builder: {
    body: builderBody,
    steps: [
      { do: "pickup", from: { find: "dropped" } },
      { do: "withdraw", from: { find: "structure", type: STRUCTURE_STORAGE, where: "hasEnergy" } },
      { do: "withdraw", from: { find: "structure", type: STRUCTURE_CONTAINER, where: "hasEnergy" } },
      { do: "withdraw", from: { find: "creep", role: "hauler", where: "hasEnergy" } },
      { do: "harvest", from: { find: "source" } },
      { do: "build" }
    ]
  },
  // Steps with no valid target are skipped, so the loop runs upgrade first and refills behind it:
  // from a hauler directly, then a mining container, then storage, then the controller link, and a
  // dropped pile as the last fallback. The container and hauler steps are what let a pre-storage
  // upgrader work at all: before storage there is no link or storage to draw from, so without them
  // the upgrader would wander inert. Dedicated upgraders lead the RCL climb.
  upgrader: {
    body: upgraderBody,
    steps: [
      { do: "upgrade" },
      { do: "withdraw", from: { find: "creep", role: "hauler", where: "hasEnergy" } },
      { do: "withdraw", from: { find: "structure", type: STRUCTURE_CONTAINER, where: "hasEnergy" } },
      { do: "withdraw", from: { find: "structure", type: STRUCTURE_STORAGE, where: "hasEnergy" } },
      { do: "withdraw", from: { find: "structure", type: STRUCTURE_LINK, where: "hasEnergy" } },
      { do: "pickup", from: { find: "dropped" } }
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
      { do: "transfer", to: { find: "structure", type: STRUCTURE_EXTENSION, where: "notFull" } },
      { do: "transfer", to: { find: "structure", type: STRUCTURE_SPAWN, where: "notFull" } },
      { do: "withdraw", from: { find: "structure", type: STRUCTURE_STORAGE, where: "hasEnergy" } },
      { do: "withdraw", from: { find: "structure", type: STRUCTURE_CONTAINER, where: "hasEnergy" } }

    ]
  },
  // Drains mining containers and drop piles into the colony's sinks. Source side: a container is a
  // concentrated load a hauler empties in one visit, so it comes before scattered ground piles
  // (which are the pre-container fallback). Sink side: storage first when it exists (the steady-state
  // sink), else keep the spawning structures topped up — spawn, extensions, towers. The *last* sink
  // is the consumers themselves: once every structure is full, a hauler still holding energy hands it
  // straight to a builder or upgrader rather than sitting on it or dropping it to decay. That step
  // only fires when the structure sinks have no not-full target, so it never diverts energy the
  // spawn/extensions still need. Consumers also pull from haulers themselves (see their roles), so
  // the two meet in the middle — whichever acts first moves the load.
  hauler: {
    body: haulerBody,
    steps: [
      { do: "transfer", to: { find: "structure", type: STRUCTURE_STORAGE, where: "notFull" } },
      { do: "transfer", to: { find: "structure", type: STRUCTURE_TOWER, where: "notFull" } },
      { do: "transfer", to: { find: "structure", type: STRUCTURE_EXTENSION, where: "notFull" } },
      { do: "transfer", to: { find: "structure", type: STRUCTURE_SPAWN, where: "notFull" } },
      { do: "transfer", to: { find: "creep", role: ["builder", "upgrader"], where: "notFull" } },
      // Only gather once fully empty: a loaded hauler whose current sink filled cycles back to the
      // next transfer step above and delivers the rest, rather than returning to pick up more. The
      // `when` reads the hauler's own store; the target `where` still describes the source pile/container.
      { do: "withdraw", when: "empty", from: { find: "structure", type: STRUCTURE_CONTAINER, where: "hasEnergy" } },
      { do: "pickup", when: "empty", from: { find: "dropped" } }
    ]
  }
} satisfies Partial<Record<RoleName, RoleDef>>;

export function roleDef(role: RoleName): RoleDef | undefined {
  return (ROLES as Partial<Record<RoleName, RoleDef>>)[role];
}
