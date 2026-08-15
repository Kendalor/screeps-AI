import { describe, expect, it } from "vitest";
import { buildCostMatrix } from "../../../src/construction/roadPathing";

function openTerrain(): Uint8Array {
  return new Uint8Array(2500).fill(1); // all walkable
}

describe("buildCostMatrix", () => {
  it("marks wall tiles impassable", () => {
    const terrain = openTerrain();
    terrain[10 * 50 + 10] = 0; // wall

    const cm = buildCostMatrix({ terrain, structures: [] });

    expect(cm.get(10, 10)).toBe(255);
  });

  it("marks existing road tiles cheap", () => {
    const terrain = openTerrain();

    const cm = buildCostMatrix({ terrain, structures: [{ x: 12, y: 12, type: "road" }] });

    expect(cm.get(12, 12)).toBe(1);
  });

  it("prices a road strictly below plain terrain, so a tie always keeps the built route", () => {
    const cm = buildCostMatrix({ terrain: openTerrain(), structures: [{ x: 12, y: 12, type: "road" }] });

    expect(cm.get(12, 12)).toBeLessThan(cm.get(13, 13)); // (13,13) is plain terrain, unclaimed
  });

  it("leaves container tiles walkable — creeps stand on them, they are not obstacles", () => {
    const cm = buildCostMatrix({
      terrain: openTerrain(),
      structures: [{ x: 12, y: 12, type: "container" }]
    });

    expect(cm.get(12, 12)).toBeLessThan(255);
  });

  it("marks blocking structures impassable", () => {
    const cm = buildCostMatrix({
      terrain: openTerrain(),
      structures: [{ x: 12, y: 12, type: "extension" }]
    });

    expect(cm.get(12, 12)).toBe(255);
  });

  // A road can never legitimately stand on a wall — Screeps refuses the construction site outright — so
  // a "road" structure entry at a wall tile is always bogus input, not a real claim to trust. Confirmed
  // live on W47N14 2026-08-13: a remote-room road claim leaked into the home room's structures list
  // (same (x,y), different room — see operations/mining.ts and operations/upgrading.ts's now-fixed
  // room filter) and, before this guard existed, turned a real wall into a cheap ROAD_COST tile, letting
  // A* "tunnel" straight through it.
  it("never lets a road claim override wall terrain — wall wins even over a claimed road", () => {
    const terrain = openTerrain();
    terrain[12 * 50 + 12] = 0; // wall

    const cm = buildCostMatrix({ terrain, structures: [{ x: 12, y: 12, type: "road" }] });

    expect(cm.get(12, 12)).toBe(255);
  });
});
