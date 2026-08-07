// Plays Builder.steps (gather -> harvest -> moveToRoom -> build) against a single fake creep in a
// single fake room — see world.ts/runRole.ts's doc for why this layer exists. Unlike upgrader.test.ts,
// Builder's gather chain falls through to self-harvesting a raw source when no container/storage/drops
// exist (see builder.ts's step list), so these tests exercise that path instead.

import { describe, expect, it } from "vitest";
import { Builder } from "../../../../src/behaviors/roles/builder";
import { clearTiles } from "../../../constants";
import { stubGame } from "../../../helpers";
import { playRole } from "./runRole";
import { FakeWorld, type WorldOptions } from "./world";

function setup(opts: WorldOptions = {}): FakeWorld {
  clearTiles();
  stubGame({ objects: {} });
  return new FakeWorld(opts);
}

describe("Builder behavior loop", () => {
  it("falls through gather (nothing to draw from) to self-harvesting the source, then builds", () => {
    const world = setup({
      creepPos: { x: 24, y: 24 }, // adjacent to the default source at (25,25)
      site: { pos: { x: 24, y: 26 }, progressTotal: 6 }, // small site, close to both source and creep
      container: null,
      carryCapacity: 50
    });

    const log = playRole(Builder.steps, world, 30);

    expect(world.harvested.length).toBeGreaterThan(0);
    expect(world.built).toContain(world.site!.id);
    expect(world.site!.progress).toBe(world.site!.progressTotal);
    // Harvesting (step 1) must have happened before any build (step 3) landed a hit.
    const firstHarvestTick = log.findIndex(l => l.step === 1 && l.result.didAct);
    const firstBuildTick = log.findIndex(l => l.step === 3 && l.result.didAct);
    expect(firstHarvestTick).toBeGreaterThanOrEqual(0);
    expect(firstBuildTick).toBeGreaterThan(firstHarvestTick);
  });

  it("prefers withdrawing from a container over self-harvesting while it still has room to gather", () => {
    // harvestStep has no free-capacity guard by design (a miner keeps mining into an already-full
    // container so overflow spills — see interpreter.ts's comment on harvestStep), so a full creep
    // reaching the harvest step legitimately fires. The real preference this test is after — container
    // over raw source — only holds while there's still capacity to gather at all, i.e. before the store
    // fills for the first time.
    const world = setup({
      creepPos: { x: 26, y: 26 },
      container: { pos: { x: 26, y: 25 } },
      site: null,
      carryCapacity: 20
    });

    const log = playRole(Builder.steps, world, 10);
    const fillTick = log.findIndex(l => l.step === 0 && l.result.didAct); // the withdraw that fills the store

    expect(fillTick).toBeGreaterThanOrEqual(0);
    expect(log.slice(0, fillTick + 1).every(l => l.step !== 1)).toBe(true); // never touched harvest before then
    expect(world.container!.energy).toBeLessThan(2000); // withdrew from the container
  });

  it("never builds before its store has anything to spend", () => {
    const world = setup({
      creepPos: { x: 24, y: 26 }, // standing right at the site, far from the source
      site: { pos: { x: 24, y: 26 }, progressTotal: 100 },
      container: null,
      source: { pos: { x: 45, y: 45 } } // far away
    });

    const firstResult = playRole(Builder.steps, world, 1)[0];

    expect(firstResult.step).not.toBe(3); // step 3 is "build" — must not fire with used===0
  });

  it("cycles harvest->build->harvest across multiple loads for a large site", () => {
    const world = setup({
      creepPos: { x: 24, y: 24 },
      site: { pos: { x: 24, y: 26 }, progressTotal: 60 }, // bigger than one 10-capacity load
      container: null,
      carryCapacity: 10
    });

    const log = playRole(Builder.steps, world, 60);

    expect(world.site!.progress).toBe(world.site!.progressTotal);
    const harvestVisits = log.filter(l => l.step === 1 && l.result.didAct).length;
    expect(harvestVisits).toBeGreaterThan(1); // refilled more than once to finish the site
  });
});
