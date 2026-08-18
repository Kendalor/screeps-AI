// Loop entry. Importing lib/traveler installs the Creep.prototype.travelTo used by the interpreter.

import "./lib/traveler";
import { tick } from "./kernel/tick";
import { stats } from "./kernel/stats";
import { installConsoleCommands } from "./commands/console";
import { installLogisticsTestHooks } from "./logistics/testHooks";
import { initProfiler } from "./lib/profiler";
import { loadMemory } from "./memory/cache";
import { migrateMemory } from "./memory/migrate";

declare const __PROFILER_ENABLED__: boolean;

installConsoleCommands(); // module scope: survives global resets same as the traveler prototype install
installLogisticsTestHooks(); // gh #45/#46's test-only console hooks; unrelated to any live role

// The wrapFn()/profileClass() calls sprinkled at individual declaration sites (empire/creeps.ts,
// behaviors/interpreter.ts, operations/index.ts, etc.) self-gate on __PROFILER_ENABLED__ and
// dead-code-eliminate in every build except `PROFILE=1 npm run push-pserver:profile`
// (rollup.config.mjs). Only the console CLI itself needs a central, gated call site.
if (__PROFILER_ENABLED__) global.Profiler = initProfiler();

export function loop(): void {
  loadMemory();
  migrateMemory();
  stats.reset();
  tick();
}
