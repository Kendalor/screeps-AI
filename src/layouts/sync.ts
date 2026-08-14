// Flattens a room-planner export ({rcl, structures:{type:[{x,y}]}} in absolute room coords) into
// a single RCL8 goal layout, stored anchor-relative with a baked build-order. Edit files under
// src/layouts/source/ and run `npm run sync-layouts` to regenerate.

import { range, type XY } from "../lib/geometry";

// Build-time codegen (plain Node) — no game ambient STRUCTURE_* globals available, so use literals.
const EXTENSION = "extension";
const STORAGE = "storage";

export interface PlannerLayout {
  rcl: number;
  structures: Partial<Record<string, XY[]>>;
}

export interface GoalPlacement extends XY {
  type: BuildableStructureConstant;
  order: number;
}

export interface GoalLayout {
  anchor: XY;
  placements: GoalPlacement[];
}

// The anchor is the tile between terminal and storage, which sit on opposite sides of it.
function anchorOf(structures: PlannerLayout["structures"]): XY {
  const terminal = structures.terminal?.[0];
  const storage = structures.storage?.[0];
  if (!terminal || !storage) {
    throw new Error("layout must have a terminal and a storage to derive the anchor");
  }
  return { x: (terminal.x + storage.x) / 2, y: (terminal.y + storage.y) / 2 };
}

export function flattenGoal(source: PlannerLayout): GoalLayout {
  const anchor = anchorOf(source.structures);
  const origin: XY = { x: 0, y: 0 }; // anchor is the relative origin

  const rel = (pos: XY): XY => ({ x: pos.x - anchor.x, y: pos.y - anchor.y });

  // Extensions are numerous enough that build order matters; everything else is capped-or-nothing per RCL.
  const seeds: GoalPlacement[] = [];
  const extensions: XY[] = [];
  let storage: XY | undefined;
  for (const type of Object.keys(source.structures)) {
    for (const pos of source.structures[type] ?? []) {
      if (type === EXTENSION) {
        extensions.push(rel(pos));
      } else {
        if (type === STORAGE) storage = rel(pos);
        seeds.push({ ...rel(pos), type: type as BuildableStructureConstant, order: 0 });
      }
    }
  }

  const ordered = orderExtensions(extensions, storage ?? origin);

  const placements = [...seeds, ...ordered];
  // Reassign a single contiguous global build-order: seeds first, then extensions by blob-growth order.
  placements.forEach((p, i) => (p.order = i));
  return { anchor, placements };
}

// Greedy nearest-to-blob, seeded on storage and grown through extensions only, so the cluster forms
// instead of an even ring. Ties break on distance to seed; source bias happens at runtime in layouts/goal.ts.
function orderExtensions(extensions: XY[], seed: XY): GoalPlacement[] {
  const remaining = [...extensions];
  const blob: XY[] = [seed];
  const out: GoalPlacement[] = [];

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestKey: [number, number] = [Infinity, Infinity];
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i];
      let nearest = Infinity;
      for (const b of blob) {
        const d = range(cand, b);
        if (d < nearest) nearest = d;
      }
      const key: [number, number] = [nearest, range(cand, seed)];
      if (key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) {
        bestKey = key;
        bestIdx = i;
      }
    }
    const [chosen] = remaining.splice(bestIdx, 1);
    blob.push(chosen);
    out.push({ ...chosen, type: EXTENSION as BuildableStructureConstant, order: 0 });
  }
  return out;
}
