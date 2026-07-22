// The Empire wraps the whole snapshot and owns the colony list the tick iterates. Pure EmpireSnapshot -> Empire:
// buildEmpireSnapshot() stays the sole Game.* boundary, so the entire hierarchy is constructible from a fixture.

import { colony, type Colony } from "../colony";
import type { EmpireSnapshot } from "../snapshot/types";

export interface Empire {
  snapshot: EmpireSnapshot;
  colonies: Colony[];
}

export function empire(snapshot: EmpireSnapshot): Empire {
  return { snapshot, colonies: snapshot.colonies.map(colony) };
}
