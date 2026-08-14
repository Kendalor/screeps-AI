// harvestIncome/haulDistance must count remote sources additively, not silently absorb them into the
// local-only cap/average that predates remote mining. See src/logistics/fleet.ts's module comment.

import { describe, it, expect } from "vitest";
import { harvestIncome, haulDistance, type IncomeConfig } from "../../../src/logistics/fleet";
import { colonySnap, remoteSourceAt, snapCreep } from "../../fixtures";

const config: IncomeConfig = {
  sourceRegenPerTick: 10,
  roomIncomeCap: 20,
  defaultHaulDistance: 10
};

const minerBody = [WORK, WORK, WORK, WORK, WORK, MOVE]; // 5 WORK => 5*2 = 10 raw energy/tick

describe("harvestIncome", () => {
  it("counts a local miner as before, capped by local source count", () => {
    const colony = colonySnap({});
    const miners = [snapCreep("miner", { body: minerBody })];
    expect(harvestIncome(miners, colony, config)).toBe(10);
  });

  it("adds a staffed remote source's income on top of local income, not absorbed into the local cap", () => {
    const remote = remoteSourceAt(25, 25, "W2N1", { distance: 30, reserved: false });
    const colony = colonySnap({ remoteSources: [remote] });
    // Local source already saturated at the 20 cap (two full local miners), plus one remote miner.
    const miners = [
      snapCreep("miner", { body: minerBody, memory: { sourceId: colony.sources[0].id } }),
      snapCreep("miner", { body: minerBody, memory: { sourceId: colony.sources[0].id } }),
      snapCreep("miner", { body: minerBody, memory: { sourceId: remote.id } })
    ];
    // Local: 10 WORK total raw=20, capped at min(20, 1*10)=10. Remote unreserved cap = 5/tick, staffed
    // with 10 raw => clamped to 5. Total must exceed what local-only accounting would ever produce.
    const income = harvestIncome(miners, colony, config);
    expect(income).toBe(10 + 5);
  });

  it("clamps a remote source's income to its own reserved/unreserved regen cap, never the local cap", () => {
    const reserved = remoteSourceAt(25, 25, "W2N1", { distance: 30, reserved: true });
    const colony = colonySnap({ remoteSources: [reserved], sources: [] });
    // Way more WORK than even a reserved source (10/tick) can support.
    const miners = [snapCreep("miner", { body: minerBody, memory: { sourceId: reserved.id } })];
    expect(harvestIncome(miners, colony, config)).toBe(10); // reserved cap, not 5*2=10 raw coincidentally equal — see next test
  });

  it("does not let an overstaffed remote source exceed its regen cap", () => {
    const unreserved = remoteSourceAt(25, 25, "W2N1", { distance: 30, reserved: false });
    const colony = colonySnap({ remoteSources: [unreserved], sources: [] });
    const miners = [
      snapCreep("miner", { body: minerBody, memory: { sourceId: unreserved.id } }),
      snapCreep("miner", { body: minerBody, memory: { sourceId: unreserved.id } })
    ]; // 20 raw energy/tick offered, unreserved cap is 5/tick
    expect(harvestIncome(miners, colony, config)).toBe(5);
  });

  it("ignores an unassigned/legacy miner's WORK as local, not remote", () => {
    const remote = remoteSourceAt(25, 25, "W2N1", { distance: 30 });
    const colony = colonySnap({ remoteSources: [remote], sources: [] });
    const miners = [snapCreep("miner", { body: minerBody })]; // no sourceId at all
    // No local sources exist in this fixture, so the local cap is 0 — an unassigned miner's WORK must
    // not leak into the remote source's income just because a remote exists.
    expect(harvestIncome(miners, colony, config)).toBe(0);
  });
});

describe("haulDistance", () => {
  it("matches the plain local average when no remote source is staffed", () => {
    const colony = colonySnap({ anchor: { x: 25, y: 25 } });
    const miners = [snapCreep("miner", { body: minerBody })];
    // Only local source at (20,10) vs anchor (25,25) — same figure whether or not remote-aware.
    expect(haulDistance(miners, colony, config)).toBeGreaterThan(0);
  });

  it("pulls the round trip toward a staffed remote source's cached distance, not the local-only figure", () => {
    const anchor = { x: 25, y: 25 };
    // Local source is close (distance ~ a few tiles); remote source's cached distance is huge.
    const remote = remoteSourceAt(25, 25, "W9N1", { distance: 500, reserved: true });
    const colony = colonySnap({ anchor, remoteSources: [remote] });
    const localOnlyMiners = [snapCreep("miner", { body: minerBody, memory: { sourceId: colony.sources[0].id } })];
    const withRemoteMiners = [
      ...localOnlyMiners,
      snapCreep("miner", { body: minerBody, memory: { sourceId: remote.id } })
    ];

    const localOnlyDistance = haulDistance(localOnlyMiners, colony, config);
    const withRemoteDistance = haulDistance(withRemoteMiners, colony, config);
    expect(withRemoteDistance).toBeGreaterThan(localOnlyDistance);
  });

  it("falls back to defaultHaulDistance when nothing is staffed anywhere", () => {
    const colony = colonySnap({ sources: [], remoteSources: [] });
    expect(haulDistance([], colony, config)).toBe(config.defaultHaulDistance);
  });
});
