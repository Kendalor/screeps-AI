// The list of what exists, not a rules engine.

import { Mining } from "./mining";
import type { Operation } from "./operation";

export { Operation } from "./operation";
export { Mining, CONTAINERS_FROM_RCL } from "./mining";

/**
 * Every colony gets every operation kind, unconditionally. Whether an operation does anything is
 * *its own* decision, made against the snapshot it is handed — a colony with no sources gets a
 * `Mining` that returns `[]` from every channel. Hoisting that condition up here would split one
 * piece of knowledge across two files and let the two drift.
 */
export function operationsFor(room: string): Operation[] {
  return [new Mining(room)];
}
