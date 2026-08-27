// Unit-proves gh #50's pickSupplyRequest tier-first-then-nearest selection against hand-built
// SupplyRequest data — no Game.* needed here since selection is a plain function over data (rangeTo is
// injected). registerSpawnSystemRequests/registerTowerRequests themselves read live Game.* state (room.find)
// the same way register.ts's registerMinerContainerOutput does, and are proven instead by the mockup-server
// integration test (test/integration/supply-self-registration.test.ts), per the PRD's testing decision that
// live-object registration code belongs in the integration seam.

import { describe, expect, it } from "vitest";
import { pickSupplyRequest, registerBoostLabRequests, SUPPLY_TIER, type SupplyRequest } from "../../../src/logistics/supplyRegister";

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
    const only = stubRequest("a", SUPPLY_TIER.base);
    expect(pickSupplyRequest([only], HOME, () => 5)).toBe(only);
  });

  it("a low tower always beats a base-tier spawn/extension, even when much farther away", () => {
    const nearSpawn = stubRequest("spawn", SUPPLY_TIER.base);
    const farTower = stubRequest("tower", SUPPLY_TIER.towerLow);
    const ranges: Record<string, number> = { spawn: 1, tower: 20 };
    const picked = pickSupplyRequest([nearSpawn, farTower], HOME, t => ranges[(t as unknown as { id: string }).id]);
    expect(picked).toBe(farTower);
  });

  it("a tower above the low-energy threshold competes at the same base tier as spawn/extension — nearest wins", () => {
    const nearSpawn = stubRequest("spawn", SUPPLY_TIER.base);
    const farTower = stubRequest("tower", SUPPLY_TIER.base);
    const ranges: Record<string, number> = { spawn: 1, tower: 20 };
    const picked = pickSupplyRequest([nearSpawn, farTower], HOME, t => ranges[(t as unknown as { id: string }).id]);
    expect(picked).toBe(nearSpawn);
  });

  it("within the same tier, the nearest wins", () => {
    const near = stubRequest("near", SUPPLY_TIER.base);
    const far = stubRequest("far", SUPPLY_TIER.base);
    const ranges: Record<string, number> = { near: 2, far: 9 };
    const picked = pickSupplyRequest([far, near], HOME, t => ranges[(t as unknown as { id: string }).id]);
    expect(picked).toBe(near);
  });

  it("never picks based on wanted amount — only tier then distance", () => {
    const small = stubRequest("small", SUPPLY_TIER.base);
    small.wanted = 1;
    const big = stubRequest("big", SUPPLY_TIER.base);
    big.wanted = 500;
    // Same distance: earlier-seen candidate keeps the win (strict "<" comparison), not the bigger wanted.
    const picked = pickSupplyRequest([small, big], HOME, () => 3);
    expect(picked).toBe(small);
  });
});

// ---------------------------------------------------------------------------
// registerBoostLabRequests — plain data over stubs (no room.find(), unlike its spawn/tower siblings), same
// stub-a-minimal-store-surface pattern stewardRegister.test.ts already uses.
// ---------------------------------------------------------------------------

function stubLab(id: string, energyUsed: number, energyCapacity = 2000): StructureLab {
  return {
    id,
    store: {
      getFreeCapacity: (r: ResourceConstant) => (r === RESOURCE_ENERGY ? energyCapacity - energyUsed : 0)
    }
  } as unknown as StructureLab;
}

describe("registerBoostLabRequests", () => {
  it("registers an energy want at SUPPLY_TIER.boostLab (same as towerLow, above ordinary base) even with no active claim — pre-staged ahead of demand", () => {
    const lab = stubLab("lab1", 500);
    const requests = registerBoostLabRequests([lab]);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ target: lab, wanted: 1500, tier: SUPPLY_TIER.boostLab });
    expect(SUPPLY_TIER.boostLab).toBe(SUPPLY_TIER.towerLow);
    expect(SUPPLY_TIER.boostLab).toBeLessThan(SUPPLY_TIER.base);
  });

  it("registers nothing for a lab already full of energy", () => {
    const lab = stubLab("lab1", 2000);
    const requests = registerBoostLabRequests([lab]);
    expect(requests).toHaveLength(0);
  });

  it("skips undefined entries (a stale boostLabIds reference) without crashing", () => {
    const lab = stubLab("lab1", 500);
    const requests = registerBoostLabRequests([undefined, lab]);
    expect(requests).toHaveLength(1);
    expect(requests[0].target).toBe(lab);
  });

  it("registers every lab, claimed or not", () => {
    const a = stubLab("a", 500);
    const b = stubLab("b", 500);
    const requests = registerBoostLabRequests([a, b]);
    expect(requests).toHaveLength(2);
  });
});
