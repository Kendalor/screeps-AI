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

/** Every colony gets every operation kind unconditionally; each decides for itself whether to act.
 * Order matters only for structures(): Mining paths first so later operations converge onto its routes. */
export function operationsFor(room: string): Operation[] {
  return [
    new Mining(room),
    new Defense(room),
    new Upgrading(room),
    new Bootstrap(room),
    new Building(room),
    new Repairing(room),
    new Scouting(room),
    new Supply(room),
    new Logistics(room),
    new Reservation(room)
  ];
}
