// Role table: body calculator + behavior per role (docs/rewrite-skeleton.md §5).
// Adding a role is adding a row here — not five files and two registries.

import type { RoleName } from "../memory/schema";
import type { RoleDef } from "./types";

// Ported from Allrounder.getBody: 200-energy [WORK,CARRY,MOVE] sets, clamped
// to [300, 1200] energy and at most 4 sets; a spare >100 energy buys a
// leading MOVE,CARRY pair.
function bootstrapBody(energy: number): BodyPartConstant[] {
  const energyCap = Math.min(Math.max(300, energy), 1200);
  const fullSets = Math.min(Math.max(1, Math.floor(energyCap / 200)), 4);
  let parts: BodyPartConstant[] = [];
  if (energyCap - fullSets * 200 > 100) {
    parts = [MOVE, CARRY];
  }
  for (let i = 0; i < fullSets; i++) {
    parts = parts.concat([WORK, CARRY, MOVE]);
  }
  return parts;
}

// Ported from Upgrader.getBody: a WORK/CARRY/MOVE base, clamped to a
// 300-energy floor, plus WORK,WORK,MOVE sets (heavy WORK, standard 2:1
// move ratio) up to 15 sets (the 50-body-part cap).
function upgraderBody(energy: number): BodyPartConstant[] {
  const energyCap = Math.min(Math.max(300, energy), 4050);
  const fullSets = Math.min(15, Math.max(0, Math.floor((energyCap - 300) / 250)));
  let parts: BodyPartConstant[] = [WORK, CARRY, CARRY, MOVE, MOVE];
  for (let i = 0; i < fullSets; i++) {
    parts = parts.concat([WORK, WORK, MOVE]);
  }
  return parts;
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
  }
} satisfies Partial<Record<RoleName, RoleDef>>;

export function roleDef(role: RoleName): RoleDef | undefined {
  return (ROLES as Partial<Record<RoleName, RoleDef>>)[role];
}
