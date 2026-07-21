import { describe, expect, it } from "vitest";
import { buildableAtRcl } from "../../src/layouts/goal";
import type { GoalLayout, GoalPlacement } from "../../src/layouts/sync";

// A compact goal fixture: 1 spawn, 3 extensions, 1 tower, 1 storage.
// order values are pre-baked (spawn/tower/storage seeded first, then extensions
// in cluster-growth order).
const goal: GoalLayout = {
  anchor: { x: 25, y: 25 },
  placements: [
    { x: 0, y: 0, type: "spawn", order: 0 },
    { x: 1, y: 0, type: "storage", order: 1 },
    { x: -1, y: 0, type: "tower", order: 2 },
    { x: 0, y: -1, type: "extension", order: 3 },
    { x: 0, y: -2, type: "extension", order: 4 },
    { x: 0, y: -3, type: "extension", order: 5 }
  ]
};

describe("buildableAtRcl", () => {
  it("keeps only what each structure type's RCL cap allows", () => {
    // RCL2: spawn cap 1, extension cap 5 (we have 3, all fit), tower cap 0, storage cap 0.
    const result = buildableAtRcl(goal, 2);

    const byType = (t: string) => result.filter(p => p.type === t);
    expect(byType("spawn")).toHaveLength(1);
    expect(byType("extension")).toHaveLength(3);
    expect(byType("tower")).toHaveLength(0);
    expect(byType("storage")).toHaveLength(0);
  });

  it("keeps the lowest-order (cluster-nearest) instances when the cap is below the goal count", () => {
    // A goal with more extensions than an RCL2 room can build (cap 5).
    const many: GoalLayout = {
      anchor: { x: 25, y: 25 },
      placements: [
        { x: 0, y: 0, type: "spawn", order: 0 },
        ...Array.from({ length: 8 }, (_, i) => ({
          x: 0,
          y: -(i + 1),
          type: "extension" as const,
          order: i + 1
        }))
      ]
    };

    const exts = buildableAtRcl(many, 2).filter(p => p.type === "extension");

    expect(exts).toHaveLength(5); // RCL2 extension cap
    expect(exts.map(e => e.order)).toEqual([1, 2, 3, 4, 5]); // the 5 earliest, not the last 5
  });

  it("returns the full goal at RCL8", () => {
    const many: GoalLayout = {
      anchor: { x: 25, y: 25 },
      placements: [
        { x: 0, y: 0, type: "spawn", order: 0 },
        { x: 1, y: 0, type: "storage", order: 1 },
        { x: -1, y: 0, type: "terminal", order: 2 }
      ]
    };

    expect(buildableAtRcl(many, 8)).toHaveLength(3);
  });

  it("picks the source-facing extensions when a room context is supplied", () => {
    // A symmetric ring of extensions around storage: every one is equally
    // adjacent to the core, so the baked order alone cannot prefer a side. With
    // sources to the west, the western extensions must be the ones that fit
    // under the RCL2 cap of 5.
    const ring: GoalLayout = {
      anchor: { x: 25, y: 25 },
      placements: [
        { x: 0, y: 0, type: "spawn", order: 0 },
        { x: 0, y: 0, type: "storage", order: 1 },
        ...[-3, -2, 2, 3].flatMap((dx, i) =>
          [-1, 0, 1].map((dy, j) => ({
            x: dx,
            y: dy,
            type: "extension" as const,
            order: 2 + i * 3 + j
          }))
        )
      ]
    };

    const west = buildableAtRcl(ring, 2, {
      anchor: { x: 25, y: 25 },
      sources: [{ x: 5, y: 25 }] // far west
    }).filter(p => p.type === "extension");

    const east = buildableAtRcl(ring, 2, {
      anchor: { x: 25, y: 25 },
      sources: [{ x: 45, y: 25 }] // far east
    }).filter(p => p.type === "extension");

    expect(west).toHaveLength(5);
    expect(east).toHaveLength(5);
    // Each side leans toward its own sources: west picks more negative-x tiles.
    const meanX = (ps: typeof west) => ps.reduce((s, p) => s + p.x, 0) / ps.length;
    expect(meanX(west)).toBeLessThan(meanX(east));
  });

  it("grows a compact blob, not a 1-wide tendril reaching at the sources", () => {
    // A 5x5 field of extensions west of storage, with the source further west.
    // Every step toward the source is contiguous, so ranking source-distance
    // above storage-distance would string the picks out along a single row
    // (y=0: -1,-2,-3,-4,-5) and never fill sideways. Storage-distance first
    // keeps the picks packed against storage instead.
    const field: GoalPlacement[] = [];
    let order = 1;
    for (let dx = -5; dx <= -1; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        field.push({ x: dx, y: dy, type: "extension", order: order++ });
      }
    }
    const g: GoalLayout = {
      anchor: { x: 25, y: 25 },
      placements: [{ x: 0, y: 0, type: "storage", order: 0 }, ...field]
    };

    const picked = buildableAtRcl(g, 2, {
      anchor: { x: 25, y: 25 },
      sources: [{ x: 5, y: 25 }] // far west — straight along y=0
    }).filter(p => p.type === "extension");

    expect(picked).toHaveLength(5);
    // A tendril would be all-y=0 and span x from -1 to -5. A compact blob stays
    // within one or two columns of storage.
    const xs = picked.map(p => p.x);
    expect(Math.min(...xs)).toBeGreaterThan(-4);
    expect(new Set(picked.map(p => p.y)).size).toBeGreaterThan(1);
  });

  it("falls back to the baked order when the room has no sources", () => {
    const withCtx = buildableAtRcl(goal, 2, { anchor: { x: 25, y: 25 }, sources: [] });
    expect(withCtx).toEqual(buildableAtRcl(goal, 2));
  });

  it("excludes types with no RCL cap", () => {
    const g: GoalLayout = {
      anchor: { x: 25, y: 25 },
      placements: [
        { x: 0, y: 0, type: "spawn", order: 0 },
        { x: 1, y: 0, type: "storage", order: 1 } // storage cap is 0 until RCL4
      ]
    };

    const result = buildableAtRcl(g, 3);
    expect(result.map(p => p.type)).toEqual(["spawn"]);
  });
});
