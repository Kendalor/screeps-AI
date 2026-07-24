// The list of what exists, not a rules engine.

import { Bootstrap } from "./bootstrap";
import { Building } from "./building";
import { Defense } from "./defense";
import { Mining } from "./mining";
import type { Operation } from "./operation";
import { Scouting } from "./scouting";
import { Upgrading } from "./upgrading";

export { Operation } from "./operation";
export { Mining, CONTAINERS_FROM_RCL } from "./mining";
export { Defense } from "./defense";
export { Upgrading } from "./upgrading";
export { Bootstrap } from "./bootstrap";
export { Building } from "./building";
export { Scouting } from "./scouting";

/** Every colony gets every operation kind unconditionally; each decides for itself whether to act.
 * Order matters only for structures(): Mining paths first so later operations converge onto its routes. */
export function operationsFor(room: string): Operation[] {
  return [
    new Mining(room),
    new Defense(room),
    new Upgrading(room),
    new Bootstrap(room),
    new Building(room),
    new Scouting(room)
  ];
}
