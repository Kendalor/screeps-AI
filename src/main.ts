// Loop entry. Importing lib/traveler installs the Creep.prototype.travelTo used by the interpreter.

import "./lib/traveler";
import { tick } from "./kernel/tick";
import { stats } from "./kernel/stats";
import { installConsoleCommands } from "./commands/console";
import { loadMemory } from "./memory/cache";
import { migrateMemory } from "./memory/migrate";

installConsoleCommands(); // module scope: survives global resets same as the traveler prototype install

export function loop(): void {
  loadMemory();
  migrateMemory();
  stats.reset();
  tick();
}
