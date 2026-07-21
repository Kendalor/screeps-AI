import { describe, expect, it } from "vitest";
import { buildableAtRcl } from "../../src/layouts/goal";
import type { GoalLayout, GoalPlacement } from "../../src/layouts/sync";

// A compact goal fixture: 1 spawn, 3 extensions, 1 tower, 1 storage.
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
    const result = buildableAtRcl(goal, 2);

    const byType = (t: string) => result.filter(p => p.type === t);
    expect(byType("spawn")).toHaveLength(1);
    expect(byType("extension")).toHaveLength(3);
    expect(byType("tower")).toHaveLength(0);
    expect(byType("storage")).toHaveLength(0);
  });

  it("keeps the lowest-order (cluster-nearest) instances when the cap is below the goal count", () => {
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

    expect(exts).toHaveLength(5);
    expect(exts.map(e => e.order)).toEqual([1, 2, 3, 4, 5]);
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
    // A symmetric ring, so the baked order alone cannot prefer a side.
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
      sources: [{ x: 5, y: 25 }]
    }).filter(p => p.type === "extension");

    const east = buildableAtRcl(ring, 2, {
      anchor: { x: 25, y: 25 },
      sources: [{ x: 45, y: 25 }]
    }).filter(p => p.type === "extension");

    expect(west).toHaveLength(5);
    expect(east).toHaveLength(5);
    const meanX = (ps: typeof west) => ps.reduce((s, p) => s + p.x, 0) / ps.length;
    expect(meanX(west)).toBeLessThan(meanX(east));
  });

  it("grows a compact blob, not a 1-wide tendril reaching at the sources", () => {
    // Ranking source-distance above storage-distance would string picks along a
    // single row toward the source; storage-distance first keeps them packed.
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
      sources: [{ x: 5, y: 25 }]
    }).filter(p => p.type === "extension");

    expect(picked).toHaveLength(5);
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
        { x: 1, y: 0, type: "storage", order: 1 }
      ]
    };

    const result = buildableAtRcl(g, 3);
    expect(result.map(p => p.type)).toEqual(["spawn"]);
  });
});
