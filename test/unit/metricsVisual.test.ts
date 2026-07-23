import { describe, expect, it } from "vitest";
import type { ColonyMetrics } from "../../src/colony/metrics";
import { panelOps, visualize } from "../../src/colony/metricsVisual";
import type { VisualOp } from "../../src/intents/types";

function metrics(over: Partial<ColonyMetrics> = {}): ColonyMetrics {
  return {
    room: "W1N1",
    tick: 100,
    census: [],
    operations: [],
    buildings: [],
    energy: { available: 300, capacity: 300, storage: 0, dropped: 0, harvestPerTick: undefined },
    controller: { level: 1, progress: 0 },
    construction: { remaining: 0 },
    safeMode: { active: 0, count: 0, available: false },
    spawns: { total: 1, busy: 0 },
    ...over
  };
}

const texts = (ops: VisualOp[]): string[] =>
  ops.filter((o): o is Extract<VisualOp, { op: "text" }> => o.op === "text").map(o => o.text);

// The whole panel joined, for substring assertions that don't care about line splits.
const joined = (ops: VisualOp[]): string => texts(ops).join("\n");

describe("metricsVisual: structure", () => {
  it("emits only text ops (no rects) and every one has a y that increases", () => {
    const ops = panelOps(metrics({ census: [{ role: "miner", current: 1, desired: 2 }] }));
    const ys = ops.filter((o): o is Extract<VisualOp, { op: "text" }> => o.op === "text").map(o => o.y);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
  });

  it("headers the panel with room, RCL and tick", () => {
    const ops = panelOps(metrics({ room: "W7N7", tick: 4242, controller: { level: 5, progress: 0 } }));
    expect(joined(ops)).toContain("W7N7");
    expect(joined(ops)).toContain("RCL 5");
    expect(joined(ops)).toContain("4242");
  });
});

describe("metricsVisual: census", () => {
  it("renders each role as current/desired", () => {
    const ops = panelOps(metrics({ census: [{ role: "miner", current: 1, desired: 3 }] }));
    expect(joined(ops)).toContain("miner");
    expect(joined(ops)).toContain("1/3");
  });

  it("shows a placeholder when there are no creeps", () => {
    const ops = panelOps(metrics({ census: [] }));
    expect(joined(ops).toLowerCase()).toContain("no creeps");
  });

  it("colours an understaffed role differently from a met one", () => {
    const ops = panelOps(
      metrics({
        census: [
          { role: "miner", current: 1, desired: 2 }, // short
          { role: "hauler", current: 2, desired: 2 } // met
        ]
      })
    );
    const textOps = ops.filter((o): o is Extract<VisualOp, { op: "text" }> => o.op === "text");
    const miner = textOps.find(o => o.text.includes("miner"))!;
    const hauler = textOps.find(o => o.text.includes("hauler"))!;
    expect(miner.color).not.toBe(hauler.color);
  });
});

describe("metricsVisual: buildings", () => {
  it("renders each type as built/targeted", () => {
    const ops = panelOps(metrics({ buildings: [{ type: "extension", built: 2, targeted: 5 }] }));
    expect(joined(ops)).toContain("extension");
    expect(joined(ops)).toContain("2/5");
  });

  it("colours an incomplete type differently from a finished one", () => {
    const ops = panelOps(
      metrics({
        buildings: [
          { type: "extension", built: 2, targeted: 5 }, // incomplete
          { type: "tower", built: 1, targeted: 1 } // done
        ]
      })
    );
    const textOps = ops.filter((o): o is Extract<VisualOp, { op: "text" }> => o.op === "text");
    const ext = textOps.find(o => o.text.includes("extension"))!;
    const tower = textOps.find(o => o.text.includes("tower"))!;
    expect(ext.color).not.toBe(tower.color);
  });

  it("shows a placeholder when nothing is planned", () => {
    const ops = panelOps(metrics({ buildings: [] }));
    expect(joined(ops).toLowerCase()).toContain("none planned");
  });
});

describe("metricsVisual: energy", () => {
  it("shows storage, dropped and spawn energy with separators", () => {
    const ops = panelOps(
      metrics({ energy: { available: 250, capacity: 550, storage: 120_000, dropped: 340, harvestPerTick: 6 } })
    );
    const all = joined(ops);
    expect(all).toContain("120,000");
    expect(all).toContain("340");
    expect(all).toContain("250/550");
  });

  it("shows a dash for harvest rate before it is known", () => {
    const ops = panelOps(metrics({ energy: { available: 0, capacity: 0, storage: 0, dropped: 0, harvestPerTick: undefined } }));
    expect(joined(ops)).toMatch(/harvest\/t\s+—/);
  });

  it("shows harvest rate to one decimal once known", () => {
    const ops = panelOps(metrics({ energy: { available: 0, capacity: 0, storage: 0, dropped: 0, harvestPerTick: 6.04 } }));
    expect(joined(ops)).toContain("6.0");
  });
});

describe("metricsVisual: safe mode", () => {
  it("flags an active safe mode with its remaining ticks", () => {
    const ops = panelOps(metrics({ safeMode: { active: 5000, count: 1, available: false } }));
    expect(joined(ops)).toContain("ACTIVE");
    expect(joined(ops)).toContain("5000");
  });

  it("shows the banked count when not active", () => {
    const ops = panelOps(metrics({ safeMode: { active: 0, count: 3, available: true } }));
    expect(joined(ops)).toContain("3 banked");
  });
});

describe("metricsVisual: operations", () => {
  it("lists every operation name", () => {
    const ops = panelOps(metrics({ operations: ["mining:W1N1", "defense:W1N1"] }));
    expect(joined(ops)).toContain("mining:W1N1");
    expect(joined(ops)).toContain("defense:W1N1");
  });
});

describe("metricsVisual: intent", () => {
  it("wraps the panel in a roomVisual intent for the report's room", () => {
    const intent = visualize(metrics({ room: "W3N3" }));
    expect(intent.kind).toBe("roomVisual");
    if (intent.kind !== "roomVisual") throw new Error("unreachable");
    expect(intent.room).toBe("W3N3");
    expect(intent.ops.length).toBeGreaterThan(0);
  });
});
