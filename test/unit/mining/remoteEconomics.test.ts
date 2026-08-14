import { describe, it, expect } from "vitest";
import { netEnergy, worthReserving, defaultEconomyContext } from "../../../src/mining/remoteEconomics";
import { remoteSourceAt } from "../../fixtures";

describe("netEnergy", () => {
  const ctx = defaultEconomyContext();

  it("is positive for a near unreserved source (worth mining)", () => {
    const near = remoteSourceAt(25, 25, "W2N1", { distance: 50 });
    expect(netEnergy(near, ctx)).toBeGreaterThan(0);
  });

  it("is negative for a source so far the haul upkeep swamps the harvest", () => {
    // Many rooms out: round-trip haul upkeep exceeds the 5/tick a single unreserved source yields.
    const far = remoteSourceAt(25, 25, "W9N1", { distance: 50 * 8 });
    expect(netEnergy(far, ctx)).toBeLessThan(0);
  });

  it("keeps the near source and skips the far one within the same room", () => {
    // A room where one source sits near the entry and the other is deep and unreachable-cheap:
    // near pays off, far does not. This is the whole reason for a per-source list.
    const near = remoteSourceAt(10, 25, "W2N1", { distance: 60 });
    const far = remoteSourceAt(45, 25, "W2N1", { distance: 380 });
    expect(netEnergy(near, ctx)).toBeGreaterThan(0);
    expect(netEnergy(far, ctx)).toBeLessThan(0);
  });

  it("harvest yield rises when the source is reserved", () => {
    const unreserved = remoteSourceAt(25, 25, "W2N1", { distance: 50, reserved: false });
    const reserved = remoteSourceAt(25, 25, "W2N1", { distance: 50, reserved: true });
    expect(netEnergy(reserved, ctx)).toBeGreaterThan(netEnergy(unreserved, ctx));
  });
});

describe("worthReserving", () => {
  const ctx = defaultEconomyContext();

  it("is never worth reserving a room with no mined sources", () => {
    expect(worthReserving([], ctx)).toBe(false);
  });

  it("is worth reserving a room with a mined source: +5/tick dwarfs a cheap claimer's upkeep", () => {
    // NB: this contradicts the handoff's guessed "1 source not worth, 2 worth" break-even. A claimer
    // amortizes over CREEP_CLAIM_LIFE_TIME (600, not the usual 1500) to ~1.08 energy/tick while reserving
    // lifts a source by +5/tick, so a single mined source already justifies reserving. The handoff's
    // threshold was an approximation; the economics module is the source of truth (its first live
    // validation is step 7's benchmark).
    const one = [remoteSourceAt(25, 25, "W2N1", { distance: 50 })];
    expect(worthReserving(one, ctx)).toBe(true);
  });

  it("only gets more attractive as more of a room's sources are mined", () => {
    const one = [remoteSourceAt(10, 25, "W2N1", { distance: 50 })];
    const two = [...one, remoteSourceAt(40, 25, "W2N1", { distance: 60 })];
    // The summed marginal gain is strictly larger with a second mined source, so a room can never flip
    // from worth-reserving to not-worth-reserving by gaining a source.
    expect(worthReserving(two, ctx) || !worthReserving(one, ctx)).toBe(true);
  });
});
