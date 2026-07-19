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
  }
} satisfies Partial<Record<RoleName, RoleDef>>;

export function roleDef(role: RoleName): RoleDef | undefined {
  return (ROLES as Partial<Record<RoleName, RoleDef>>)[role];
}
