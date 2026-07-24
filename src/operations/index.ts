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

/**
 * Every colony gets every operation kind, unconditionally. Whether an operation does anything is
 * *its own* decision, made against the snapshot it is handed — a colony with no sources gets a
 * `Mining` that returns `[]` from every channel. Hoisting that condition up here would split one
 * piece of knowledge across two files and let them drift.
 *
 * Order matters for one reason: the structures() poll is sequential, so an operation earlier in
 * this list paths its roads before later ones converge onto its routes. Defense, Upgrading,
 * Building and Bootstrap claim no structures, so their position is free; Mining is the only one
 * that paths today. A second pathing operation (RemoteMining) makes its order here a decision.
 */
export function operationsFor(room: string): Operation[] {
  return [
    new Mining(room),
    new Defense(room),
    new Upgrading(room),
    new Bootstrap(room),
    new Building(room),
    // Scouting claims no structures and its demand is the lowest priority, so its position here is
    // free — it neither paths ahead of Mining nor pre-empts any economy spawn.
    new Scouting(room)
  ];
}
