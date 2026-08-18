// Unit-proves gh #50's pickSupplyRequest tier-first-then-nearest selection against hand-built
// SupplyRequest data — no Game.* needed here since selection is a plain function over data (rangeTo is
// injected). registerSpawnSystemRequests/registerTowerRequests themselves read live Game.* state (room.find)
// the same way register.ts's registerMinerContainerOutput does, and are proven instead by the mockup-server
// integration test (test/integration/supply-self-registration.test.ts), per the PRD's testing decision that
// live-object registration code belongs in the integration seam.

import { describe, expect, it } from "vitest";
import { pickSupplyRequest, SUPPLY_TIER, type SupplyRequest } from "../../../src/logistics/supplyRegister";

function stubRequest(id: string, tier: number): SupplyRequest {
  return {
    target: { id } as unknown as SupplyRequest["target"],
    wanted: 50,
    tier
  };
}

const HOME = { x: 25, y: 25, roomName: "W1N1" } as unknown as RoomPosition;

describe("pickSupplyRequest", () => {
  it("returns undefined for an empty pool", () => {
    expect(pickSupplyRequest([], HOME, () => 0)).toBeUndefined();
  });

  it("picks the only candidate when there is one", () => {
    const only = stubRequest("a", SUPPLY_TIER.spawnSystem);
    expect(pickSupplyRequest([only], HOME, () => 5)).toBe(only);
  });

  it("a tower always beats a spawn/extension, even when much farther away", () => {
    const nearSpawn = stubRequest("spawn", SUPPLY_TIER.spawnSystem);
    const farTower = stubRequest("tower", SUPPLY_TIER.tower);
    const ranges: Record<string, number> = { spawn: 1, tower: 20 };
    const picked = pickSupplyRequest([nearSpawn, farTower], HOME, t => ranges[(t as unknown as { id: string }).id]);
    expect(picked).toBe(farTower);
  });

  it("within the same tier, the nearest wins", () => {
    const near = stubRequest("near", SUPPLY_TIER.spawnSystem);
    const far = stubRequest("far", SUPPLY_TIER.spawnSystem);
    const ranges: Record<string, number> = { near: 2, far: 9 };
    const picked = pickSupplyRequest([far, near], HOME, t => ranges[(t as unknown as { id: string }).id]);
    expect(picked).toBe(near);
  });

  it("never picks based on wanted amount — only tier then distance", () => {
    const small = stubRequest("small", SUPPLY_TIER.spawnSystem);
    small.wanted = 1;
    const big = stubRequest("big", SUPPLY_TIER.spawnSystem);
    big.wanted = 500;
    // Same distance: earlier-seen candidate keeps the win (strict "<" comparison), not the bigger wanted.
    const picked = pickSupplyRequest([small, big], HOME, () => 3);
    expect(picked).toBe(small);
  });
});
