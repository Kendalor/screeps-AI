// Converts a full CPU bucket into a pixel. Empire-wide (not per-colony): the bucket is a single
// account-level resource, not scoped to any one room.

import type { Intent } from "../intents/types";

/** Emits generatePixel whenever the bucket is at its cap — the bucket can't accumulate past
 * PIXEL_CPU_COST once full anyway, so spending it the moment it caps never costs real CPU headroom. */
export function planPixels(bucket: number): Intent[] {
  return bucket >= PIXEL_CPU_COST ? [{ kind: "generatePixel" }] : [];
}
