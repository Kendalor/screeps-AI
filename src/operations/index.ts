// The list of what exists, not a rules engine.

import { profileClass } from "../lib/profiler";
import { Bootstrap } from "./bootstrap";
import { Building } from "./construction";
import { Defense } from "./defense";
import { Logistics } from "./logistics";
import { Mining } from "./mining";
import type { Operation } from "./operation";
import { Repairing } from "./repairing";
import { Reservation } from "./reservation";
import { Scouting } from "./scouting";
import { Supply } from "./supply";
import { Upgrading } from "./upgrading";

// Each is a real class whose intents()/desiredCreeps()/structures() run every tick over a fresh
// snapshot — the "does the pure/stateless architecture recompute too much?" hypothesis lives here.
// profileClass mutates the (ordinary, mutable) class prototype, unlike wrapFn's declaration-site
// approach needed for plain functions — see lib/profiler.ts's file header for why the two differ.
for (const op of [Bootstrap, Building, Defense, Logistics, Mining, Repairing, Reservation, Scouting, Supply, Upgrading]) {
  profileClass(op);
}

export { Operation } from "./operation";
export { Mining, CONTAINERS_FROM_ENERGY_CAPACITY } from "./mining";
export { Defense } from "./defense";
export { Upgrading } from "./upgrading";
export { Bootstrap } from "./bootstrap";
export { Building } from "./construction";
export { Repairing } from "./repairing";
export { Scouting } from "./scouting";
export { Supply } from "./supply";
export { Logistics } from "./logistics";
export { Reservation } from "./reservation";
export { Attack } from "./attack";
export { SimpleBaitTowerOperation } from "./simpleBaitTower";
export { DemolishOperation } from "./demolish";
export { SimpleHealOperation } from "./simpleHeal";

/** Every colony gets every operation kind unconditionally; each decides for itself whether to act.
 * Order matters for structures(): Mining paths first so later operations converge onto its routes. It
 * used to also matter for desiredCreeps() spawn-priority ties between Supply and Logistics/transport,
 * both then at 100 — planSpawning's stable sort let array order (Logistics listed ahead of Supply)
 * decide the tie, meant to let transport win only the moment both first become affordable at once
 * (RCL3/550 capacity). In practice the ordering wasn't scoped to that window: transport won the tie on
 * every tick it also wanted a creep, indefinitely starving Supply on a live single-spawn colony (0
 * supply creeps ever spawned while transport's fleet grew unopposed). Fixed by giving Supply its own
 * higher priority (101, see behaviors/roles/supply.ts) so it no longer depends on this array's order.
 *
 * `siblingRemoteSourceIds`: sources already claimed by any OTHER colony's Memory.remotes this tick —
 * see Mining's constructor doc. Defaults to empty so existing single-colony callers are unaffected. */
export function operationsFor(room: string, siblingRemoteSourceIds: ReadonlySet<Id<Source>> = new Set()): Operation[] {
  return [
    new Mining(room, siblingRemoteSourceIds),
    new Defense(room),
    new Upgrading(room),
    new Bootstrap(room),
    new Building(room),
    new Repairing(room),
    new Scouting(room),
    new Logistics(room),
    new Supply(room),
    new Reservation(room)
  ];
}

/** One operation `kind`, for listing every kind that can request a creep spawn (desiredCreeps) — see
 * `SPAWNABLE_OPERATIONS` below. `trigger` documents *why* a colony would or wouldn't be attached to it
 * right now: "always" mirrors operationsFor() above verbatim, everything else names the memory/flag
 * condition Colony's constructor gates attachment on (see each operation's own file header). */
export interface SpawnableOperationInfo {
  kind: string;
  trigger: string;
}

/** Every Operation subclass that overrides `desiredCreeps()` — i.e. every kind that can end up
 * requesting a spawn — not just the ten unconditionally attached by operationsFor(). Colonize, Attack,
 * Drain and Parade are flag/memory-triggered add-ons (see operations/index.ts's imports for where each
 * is actually attached: Colony's constructor for Attack/Colonize/Drain, paradeFlags.ts for Parade) and
 * deliberately excluded from operationsFor() itself, so this list has to be hand-kept in sync with the
 * Operation subclasses rather than derived from that array. Defense is the one exception: it's always
 * attached (below) AND flag-triggerable (a "defend"/"defend:<room>" flag adds a target to
 * ColonyMemory.defending, pooled into the same Defense instance — see defense.ts/defendFlags.ts), so its
 * `trigger` names both. */
export const SPAWNABLE_OPERATIONS: readonly SpawnableOperationInfo[] = [
  { kind: "mining", trigger: "always" },
  { kind: "defense", trigger: "always (plus ColonyMemory.defending targets from a defend flag)" },
  { kind: "upgrading", trigger: "always" },
  { kind: "bootstrap", trigger: "always" },
  { kind: "building", trigger: "always" },
  { kind: "repairing", trigger: "always" },
  { kind: "scouting", trigger: "always" },
  { kind: "logistics", trigger: "always" },
  { kind: "supply", trigger: "always" },
  { kind: "reservation", trigger: "always" },
  { kind: "attack", trigger: "ColonyMemory.attacking non-empty (attack flag)" },
  { kind: "colonize", trigger: "ColonyMemory.colonizing non-empty (colonize flag or auto-pick)" },
  { kind: "drain", trigger: "ColonyMemory.draining set (drain flag)" },
  { kind: "parade", trigger: "ColonyMemory.parading set (parade flag)" },
  { kind: "simpleBaitTower", trigger: "ColonyMemory.simpleBaitTower set (simpleBaitTower flag)" },
  { kind: "demolish", trigger: "ColonyMemory.demolish set (demolish flag)" },
  { kind: "simpleHeal", trigger: "ColonyMemory.simpleHeal set (simpleHeal flag)" }
];
