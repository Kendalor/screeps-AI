import { afterAll, beforeAll, test } from "vitest";
import { BootedColony, bundleBot } from "../../integration/harness";

let colony: BootedColony;

beforeAll(async () => {
  colony = await BootedColony.boot({ botCode: bundleBot() });
}, 120_000);

afterAll(() => {
  colony?.stop();
});

test(
  "debug: print controller/spawn state over time",
  async () => {
    await colony.runUntil(
      async () => false,
      1500,
      async tick => {
        if (tick % 50 === 0) {
          const ctrl = await colony.controller();
          const roles = await colony.rolesAlive();
          const objects = await colony.roomObjects();
          const spawn = objects.find(o => o.type === "spawn") as any;
          const cap = await colony.energyCapacity();
          console.log(
            `tick ${tick}: rcl=${ctrl.level} progress=${ctrl.progress} roles=${roles.join(",")} spawnEnergy=${spawn?.store?.energy}/${spawn?.storeCapacityResource?.energy} energyCapacity=${cap} spawning=${JSON.stringify(spawn?.spawning)}`
          );
        }
      }
    );
  },
  400_000
);
