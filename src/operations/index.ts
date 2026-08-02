// The list of what exists, not a rules engine.

import { profileClass } from "../lib/profiler";
import { Bootstrap } from "./bootstrap";
import { Building } from "./building";
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
export { Building } from "./building";
export { Repairing } from "./repairing";
export { Scouting } from "./scouting";
export { Supply } from "./supply";
export { Logistics } from "./logistics";
export { Reservation } from "./reservation";
export { Attack } from "./attack";

/** Every colony gets every operation kind unconditionally; each decides for itself whether to act.
 * Order matters for structures(): Mining paths first so later operations converge onto its routes. It
 * also matters for desiredCreeps() at the one priority Supply and Logistics/transport tie on (100):
 * planSpawning's sort is stable, so Logistics listed ahead of Supply means transport wins that tie —
 * the right call the moment both become newly affordable at once (RCL3/550 capacity), since transport
 * alone already covers filling spawn/extensions pre-storage (see logistics/graph.ts's consumers()
 * ranking spawnSystem top), making Supply's dedicated topper redundant with it in that exact window.
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
