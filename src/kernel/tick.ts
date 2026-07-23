// The tiered loop: systems are plain functions ordered in source; CPU guards measure against Game.cpu.limit so degradation is gradual.

import type { Colony } from "../colony";
import { empire, type Empire } from "../empire";
import { execute } from "../intents/execute";
import type { Intent } from "../intents/types";
import { log } from "../lib/log";
import { buildEmpireSnapshot } from "../snapshot/colony";
import { planBuilding } from "../systems/building";
import { runCreepBehaviors } from "../systems/creeps";
import { planDefense } from "../systems/defense";
import { planSpawning } from "../systems/spawning";
import { cleanCreepMemory } from "./creepMemory";
import { stats } from "./stats";

interface SystemBase {
  name: string;
  tier: 1 | 2 | 3;
  interval?: number; // run every N ticks
}

// The scope discriminant is the cheapest thing that type-checks, deliberately: SYSTEMS is scaffolding being dismantled
// into operations, not a shape worth designing. Colony-scoped systems get the loop from the tick rather than writing it.
export interface ColonySystem extends SystemBase {
  scope: "colony";
  run(colony: Colony): Intent[];
}

export interface EmpireSystem extends SystemBase {
  scope: "empire";
  run(empire: Empire): Intent[];
}

export type System = ColonySystem | EmpireSystem;

// tier 1: must run every tick even at 0 bucket. tier 2: economy planning, skipped under CPU pressure. tier 3: luxury, needs bucket headroom.
export const SYSTEMS: System[] = [
  { name: "defense", tier: 1, scope: "colony", run: planDefense },
  { name: "spawning", tier: 1, scope: "colony", run: planSpawning },
  { name: "creeps", tier: 1, scope: "empire", run: runCreepBehaviors },
  // Operations' direct intents — the channel that is not arbitrated. Their demand does not run here:
  // desiredCreeps() is polled by spawning, structures() by building. Keeps the interval and tier the
  // mining system had, so the benchmark stays comparable.
  { name: "operations", tier: 2, scope: "colony", interval: 50, run: runOperations },
  { name: "building", tier: 3, scope: "colony", interval: 100, run: planBuilding }
];

function runOperations(colony: Colony): Intent[] {
  return colony.operations.flatMap(op => op.intents(colony.snapshot));
}

// `injected` exists for the same reason the `systems` parameter does: dispatch tests care about tiers, intervals and
// isolation, not about standing up a Room the snapshot builder will accept. Not a default parameter — that would build
// the snapshot before cleanCreepMemory() below.
export function tick(systems: System[] = SYSTEMS, injected?: Empire): void {
  // Before the snapshot, so no system observes a half-cleaned Memory.
  cleanCreepMemory();
  const world = injected ?? empire(buildEmpireSnapshot());
  for (const sys of systems) {
    if (sys.interval && Game.time % sys.interval !== 0) continue;
    // Guards stay outside the colony loop: under CPU pressure every colony drops tier-3 work together, rather than the
    // first colony doing everything and the last starving.
    if (sys.tier >= 2 && Game.cpu.getUsed() > Game.cpu.limit * 0.6) break;
    if (sys.tier >= 3 && (Game.cpu.getUsed() > Game.cpu.limit * 0.85 || Game.cpu.bucket < 3000)) break;
    const before = Game.cpu.getUsed();
    // Inside the loop, so one colony's bad snapshot doesn't blind its siblings' defense.
    if (sys.scope === "empire") {
      runGuarded(sys.name, () => execute(sys.run(world)));
    } else {
      for (const c of world.colonies) runGuarded(sys.name, () => execute(sys.run(c)));
    }
    stats.record(sys.name, Game.cpu.getUsed() - before);
  }
}

function runGuarded(name: string, fn: () => void): void {
  try {
    fn();
  } catch (e) {
    log.error(`${name} threw: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  }
}
