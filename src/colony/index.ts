// A Colony is a per-tick wrapper around one owned room's snapshot and the operations that room runs.
// It holds no state: both the snapshot and the operations are rebuilt from scratch every tick. The
// snapshot is a named property rather than delegated fields, so the later RoomSnapshot split lands
// in this one file instead of in every planner signature.

import { operationsFor, type Operation } from "../operations";
import type { ColonySnapshot } from "../snapshot/types";

export interface Colony {
  snapshot: ColonySnapshot;
  // Constructed fresh each tick from the room name alone — operations carry no state across ticks,
  // so there is nothing to rehydrate and nothing that can go stale.
  operations: Operation[];
}

export function colony(snapshot: ColonySnapshot): Colony {
  return { snapshot, operations: operationsFor(snapshot.name) };
}
