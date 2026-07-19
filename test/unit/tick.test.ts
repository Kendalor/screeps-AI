import { describe, expect, it, vi } from "vitest";
import { tick, type System } from "../../src/kernel/tick";
import { stubGame } from "../helpers";

describe("kernel tick", () => {
  it("runs a system and executes its intents against the game API", () => {
    const attack = vi.fn(() => OK);
    stubGame({
      objects: {
        tower1: { attack },
        hostile1: { name: "hostile1" }
      }
    });
    const sys: System = {
      name: "test",
      tier: 1,
      run: () => [{ kind: "towerAttack", tower: "tower1" as Id<StructureTower>, target: "hostile1" as Id<Creep> }]
    };

    tick([sys]);

    expect(attack).toHaveBeenCalledTimes(1);
    expect(attack).toHaveBeenCalledWith(expect.objectContaining({ name: "hostile1" }));
  });

  it("skips a system whose interval does not divide the current tick", () => {
    const run = vi.fn(() => []);
    const sys: System = { name: "interval", tier: 1, interval: 10, run };

    stubGame({ time: 5 });
    tick([sys]);
    expect(run).not.toHaveBeenCalled();

    stubGame({ time: 10 });
    tick([sys]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("stops before tier 2 when CPU exceeds 60% of the steady-state limit", () => {
    const tier1 = vi.fn(() => []);
    const tier2 = vi.fn(() => []);
    stubGame({ cpuLimit: 20, getUsed: () => 13 }); // 65% of limit
    tick([
      { name: "t1", tier: 1, run: tier1 },
      { name: "t2", tier: 2, run: tier2 }
    ]);

    expect(tier1).toHaveBeenCalledTimes(1);
    expect(tier2).not.toHaveBeenCalled();
  });

  it("stops before tier 3 when the bucket is low, even with CPU to spare", () => {
    const tier2 = vi.fn(() => []);
    const tier3 = vi.fn(() => []);
    stubGame({ cpuLimit: 20, getUsed: () => 0, bucket: 2000 });
    tick([
      { name: "t2", tier: 2, run: tier2 },
      { name: "t3", tier: 3, run: tier3 }
    ]);

    expect(tier2).toHaveBeenCalledTimes(1);
    expect(tier3).not.toHaveBeenCalled();
  });

  it("isolates a crashing system so later systems still run", () => {
    const after = vi.fn(() => []);
    stubGame({});
    const boom: System = {
      name: "boom",
      tier: 1,
      run: () => {
        throw new Error("kaboom");
      }
    };

    expect(() => tick([boom, { name: "after", tier: 1, run: after }])).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
  });
});
