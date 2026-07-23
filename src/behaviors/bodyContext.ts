// The body-sizing context every requester passes to roleDef().body. Lives in behaviors/, beside the
// body math it feeds. Exported so a caller reconstructing a workforce (integration seeding) sizes
// bodies exactly as the requesters would.

import type { BodyContext } from "./types";
import type { ColonySnapshot } from "../snapshot/types";

export function bodyContext(colony: ColonySnapshot): BodyContext {
  return {
    hasContainer: colony.containers.length > 0,
    hasLink: colony.structures.some(s => s.type === STRUCTURE_LINK)
  };
}
