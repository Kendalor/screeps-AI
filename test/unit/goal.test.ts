import { describe, expect, it } from "vitest";
import { buildableAtRcl } from "../../src/layouts/goal";
import type { GoalLayout } from "../../src/layouts/sync";

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
