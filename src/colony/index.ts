// A Colony is a per-tick wrapper around one owned room's snapshot. It holds no state and has no methods yet:
// stages 2 and 3 attach operations here. The snapshot is a named property rather than delegated fields, so the
// later RoomSnapshot split lands in this one file instead of in every planner signature.

import type { ColonySnapshot } from "../snapshot/types";

export interface Colony {
  snapshot: ColonySnapshot;
}

export function colony(snapshot: ColonySnapshot): Colony {
  return { snapshot };
}
