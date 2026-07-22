// The body-sizing context every requester passes to roleDef().body. Lives apart from spawning.ts
// because spawning.ts imports the requesters, and the requesters need this — putting it there would
// be a cycle. Exported so a caller reconstructing a workforce (integration seeding) sizes bodies
// exactly as the requesters would.

import type { BodyContext } from "../behaviors/types";
import type { ColonySnapshot } from "../snapshot/types";

export function bodyContext(colony: ColonySnapshot): BodyContext {
  return {
    hasContainer: colony.containers.length > 0,
    hasLink: colony.structures.some(s => s.type === STRUCTURE_LINK)
  };
}
