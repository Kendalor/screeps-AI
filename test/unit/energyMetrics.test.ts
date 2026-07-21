import { describe, expect, it } from "vitest";
import { EnergyMetrics, observeTick, type RawObj, type TickObs } from "../integration/energyMetrics";

// A baseline observation; each test overrides only the fields it exercises.
function obs(over: Partial<TickObs> = {}): TickObs {
  return {
    sources: [],
    droppedEnergy: 0,
    controllerProgress: 0,
    controllerLevel: 3,
    siteProgress: 0,
    spawnedBodyCost: 0,
    ...over
  };
}

function source(id: string, energy: number, ticksToRegeneration = 100): TickObs["sources"][number] {
  return { id, energy, energyCapacity: 3000, ticksToRegeneration };
}

describe("energy metrics: harvested and wasted", () => {
  it("counts a source's drop in energy as harvested", () => {
    const m = new EnergyMetrics();
    m.sample(obs({ sources: [source("s1", 3000)] }));
    m.sample(obs({ sources: [source("s1", 2980)] }));

    expect(m.report().harvested).toBe(20);
  });

  it("does not count the first observation as harvest (no prior to diff)", () => {
    const m = new EnergyMetrics();
    m.sample(obs({ sources: [source("s1", 2000)] }));

    expect(m.report().harvested).toBe(0);
  });

  it("counts leftover energy at a regen reset as wasted, not harvested", () => {
    const m = new EnergyMetrics();
    m.sample(obs({ sources: [source("s1", 1200)] }));
    m.sample(obs({ sources: [source("s1", 3000)] }));

    const r = m.report();
    expect(r.wasted).toBe(1200);
    expect(r.harvested).toBe(0);
  });

  it("separates harvest from waste across a full drain-then-regen cycle", () => {
    const m = new EnergyMetrics();
    m.sample(obs({ sources: [source("s1", 3000)] }));
    m.sample(obs({ sources: [source("s1", 2000)] }));
    m.sample(obs({ sources: [source("s1", 1500)] }));
    m.sample(obs({ sources: [source("s1", 3000)] }));

    const r = m.report();
    expect(r.harvested).toBe(1500);
    expect(r.wasted).toBe(1500);
  });
});

describe("energy metrics: multiple sources", () => {
  it("tracks each source's drain and reset independently", () => {
    const m = new EnergyMetrics();
    m.sample(obs({ sources: [source("s1", 3000), source("s2", 500)] }));
    m.sample(obs({ sources: [source("s1", 2700), source("s2", 3000)] }));

    const r = m.report();
    expect(r.harvested).toBe(300);
    expect(r.wasted).toBe(500);
  });
});

describe("energy metrics: decay", () => {
  it("counts a net shrink in dropped energy as decay", () => {
    const m = new EnergyMetrics();
    m.sample(obs({ droppedEnergy: 100 }));
    m.sample(obs({ droppedEnergy: 90 }));

    expect(m.report().decayed).toBe(10);
  });

  it("does not count a growing dropped pile as decay", () => {
    const m = new EnergyMetrics();
    m.sample(obs({ droppedEnergy: 50 }));
    m.sample(obs({ droppedEnergy: 200 }));

    expect(m.report().decayed).toBe(0);
  });
});

describe("energy metrics: sinks", () => {
  it("attributes controller progress to upgrading", () => {
    const m = new EnergyMetrics();
    m.sample(obs({ controllerProgress: 100 }));
    m.sample(obs({ controllerProgress: 250 }));

    expect(m.report().sinks.upgrading).toBe(150);
  });

  it("attributes site progress to construction", () => {
    const m = new EnergyMetrics();
    m.sample(obs({ siteProgress: 0 }));
    m.sample(obs({ siteProgress: 80 }));

    expect(m.report().sinks.construction).toBe(80);
  });

  it("does not count a completed site (progress sum falling) as negative construction", () => {
    const m = new EnergyMetrics();
    m.sample(obs({ siteProgress: 2900 }));
    m.sample(obs({ siteProgress: 0 }));

    expect(m.report().sinks.construction).toBe(0);
  });

  it("attributes spawned body cost to creeps", () => {
    const m = new EnergyMetrics();
    m.sample(obs({ spawnedBodyCost: 250 }));
    m.sample(obs({ spawnedBodyCost: 0 }));
    m.sample(obs({ spawnedBodyCost: 300 }));

    expect(m.report().sinks.creeps).toBe(550);
  });
});

describe("observeTick: raw room objects -> TickObs", () => {
  const objs = (over: RawObj[]): RawObj[] => over;

  it("sums source energy and dropped energy, and reads the controller", () => {
    const seen = new Set<string>();
    const t = observeTick(
      objs([
        { type: "source", _id: "s1", energy: 2000, energyCapacity: 3000, ticksToRegeneration: 100 },
        { type: "energy", _id: "d1", energy: 40 },
        { type: "controller", _id: "c", level: 3, progress: 500 }
      ]),
      seen
    );

    expect(t.sources).toEqual([{ id: "s1", energy: 2000, energyCapacity: 3000, ticksToRegeneration: 100 }]);
    expect(t.droppedEnergy).toBe(40);
    expect(t.controllerLevel).toBe(3);
    expect(t.controllerProgress).toBe(500);
  });

  it("counts a creep's body cost once, on the tick it first appears", () => {
    const seen = new Set<string>();
    const creep: RawObj = {
      type: "creep",
      _id: "cr1",
      body: [{ type: "work" }, { type: "work" }, { type: "carry" }, { type: "move" }]
    };

    const first = observeTick(objs([creep]), seen);
    expect(first.spawnedBodyCost).toBe(300);

    const second = observeTick(objs([creep]), seen);
    expect(second.spawnedBodyCost).toBe(0);
  });

  it("sums site progress across open construction sites", () => {
    const t = observeTick(
      objs([
        { type: "constructionSite", _id: "cs1", progress: 100, progressTotal: 3000 },
        { type: "constructionSite", _id: "cs2", progress: 50, progressTotal: 5000 }
      ]),
      new Set()
    );

    expect(t.siteProgress).toBe(150);
  });
});

describe("energy metrics: report shape", () => {
  it("averages harvested and wasted over the ticks sampled", () => {
    const m = new EnergyMetrics();
    m.sample(obs({ sources: [source("s1", 3000)] }));
    m.sample(obs({ sources: [source("s1", 2900)] }));

    const r = m.report();
    expect(r.ticks).toBe(2);
    expect(r.perTick.harvested).toBe(50);
  });
});
