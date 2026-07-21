// The tiered loop: systems are plain functions ordered in source; CPU guards measure against Game.cpu.limit so degradation is gradual.

import { execute } from "../intents/execute";
import type { Intent } from "../intents/types";
import { log } from "../lib/log";
import { buildEmpireSnapshot } from "../snapshot/colony";
import type { EmpireSnapshot } from "../snapshot/types";
import { planBuilding } from "../systems/building";
import { runCreepBehaviors } from "../systems/creeps";
import { planDefense } from "../systems/defense";
import { planMining } from "../systems/mining";
import { planSpawning } from "../systems/spawning";
import { cleanCreepMemory } from "./creepMemory";
import { stats } from "./stats";

export interface System {
  name: string;
  tier: 1 | 2 | 3;
  interval?: number; // run every N ticks
  run(snap: EmpireSnapshot): Intent[];
}

// tier 1: must run every tick even at 0 bucket. tier 2: economy planning, skipped under CPU pressure. tier 3: luxury, needs bucket headroom.
export const SYSTEMS: System[] = [
  { name: "defense", tier: 1, run: planDefense },
  { name: "spawning", tier: 1, run: planSpawning },
  { name: "creeps", tier: 1, run: runCreepBehaviors },
  { name: "mining", tier: 2, interval: 50, run: planMining },
  { name: "building", tier: 3, interval: 100, run: planBuilding }
];

export function tick(systems: System[] = SYSTEMS): void {
  // Before the snapshot, so no system observes a half-cleaned Memory.
  cleanCreepMemory();
  const snap = buildEmpireSnapshot();
  for (const sys of systems) {
    if (sys.interval && Game.time % sys.interval !== 0) continue;
    if (sys.tier >= 2 && Game.cpu.getUsed() > Game.cpu.limit * 0.6) break;
    if (sys.tier >= 3 && (Game.cpu.getUsed() > Game.cpu.limit * 0.85 || Game.cpu.bucket < 3000)) break;
    const before = Game.cpu.getUsed();
    try {
      execute(sys.run(snap));
    } catch (e) {
      log.error(`${sys.name} threw: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    }
    stats.record(sys.name, Game.cpu.getUsed() - before);
  }
}
