// Behavior: BootedColony lets a scenario inject a pre-built world state
// (controller level, structures) before the first tick, so tests don't have
// to wait out a natural multi-hundred-tick warmup (docs: gh issue #9).

import { afterAll, beforeAll, expect, test } from "vitest";
import { BootedColony, bundleBot } from "./harness";

let colony: BootedColony;

beforeAll(async () => {
  colony = await BootedColony.boot({ botCode: bundleBot() });
}, 120_000);

afterAll(() => {
  colony?.stop();
});

test("setControllerLevel sets the room controller before tick 1", async () => {
  await colony.setControllerLevel(2);

  const ctrl = await colony.controller();
  expect(ctrl.level).toBe(2);
});

test("addStructure is visible via roomObjects on tick 1", async () => {
  await colony.addStructure("container", 22, 30, { store: { energy: 0 }, storeCapacity: 2000 });

  const objects = await colony.roomObjects();
  const container = objects.find(o => o.type === "container" && o.x === 22 && o.y === 30);
  expect(container).toBeDefined();
  expect(container?.store).toEqual({ energy: 0 });
  expect(container?.storeCapacity).toBe(2000);
});
