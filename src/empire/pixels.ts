// Converts a full CPU bucket into a pixel. Empire-wide (not per-colony): the bucket is a single
// account-level resource, not scoped to any one room.

import type { Intent } from "../intents/types";

/** Emits generatePixel whenever the bucket is at its cap — the bucket can't accumulate past
 * PIXEL_CPU_COST once full anyway, so spending it the moment it caps never costs real CPU headroom.
 * Private servers (e.g. the local pserver) don't implement Game.cpu.generatePixel at all, so callers must
 * feature-detect and pass the result in — see kernel/tick.ts's call site — rather than this module reading
 * Game itself, since the same bundle ships to both the private server and the real one. */
export function planPixels(bucket: number, pixelSupported: boolean): Intent[] {
  if (!pixelSupported) return [];
  return bucket >= PIXEL_CPU_COST ? [{ kind: "generatePixel" }] : [];
}
