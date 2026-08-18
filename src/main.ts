// Loop entry. Importing lib/traveler installs the Creep.prototype.travelTo used by the interpreter.

import "./lib/traveler";
import { tick } from "./kernel/tick";
import { stats } from "./kernel/stats";
import { installConsoleCommands } from "./commands/console";
import { runLogisticsTask } from "./behaviors/logisticsTaskRunner";
import { installLogisticsTestHooks } from "./logistics/testHooks";
import { initProfiler } from "./lib/profiler";
import { log } from "./lib/log";
import { loadMemory } from "./memory/cache";
import { migrateMemory } from "./memory/migrate";

declare const __PROFILER_ENABLED__: boolean;

installConsoleCommands(); // module scope: survives global resets same as the traveler prototype install
installLogisticsTestHooks(); // gh #45's test-only __assignLogisticsTaskChain; unrelated to any live role

// The wrapFn()/profileClass() calls sprinkled at individual declaration sites (empire/creeps.ts,
// behaviors/interpreter.ts, operations/index.ts, etc.) self-gate on __PROFILER_ENABLED__ and
// dead-code-eliminate in every build except `PROFILE=1 npm run push-pserver:profile`
// (rollup.config.mjs). Only the console CLI itself needs a central, gated call site.
if (__PROFILER_ENABLED__) global.Profiler = initProfiler();

// Runs any creep's assigned gh #45 Task chain to completion — deliberately outside kernel/tick.ts's
// SYSTEMS/dispatchCreep (see logistics/task.ts's header): unconditional and independent of
// creep.memory.role, since no live role assigns memory.logisticsTask yet. A no-op for every creep until
// something (today, only the test-only __assignLogisticsTaskChain hook) sets it.
//
// Isolated per creep, same reasoning as empire/creeps.ts's runCreepBehaviors (see its own comment on a
// live 2026-08 incident where one throwing creep froze every other creep left in that tick's loop): this
// runs outside kernel/tick.ts's runGuarded machinery entirely, so without its own try/catch here a single
// bad task would abort every remaining creep's logistics task for the tick.
function runLogisticsTasks(): void {
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.spawning || !creep.memory.logisticsTask) continue;
    try {
      runLogisticsTask(creep);
    } catch (e) {
      log.error(`creep ${name} logistics task threw: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    }
  }
}

export function loop(): void {
  loadMemory();
  migrateMemory();
  stats.reset();
  tick();
  runLogisticsTasks();
}
