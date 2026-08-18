// Plays MineralMiner.steps (harvest -> transfer) against a single fake creep in a single fake room —
// see world.ts/runRole.ts's doc for why this layer exists. Unlike Miner, mineralMiner does not maintain
// its own container (no repair/build steps) — that's left to a builder/repairer, not the miner itself.

import { describe, expect, it } from "vitest";
import { MineralMiner } from "../../../../src/behaviors/roles/mineralMiner";
import { clearTiles } from "../../../constants";
import { stubGame } from "../../../helpers";
import { playRole } from "./runRole";
import { FakeWorld, type WorldOptions } from "./world";

function setup(opts: WorldOptions = {}): FakeWorld {
  clearTiles();
  const world = new FakeWorld(opts);
  // nearMatches' assignedMineral case resolves creep.memory.mineralId via Game.getObjectById — register
  // whatever mineral fixture the world was built with (mirrors world.ts's own memory.mineralId wiring).
  stubGame({ objects: world.mineral ? { [world.mineral.id]: world.mineral } : {} });
  return world;
}

describe("MineralMiner behavior loop", () => {
  it("harvests the mineral and transfers overflow into its container", () => {
    const world = setup({
      creepPos: { x: 24, y: 24 }, // adjacent to the default mineral at (25,25)
      mineral: { pos: { x: 25, y: 25 } },
      container: { pos: { x: 26, y: 25 }, energy: 0 },
      site: null,
      carryCapacity: 4 // tiny store, so it must cycle harvest -> transfer repeatedly
    });

    const log = playRole(MineralMiner.steps, world, 30);

    expect(world.harvested.length).toBeGreaterThan(0);
    expect(world.transferred.length).toBeGreaterThan(0);
    expect(world.container!.energy).toBeGreaterThan(0); // mineral actually landed in the container
    // Harvest (step 0) must precede the first transfer (step 1) that actually acts.
    const firstHarvestTick = log.findIndex(l => l.step === 0 && l.result.didAct);
    const firstTransferTick = log.findIndex(l => l.step === 1 && l.result.didAct);
    expect(firstHarvestTick).toBeGreaterThanOrEqual(0);
    expect(firstTransferTick).toBeGreaterThan(firstHarvestTick);
  });

  it("never harvests a fully depleted deposit", () => {
    const world = setup({
      creepPos: { x: 24, y: 24 },
      mineral: { pos: { x: 25, y: 25 }, mineralAmount: 0 },
      container: { pos: { x: 26, y: 25 } },
      site: null
    });

    const log = playRole(MineralMiner.steps, world, 10);

    expect(world.harvested).toHaveLength(0);
    expect(log.every(l => l.result.didAct === false)).toBe(true);
  });
});
