import { bodyCost, parts } from "../../spawn/body";
import type { BodyContext, Step } from "../types";
import { MIN_CARRY_ENERGY } from "./miner";
import { Role } from "./role";

// EXTRACT_MINERAL's yield is cooldown-gated (EXTRACTOR_COOLDOWN), not a continuous per-tick rate like a
// source's — there's no single WORK count that "saturates" it the way SOURCE_SATURATING_WORK does. Sized
// to the same ceiling as a local Miner's WORK target: more WORK still drains a burst faster once the
// cooldown clears, and this body is built rarely (one per room), so there's no cost pressure to trim it.
const MINERAL_WORK_TARGET = 6;

// Mirrors minerBody's shape (miner.ts) but with no remote/reserved branching — a room's own mineral is
// always local, never a remote-mining target (see assignedMineral's doc in behaviors/types.ts). One CARRY
// once the room can afford it, same self-buffering rationale as Miner: ferries overflow into the
// container even if a hauler is momentarily late.
function mineralMinerBody(energy: number, _ctx: BodyContext): BodyPartConstant[] {
  const carry: 0 | 1 = energy >= MIN_CARRY_ENERGY ? 1 : 0;
  const moveRatio = 0.5; // home room only — rides the bunker's paved roads, same as a local Miner.

  let work = 1;
  for (let w = MINERAL_WORK_TARGET; w >= 1; w--) {
    const move = Math.max(1, Math.ceil(w * moveRatio));
    if (bodyCost([...parts(WORK, w), ...parts(CARRY, carry), ...parts(MOVE, move)]) <= energy) {
      work = w;
      break;
    }
  }
  const move = Math.max(1, Math.ceil(work * moveRatio));

  return [...parts(WORK, work), ...parts(CARRY, carry), ...parts(MOVE, move)];
}

export class MineralMiner extends Role {
  static override readonly priority = 79; // between builder(65) and steward(93) — mineral now has a real consumer (Transport's rate-ranked pool, gh #48), so it no longer needs to sit at the bottom of the table, but colony economy/building and the anchor triangle still outrank it.
  static override readonly flee = true; // unarmed, home room only but still exposed to a base-runner.
  static override readonly retreatPart = WORK; // once WORK is gone it can no longer harvest, see Role.retreatPart.
  static override body(energy: number, ctx: BodyContext): BodyPartConstant[] {
    return mineralMinerBody(energy, ctx);
  }
  static override readonly steps: Step[] = [
    { do: "harvest", from: { find: "mineral" } },
    { do: "transfer", to: { find: "structure", type: [STRUCTURE_CONTAINER], where: "notFull", near: "assignedMineral", resource: "any" } }
  ];
}
