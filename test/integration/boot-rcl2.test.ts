// Foundational integration test: proves end-to-end that spawning, resolveTarget candidate fetch,
// and runStep dispatch actually drive a colony in a real engine — none of that glue is unit-tested.
//
// Observed on the reference machine: first creep ~tick 2, first upgrade ~tick 593, RCL2 ~tick 779.
// Budgets below carry margin for run-to-run pathing variance.
//
// gh #52 cutover: "controller upgrading"/"RCL2" budgets widened (700->720, 1000->1250) after the
// Transport cutover — a real, understood, and bounded startup-throughput regression, not flake. Before
// storage exists, Transport's new rate-ranked pool (transportRegister.ts) can only ever deliver to a
// builder/upgrader creep's own small battery or the controller container (RCL2+extensions only) — never
// spawn/extension, Supply's exclusive scope per the PRD's pool-topology decision (ADR 0008). The old
// system additionally fed spawn/extension directly at low priority whenever Supply's single creep
// couldn't keep up alone, which no longer happens: Supply's own one-creep throughput is now the real
// bootstrap-phase bottleneck, exactly as intended by the PRD ("Supply still owns spawn/extension/tower
// today, unaffected by this cutover" — true of WHO owns it, but Transport no longer backstops it either).
// operations/logistics.ts's wantedTransport() caps pre-storage transport headcount (config.
// minPreStorageTransport/preStorageTransportPerBattery) to stop income-based sizing requesting far more
// transport creeps than the small pre-storage sink set can use (confirmed live: uncapped, this
// permanently starved upgrader of every spawn slot at priority parity, never reaching RCL2 at all) —
// empirically tuned against this test + rcl3.test.ts together; consistently observed ~705/~1160-1200
// across runs with that cap, still comfortably inside the widened budgets. Supply's own cutover (gh #53)
// may reopen this number.

import { afterAll, beforeAll, expect, test } from "vitest";
import { BootedColony, bundleBot, CheckpointLadder } from "./harness";

let colony: BootedColony;

beforeAll(async () => {
  colony = await BootedColony.boot({ botCode: bundleBot() });
}, 120_000);

afterAll(() => {
  colony?.stop();
});

test(
  "fresh spawn reaches RCL2 within budget",
  async () => {
    const ladder = new CheckpointLadder([
      { name: "first creep alive", by: 150 },
      // Bunker anchor optimises for controller proximity, starting the colony further from
      // sources — the long opening round trip is why this budget is later than it looks.
      { name: "controller upgrading", by: 720 },
      // Widened from 1000 — see this file's header on the gh #52 Transport cutover's real,
      // understood, bounded pre-storage throughput cost.
      { name: "RCL2", by: 1250 }
    ]);

    const reachedRcl2 = await colony.runUntil(
      async () => (await colony.controller()).level >= 2,
      1400,
      async tick => {
        const ctrl = await colony.controller();
        const creeps = await colony.creepCount();
        await ladder.sample(tick, name => {
          switch (name) {
            case "first creep alive":
              return creeps > 0;
            case "controller upgrading":
              return ctrl.progress > 0;
            case "RCL2":
              return ctrl.level >= 2;
            default:
              return false;
          }
        });
      }
    );

    const missed = ladder.firstMissed();
    expect(missed, `checkpoint ladder:\n${ladder.report()}`).toBeNull();
    expect(reachedRcl2, "RCL2 never reached within 1400 ticks").not.toBeNull();
  },
  120_000
);
