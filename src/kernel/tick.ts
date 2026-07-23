// The tiered loop. `systems/` is gone — its capabilities are methods on Colony and Empire now — but
// the tiering machinery is not: it schedules those methods. Each entry names a capability and says
// when it runs; the loop applies intervals and CPU guards uniformly, so degradation stays gradual
// and stats keys stay comparable across the benchmark history. CPU guards measure against
// Game.cpu.limit (steady state), not tickLimit.

import type { Colony } from "../colony";
import { empire, type Empire } from "../empire";
import { execute } from "../intents/execute";
import type { Intent } from "../intents/types";
import { log } from "../lib/log";
import { buildEmpireSnapshot } from "../snapshot/colony";
import { cleanCreepMemory } from "./creepMemory";
import { stats } from "./stats";

interface SystemBase {
  name: string;
  tier: 1 | 2 | 3;
  interval?: number; // run every N ticks
}

// The scope discriminant tells the loop whether to run once for the empire or once per colony.
export interface ColonySystem extends SystemBase {
  scope: "colony";
  run(colony: Colony): Intent[];
}

export interface EmpireSystem extends SystemBase {
  scope: "empire";
  run(empire: Empire): Intent[];
}

export type System = ColonySystem | EmpireSystem;

// Room distance for spawn routing — the arbiter's one Game.* input, injected so it stays pure.
const roomDistance = (a: string, b: string): number => Game.map.getRoomLinearDistance(a, b);

// tier 1: must run every tick even at 0 bucket. tier 2: economy planning, skipped under CPU pressure. tier 3: luxury, needs bucket headroom.
export const SYSTEMS: System[] = [
  // Operations' direct intents — the channel that is not arbitrated. Their demand does not run here:
  // desiredCreeps() is polled by spawning, structures() by building. Runs first among tier-1 work so
  // Defense (an operation) fires its towers before anything else, as the old standalone defense
  // system did.
  //
  // Tier 1, no interval: per-tick capabilities live here (tower fire, link transfers, lab reactions),
  // none of which survive being sampled every 50th tick. An operation with genuinely periodic work
  // gates itself off colony.snapshot.tick; one whose write would change nothing returns nothing.
  { name: "operations", tier: 1, scope: "colony", run: runOperations },
  // Spawning is empire-scoped now: energy is per-room but spawn *routing* is cross-colony, so the
  // arbiter sees every colony's demand and every colony's idle spawns at once.
  { name: "spawning", tier: 1, scope: "empire", run: e => e.spawning(roomDistance) },
  { name: "creeps", tier: 1, scope: "empire", run: runCreeps },
  { name: "building", tier: 3, scope: "colony", interval: 100, run: c => c.building() },
  // Metrics: collect and paint the room dashboard. Tier 3 (luxury — dropped first under CPU
  // pressure) but every tick, so the panel and the harvest-rate window stay live rather than
  // sampling every Nth tick. Its Memory write (the harvest window) is idempotent-per-tick.
  { name: "metrics", tier: 3, scope: "colony", run: c => c.metrics() }
];

function runOperations(colony: Colony): Intent[] {
  return colony.operations.flatMap(op => op.intents(colony.snapshot));
}

// creeps() acts directly rather than returning intents; wrapped so it fits the Intent[]-returning
// System shape and still runs under the same CPU accounting.
function runCreeps(e: Empire): Intent[] {
  e.creeps();
  return [];
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
