// The tiered loop (docs/rewrite-skeleton.md §2). Replaces OperationsManager
// and the Operation lifecycle. Systems are plain functions ordered in source;
// CPU guards measure against Game.cpu.limit so degradation is gradual.

import { execute } from "../intents/execute";
import type { Intent } from "../intents/types";
import { log } from "../lib/log";
import { buildEmpireSnapshot } from "../snapshot/colony";
import type { EmpireSnapshot } from "../snapshot/types";
import { planBuilding } from "../systems/building";
import { runCreepBehaviors } from "../systems/creeps";
import { planDefense } from "../systems/defense";
import { planSpawning } from "../systems/spawning";
import { stats } from "./stats";

export interface System {
  name: string;
  tier: 1 | 2 | 3;
  interval?: number; // run every N ticks
  run(snap: EmpireSnapshot): Intent[];
}

// Ordered: tier 1 must run every tick even at 0 bucket; tier 2 is economy
// planning skipped under CPU pressure; tier 3 is luxury needing bucket headroom.
export const SYSTEMS: System[] = [
  // tier 1 — must run, every tick, even at 0 bucket
  { name: "defense", tier: 1, run: planDefense },
  { name: "spawning", tier: 1, run: planSpawning },
  { name: "creeps", tier: 1, run: runCreepBehaviors }, // interpreter dispatch
  // links (tier 1) and tier 2 land with their ports
  { name: "building", tier: 3, interval: 100, run: planBuilding }
];

export function tick(systems: System[] = SYSTEMS): void {
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
