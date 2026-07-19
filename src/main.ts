// Loop entry: memory load/migrate, kernel.tick(), stats reset
// (docs/rewrite-skeleton.md §1). Importing lib/traveler installs the
// Creep.prototype.travelTo used by the interpreter.

import "./lib/traveler";
import { tick } from "./kernel/tick";
import { stats } from "./kernel/stats";
import { loadMemory } from "./memory/cache";
import { migrateMemory } from "./memory/migrate";

export function loop(): void {
  loadMemory(); // RawMemory parse-skip on consecutive ticks
  migrateMemory(); // ensure typed sections exist / are up to version
  stats.reset(); // per-tick CPU accounting
  tick();
}
