// Loop entry. Importing lib/traveler installs the Creep.prototype.travelTo used by the interpreter.

import "./lib/traveler";
import { tick } from "./kernel/tick";
import { stats } from "./kernel/stats";
import { loadMemory } from "./memory/cache";
import { migrateMemory } from "./memory/migrate";

export function loop(): void {
  loadMemory();
  migrateMemory();
  stats.reset();
  tick();
}
