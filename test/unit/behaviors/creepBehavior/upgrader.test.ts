// Plays Upgrader.steps (gather -> build -> upgrade) against a single fake creep in a single fake room,
// no colony/spawns/siblings involved — see world.ts/runRole.ts's doc for why this layer exists
// alongside interpreter.test.ts's per-step fixtures.
//
// Upgrader never self-harvests a raw source (see upgrader.ts's step list) — its "gather" step only draws
// from an existing pool (container/storage/link/drops/tombstones/ruins), so these tests give it a
// container rather than a bare source.

import { describe, expect, it } from "vitest";
import { Upgrader } from "../../../../src/behaviors/roles/upgrader";
import { clearTiles } from "../../../constants";
import { stubGame } from "../../../helpers";
import { playRole } from "./runRole";
import { FakeWorld, type WorldOptions } from "./world";

function setup(opts: WorldOptions = {}): FakeWorld {
  clearTiles();
  stubGame({ objects: {} });
  return new FakeWorld(opts);
}

describe("Upgrader behavior loop", () => {
  it("walks to the container, withdraws to full, then walks to the controller and upgrades", () => {
    const world = setup({
      creepPos: { x: 20, y: 20 },
      site: null,
      carryCapacity: 10,
      container: { pos: { x: 26, y: 25 } }
    });
    const log = playRole(Upgrader.steps, world, 40);

    expect(world.store.energy + world.store.free).toBe(10); // capacity unchanged
    expect(world.upgraded.length).toBeGreaterThan(0);
    expect(log.some(l => l.result.target === world.controller.id)).toBe(true);
    expect(log.some(l => l.result.target === world.container!.id)).toBe(true);
    expect(world.container!.energy).toBeLessThan(2000); // some was withdrawn
  });

  it("builds an outstanding construction site before upgrading", () => {
    const world = setup({
      creepPos: { x: 26, y: 26 }, // adjacent to the container
      container: { pos: { x: 26, y: 25 } },
      // A 1-CARRY body only builds sites within onlyIfCarryOver's range of the CONTROLLER (see
      // upgrader.ts's step list) — keep both close together so this test isn't gated by that floor.
      controllerPos: { x: 30, y: 27 },
      site: { pos: { x: 26, y: 27 }, progressTotal: 4 }, // tiny site, close by
      carryCapacity: 50
    });

    const log = playRole(Upgrader.steps, world, 30);

    expect(world.built).toContain(world.site!.id);
    // Once the site completes, the loop must fall through to upgrading in the same run.
    expect(world.site!.progress).toBe(world.site!.progressTotal);
    expect(world.upgraded.length).toBeGreaterThan(0);
    // The build step (index 1) must have run before the upgrade step (index 2) ever did.
    const firstBuildTick = log.findIndex(l => l.step === 1);
    const firstUpgradeTick = log.findIndex(l => l.step === 2 && l.result.didAct);
    expect(firstBuildTick).toBeGreaterThanOrEqual(0);
    expect(firstUpgradeTick).toBeGreaterThan(firstBuildTick);
  });

  it("never upgrades before its store has anything to spend", () => {
    // Creep starts empty, standing right at the controller with the container far away — the interpreter
    // must route it to gather first (the pure nextStep/firstRunnableStep guard), not call upgrade on an
    // empty store.
    const world = setup({ creepPos: { x: 40, y: 39 }, site: null, container: { pos: { x: 26, y: 25 } } });

    const firstResult = playRole(Upgrader.steps, world, 1)[0];

    expect(firstResult.step).not.toBe(2); // step 2 is "upgrade" — must not be picked with used===0
  });

  it("cycles back to gathering once the store empties from upgrading", () => {
    const world = setup({
      creepPos: { x: 39, y: 39 },
      site: null,
      carryCapacity: 4, // tiny store, fast to empty
      container: { pos: { x: 26, y: 25 } }
    });
    const log = playRole(Upgrader.steps, world, 60);

    expect(world.upgraded.length).toBeGreaterThan(0);
    expect(world.container!.energy).toBeLessThan(2000);
    // The step index must have revisited the gather step (0) more than once — i.e. it actually cycles
    // through gather->upgrade->gather, not just run once and stall.
    const gatherHits = log.filter(l => l.step === 0).length;
    expect(gatherHits).toBeGreaterThan(1);
  });

  it("has no reachable container: idles on gather rather than upgrading an empty store", () => {
    const world = setup({ creepPos: { x: 10, y: 10 }, site: null, container: null });
    const log = playRole(Upgrader.steps, world, 10);

    expect(world.upgraded).toEqual([]);
    expect(log.every(l => l.step !== 2 || !l.result.didAct)).toBe(true);
  });
});
