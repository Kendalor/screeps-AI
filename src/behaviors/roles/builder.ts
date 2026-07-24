import { affordableSets } from "../body";
import type { Step } from "../types";
import { Role } from "./role";

function builderBody(energy: number): BodyPartConstant[] {
  const BASE_BODY = [WORK, WORK, CARRY, MOVE];
  const sets = affordableSets(energy, BASE_BODY, 1, 7);
  let body: BodyPartConstant[] = [];
  for (let i = 0; i < sets; i++) {
    body = body.concat(BASE_BODY);
  }
  return body;
}

export class Builder extends Role {
  static override readonly priority = 65;
  static override body(energy: number): BodyPartConstant[] {
    return builderBody(energy);
  }
  // Refill from a drop, storage, a container, then a hauler directly, then harvest as a last resort.
  // The hauler-withdraw step lets a builder pull a full load from a passing hauler instead of chasing
  // scattered drops or harvesting a trickle itself — the fast way to keep a builder loaded pre-storage
  // (haulers also push to builders, see the hauler role; the two meet in the middle). Harvest stays
  // last: a builder self-mining is the slow fallback when no carried or stored energy is available.
  // Each step names its own selection strategy explicitly, not an implicit search default: pickup
  // takes the biggest pile (worth the detour), every withdraw takes the nearest source of energy
  // (storage/container/hauler are interchangeable, so distance is what should decide), and build
  // takes the site with the most progress (finish what's closest to done before starting more).
  static override readonly steps: Step[] = [
    { do: "pickup", from: { find: "dropped", prefer: "largest" } },
    { do: "withdraw", from: { find: "structure", type: STRUCTURE_STORAGE, where: "hasEnergy", prefer: "nearest" } },
    { do: "withdraw", from: { find: "structure", type: STRUCTURE_CONTAINER, where: "hasEnergy", prefer: "nearest" } },
    { do: "withdraw", from: { find: "creep", role: "hauler", where: "hasEnergy", prefer: "nearest" } },
    { do: "harvest", from: { find: "source" } },
    { do: "build", at: { find: "constructionSite", prefer: "mostProgress" } }
  ];
}
