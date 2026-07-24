import { affordableSets, bodyCost } from "../body";
import type { Step } from "../types";
import { Role } from "./role";

// A 2:1 weight:MOVE body — fast on roads at every size. The base needs two MOVE, not one: its two
// WORK plus the CARRY are three weight parts, so a single MOVE leaves the creep at 3:1 and it crawls
// (empty upgraders barely move). Each heavy-WORK set is already a clean 2:1.
const UPGRADER_BASE: BodyPartConstant[] = [WORK, WORK, CARRY, MOVE, MOVE]; // 350
// The RCL1 floor: a 300-capacity room (one spawn, no extensions) cannot pay the 350 base, and the
// spawn arbiter *silently skips* a body costing more than the room's full energyCapacity — it can
// never afford it, so it never waits on it either, leaving a dedicated upgrader stuck at 0/N with an
// idle, full spawn. So below the base's cost we drop to this: one WORK to upgrade, a CARRY so it can
// actually refill (a CARRY-less upgrader just sits inert at the controller), 1:1 MOVE so it never
// crawls. Costs 250 — spawnable at the 300 floor.
const UPGRADER_FLOOR: BodyPartConstant[] = [WORK, CARRY, MOVE, MOVE]; // 250
const UPGRADER_SET: BodyPartConstant[] = [WORK, WORK, MOVE];
const MAX_UPGRADER_SETS = 7;

function upgraderBody(energy: number): BodyPartConstant[] {
  // Below the base's cost, field the affordable floor rather than an unspawnable base.
  if (energy < bodyCost(UPGRADER_BASE)) return [...UPGRADER_FLOOR];

  const spare = Math.max(0, energy - bodyCost(UPGRADER_BASE));
  const sets = affordableSets(spare, UPGRADER_SET, 0, MAX_UPGRADER_SETS);
  let body: BodyPartConstant[] = UPGRADER_BASE;
  for (let i = 0; i < sets; i++) {
    body = body.concat(UPGRADER_SET);
  }
  return body;
}

export class Upgrader extends Role {
  static override readonly priority = 60;
  static override body(energy: number): BodyPartConstant[] {
    return upgraderBody(energy);
  }
  // Steps with no valid target are skipped, so the loop runs upgrade first and refills behind it:
  // from a hauler directly, then a mining container, then storage, then the controller link, and a
  // dropped pile as the last fallback. The container and hauler steps are what let a pre-storage
  // upgrader work at all: before storage there is no link or storage to draw from, so without them
  // the upgrader would wander inert. Dedicated upgraders lead the RCL climb.
  static override readonly steps: Step[] = [
    { do: "upgrade" },
    { do: "withdraw", from: { find: "creep", role: "hauler", where: "hasEnergy" } },
    { do: "withdraw", from: { find: "structure", type: STRUCTURE_CONTAINER, where: "hasEnergy" } },
    { do: "withdraw", from: { find: "structure", type: STRUCTURE_STORAGE, where: "hasEnergy" } },
    { do: "withdraw", from: { find: "structure", type: STRUCTURE_LINK, where: "hasEnergy" } },
    { do: "pickup", from: { find: "dropped", prefer: "largest" } }
  ];
}
