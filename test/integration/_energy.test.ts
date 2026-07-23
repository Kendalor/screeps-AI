// TEMPORARY energy-ramp measurement — the user's real metric: net utilized energy (harvested minus
// wasted) and how fast it ramps, independent of RCL timing. Delete after use.
import { afterAll, beforeAll, expect, test } from "vitest";
import { EnergyMetrics } from "./energyMetrics";
import { BootedColony, bundleBot } from "./harness";

let colony: BootedColony;
beforeAll(async () => {
  colony = await BootedColony.boot({ botCode: bundleBot() });
}, 120_000);
afterAll(() => colony?.stop());

test(
  "measure net energy over a fixed cold-boot window",
  async () => {
    const energy = new EnergyMetrics();
    const WINDOW = 3000;
    const marks: number[] = [500, 1000, 1500, 2000, 2500, 3000];
    const snapshots: string[] = [];

    let tick = 0;
    await colony.runUntil(
      async () => false, // run the full window
      WINDOW,
      async t => {
        tick = t;
        await colony.sampleEnergy(energy);
        if (marks.includes(t)) {
          const r = energy.report();
          const net = r.harvested - r.wasted;
          const ctrl = await colony.controller();
          const roles = await colony.rolesAlive();
          const rc: Record<string, number> = {};
          for (const role of roles) rc[role] = (rc[role] ?? 0) + 1;
          snapshots.push(
            `t=${t} lvl=${ctrl.level} harvested=${r.harvested} wasted=${r.wasted} net=${net} ` +
              `h/t=${r.perTick.harvested.toFixed(2)} w/t=${r.perTick.wasted.toFixed(2)} ` +
              `decayed=${r.decayed} upg=${r.sinks.upgrading} bld=${r.sinks.construction} roles=${JSON.stringify(rc)}`
          );
        }
      }
    );

    console.log("\n===ENERGY-RAMP===\n" + snapshots.join("\n") + "\n===END===");
    expect(tick).toBeGreaterThan(0);
  },
  300_000
);
