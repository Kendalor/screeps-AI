import { affordableSets, bodyCost } from "../../spawn/body";
import type { Step } from "../types";
import { Role } from "./role";

// 2:1 weight:MOVE keeps road speed; needs two MOVE since WORK+WORK+CARRY is 3 weight parts.
const UPGRADER_BASE: BodyPartConstant[] = [WORK, WORK, CARRY, MOVE, MOVE]; // 350
// RCL1 floor: a 300-capacity room can't afford the 350 base, and the spawn arbiter would skip it forever.
const UPGRADER_FLOOR: BodyPartConstant[] = [WORK, CARRY, MOVE, MOVE]; // 250
const UPGRADER_SET: BodyPartConstant[] = [WORK, WORK, MOVE];
const MAX_UPGRADER_SETS = 7;

// At a 300-capacity room, use a 2-CARRY body (WORK,CARRY,CARRY,MOVE,MOVE = 300) instead of the
// WORK,CARRY,MOVE,MOVE floor — trades a MOVE for a CARRY at RCL1. A/B slow-bench: ~4.5% faster to
// RCL3, ~6% faster to full RCL3 build-out, slightly less energy wasted, no reliable downside.
const B_300_BODY: BodyPartConstant[] = [WORK, CARRY, CARRY, MOVE, MOVE]; // 300

function upgraderBody(energy: number): BodyPartConstant[] {
  if (energy === 300) return [...B_300_BODY];
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
  // Refill from the nearest energy source — container, storage, link, a dropped pile or a tombstone
  // all pooled into one candidate set so the closest wins rather than a fixed type order. `gather`
  // (not withdraw/pickup) because the pool mixes store-holders with dropped energy and the verb must
  // follow whatever resolves. Never draws from haulers: a hauler drained mid-run can't deliver its
  // load, so the upgrader must not steal it in transit.
  //
  // Then BUILD before upgrading: an upgrader is an idle pair of WORK parts whenever there is
  // construction outstanding, so it pitches in on the nearest-to-done site first and only falls
  // through to upgrading once nothing is left to build. `build`'s target simply doesn't resolve when
  // no sites remain, so the loop advances to `upgrade` in the same tick — no wasted turn. This mirrors
  // the builder's own gather→build ordering; the two roles now behave identically at the site, the
  // only difference being how many of each the operations spawn.
  static override readonly steps: Step[] = [
    {
      do: "gather",
      from: {
        find: "any",
        of: [
          { find: "structure", type: [STRUCTURE_CONTAINER, STRUCTURE_STORAGE, STRUCTURE_LINK], where: "hasEnergy" },
          { find: "dropped" },
          { find: "tombstone" }
        ],
        prefer: "nearest"
      }
    },
    { do: "build", at: { find: "constructionSite", prefer: "mostProgress" } },
    { do: "upgrade" }
  ];
}
