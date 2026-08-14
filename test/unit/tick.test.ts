import { describe, expect, it, vi } from "vitest";
import type { Colony } from "../../src/colony";
import { tick, type System } from "../../src/kernel/tick";
import { colonySnap, testEmpire } from "../fixtures";
import { stubGame } from "../helpers";

function twoColonies() {
  return testEmpire(colonySnap({ name: "W1N1" }), colonySnap({ name: "W2N2" }));
}

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
      scope: "empire",
      run: () => [{ kind: "towerAttack", tower: "tower1" as Id<StructureTower>, target: "hostile1" as Id<Creep> }]
    };

    tick([sys]);

    expect(attack).toHaveBeenCalledTimes(1);
    expect(attack).toHaveBeenCalledWith(expect.objectContaining({ name: "hostile1" }));
  });

  it("skips a system whose interval does not divide the current tick", () => {
    const run = vi.fn(() => []);
    const sys: System = { name: "interval", tier: 1, scope: "empire", interval: 10, run };

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
    stubGame({ cpuLimit: 20, getUsed: () => 13 });
    tick([
      { name: "t1", tier: 1, scope: "empire", run: tier1 },
      { name: "t2", tier: 2, scope: "empire", run: tier2 }
    ]);

    expect(tier1).toHaveBeenCalledTimes(1);
    expect(tier2).not.toHaveBeenCalled();
  });

  it("stops before tier 3 when the bucket is low, even with CPU to spare", () => {
    const tier2 = vi.fn(() => []);
    const tier3 = vi.fn(() => []);
    stubGame({ cpuLimit: 20, getUsed: () => 0, bucket: 2000 });
    tick([
      { name: "t2", tier: 2, scope: "empire", run: tier2 },
      { name: "t3", tier: 3, scope: "empire", run: tier3 }
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
      scope: "empire",
      run: () => {
        throw new Error("kaboom");
      }
    };

    expect(() => tick([boom, { name: "after", tier: 1, scope: "empire", run: after }])).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("runs a colony system once per colony", () => {
    const run = vi.fn(() => []);
    stubGame({});

    tick([{ name: "percolony", tier: 1, scope: "colony", run }], twoColonies());

    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls.map(([c]) => (c as Colony).snapshot.name)).toEqual(["W1N1", "W2N2"]);
  });

  it("isolates a crashing colony so its siblings still run", () => {
    const seen: string[] = [];
    stubGame({});

    const sys: System = {
      name: "boom",
      tier: 1,
      scope: "colony",
      run: (c: Colony) => {
        if (c.snapshot.name === "W1N1") throw new Error("kaboom");
        seen.push(c.snapshot.name);
        return [];
      }
    };

    expect(() => tick([sys], twoColonies())).not.toThrow();
    // The guard is inside the colony loop, so one colony's bad snapshot doesn't blind the next.
    expect(seen).toEqual(["W2N2"]);
  });
});
