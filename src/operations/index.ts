// The list of what exists, not a rules engine.

import { Defense } from "./defense";
import { Mining } from "./mining";
import type { Operation } from "./operation";
import { Upgrading } from "./upgrading";

export { Operation } from "./operation";
export { Mining, CONTAINERS_FROM_RCL } from "./mining";
export { Defense } from "./defense";
export { Upgrading } from "./upgrading";

/**
 * Every colony gets every operation kind, unconditionally. Whether an operation does anything is
 * *its own* decision, made against the snapshot it is handed — a colony with no sources gets a
 * `Mining` that returns `[]` from every channel. Hoisting that condition up here would split one
 * piece of knowledge across two files and let the two drift.
 *
 * Order matters for one reason only: the structures() poll is sequential, so an operation earlier
 * in this list paths its roads before later ones and they converge onto its routes. Defense and
 * Upgrading claim no structures, so their position is free; Mining is the only one that paths
 * today. When a second pathing operation lands (RemoteMining), its order here becomes a decision.
 */
export function operationsFor(room: string): Operation[] {
  return [new Mining(room), new Defense(room), new Upgrading(room)];
}
