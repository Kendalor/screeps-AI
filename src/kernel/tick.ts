// The tiered loop: schedules Colony/Empire capability methods by tier, interval, and CPU guard.
// CPU guards measure against Game.cpu.limit (steady state), not tickLimit.

import type { Colony } from "../colony";
import { empire, type Empire } from "../empire";
import { runAttackFlags } from "../empire/attackFlags";
import { runColonizeFlags } from "../empire/colonizeFlags";
import { runDrainFlags } from "../empire/drainFlags";
import { runParadeFlags } from "../empire/paradeFlags";
import { autoPickColonyTarget } from "../empire/pickColonyTargets";
import { runRemoteInvaderAttacks } from "../empire/remoteInvaderAttacks";
import { execute } from "../intents/execute";
import type { Intent } from "../intents/types";
import { log } from "../lib/log";
import { buildEmpireSnapshot } from "../snapshot/colony";
import { cleanColonyMemory } from "./colonyMemory";
import { cleanCreepMemory } from "./creepMemory";
import { scanHostileActions } from "./hostileActions";
import { stats } from "./stats";

interface SystemBase {
  name: string;
  tier: 1 | 2 | 3;
  interval?: number; // run every N ticks
}

/** Whether the loop runs this once for the empire or once per colony. */
export interface ColonySystem extends SystemBase {
  scope: "colony";
  // `isFirst`: true for exactly one colony per tick, in iteration order — lets a system (metrics' CPU
  // block) show empire-wide data once instead of repeating it on every colony's panel.
  run(colony: Colony, isFirst: boolean): Intent[];
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
  // Operations' direct intents (tower fire, link transfers, etc), unarbitrated. Runs first so Defense fires before anything else.
  { name: "operations", tier: 1, scope: "colony", run: runOperations },
  // Empire-scoped: spawn routing is cross-colony, so the arbiter sees every colony's demand and idle spawns at once.
  { name: "spawning", tier: 1, scope: "empire", run: e => e.spawning(roomDistance) },
  { name: "creeps", tier: 1, scope: "empire", run: runCreeps },
  // Repurpose idle builders once construction is finished (converted creeps act under the new role next
  // tick). Tier 2, so it's placed after the tier-1 creeps run — a tier-2 system ahead of creeps would
  // `break` the loop under CPU pressure and skip creep behavior entirely.
  { name: "workforce", tier: 2, scope: "colony", run: c => c.maintainWorkforce() },
  { name: "building", tier: 3, scope: "colony", interval: 100, run: c => c.building() },
  // Tier 3 but every tick, so the panel and harvest-rate window stay live rather than sampled. CPU is
  // empire-wide and last-tick's (this tick's own total isn't known until after it finishes), so it's
  // shown on only the first colony's panel rather than repeated on every room.
  { name: "metrics", tier: 3, scope: "colony", run: (c, isFirst) => c.metrics(isFirst ? Memory.stats?.cpu : undefined) },
  // Automatic colonize target selection — a luxury, CPU-pressure-skippable unlike the flag path
  // (runColonizeFlags, below), since missing one ~5000-tick firing under load just means trying again the
  // next time it comes around, not silently losing a manually-placed request. AUTO_PICK_INTERVAL is its
  // own internal throttle (this `interval:1` just means "check every tick whether that internal throttle
  // fired"), same relationship `metrics` has to its own once-per-firing cost below.
  { name: "colonizeTargets", tier: 3, scope: "empire", run: runAutoPickColonyTarget }
];

function runAutoPickColonyTarget(e: Empire): Intent[] {
  autoPickColonyTarget(e);
  return [];
}

function runOperations(colony: Colony): Intent[] {
  // Computed once per tick and hand it to every operation — see Operation.intents' doc comment for why
  // this doesn't violate the no-reaching-siblings rule.
  const colonyRequestParts = colony.requestParts();
  return colony.operations.flatMap(op => op.intents(colony.snapshot, colonyRequestParts));
}

// Wrapped so e.creeps() fits the Intent[]-returning System shape and shares CPU accounting.
function runCreeps(e: Empire): Intent[] {
  return e.creeps();
}

// `injected` isn't a default parameter — that would build the snapshot before cleanCreepMemory() below.
export function tick(systems: System[] = SYSTEMS, injected?: Empire): void {
  const tickStart = Game.cpu.getUsed();
  // Before the snapshot, so no system observes a half-cleaned Memory.
  cleanCreepMemory();
  cleanColonyMemory();
  // Every tick, untiered: an event log is only readable the tick it happened, so this can't be skipped
  // under CPU pressure the way a tier-3 SYSTEMS entry can (see hostileActions.ts's doc).
  runGuarded("hostileActions", scanHostileActions);
  const snapshotStart = Game.cpu.getUsed();
  const world = injected ?? empire(buildEmpireSnapshot());
  stats.record("snapshot", Game.cpu.getUsed() - snapshotStart);
  for (const sys of systems) {
    if (sys.interval && Game.time % sys.interval !== 0) continue;
    // Outside the colony loop, so under CPU pressure every colony drops tier-3 work together.
    if (sys.tier >= 2 && Game.cpu.getUsed() > Game.cpu.limit * 0.6) break;
    if (sys.tier >= 3 && (Game.cpu.getUsed() > Game.cpu.limit * 0.85 || Game.cpu.bucket < 3000)) break;
    const before = Game.cpu.getUsed();
    // Inside the loop, so one colony's bad snapshot doesn't blind its siblings' defense.
    if (sys.scope === "empire") {
      runGuarded(sys.name, () => execute(sys.run(world)));
    } else {
      world.colonies.forEach((c, i) => runGuarded(sys.name, () => execute(sys.run(c, i === 0))));
    }
    stats.record(sys.name, Game.cpu.getUsed() - before);
  }
  // Flag-triggered colonize, not a SYSTEMS entry: Colonize isn't a default operation (see
  // operations/index.ts), so it has no per-colony slot in the loop above to hang off of. Runs
  // unconditionally (never tier-gated) on the same `world` the loop just used, so a placed flag's error
  // is never silently swallowed under CPU pressure the way a tier-3 system would be.
  runGuarded("colonizeFlags", () => runColonizeFlags(world));
  // Flag-triggered attack, same reasoning as colonizeFlags above — Attack isn't a default operation either.
  runGuarded("attackFlags", () => runAttackFlags(world));
  // Flag-triggered drain, same reasoning as attackFlags above — Drain isn't a default operation either.
  runGuarded("drainFlags", () => runDrainFlags(world));
  // Flag-triggered parade, same reasoning as attackFlags above — Parade isn't a default operation either.
  runGuarded("paradeFlags", () => runParadeFlags(world));
  // Automatic counterpart to attackFlags: launches an Attack at any selected remote reserved by the
  // Invader NPC with its core still standing — see remoteInvaderAttacks.ts's header.
  runGuarded("remoteInvaderAttacks", () => runRemoteInvaderAttacks(world));
  stats.record("total", Game.cpu.getUsed() - tickStart);
  stats.flush();
}

function runGuarded(name: string, fn: () => void): void {
  try {
    fn();
  } catch (e) {
    log.error(`${name} threw: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
  }
}
