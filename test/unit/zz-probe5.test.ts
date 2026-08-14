import { describe, it } from "vitest";
import { wantedTransportHeadcount } from "../../src/logistics/fleet";
import { grossHarvest } from "../../src/mining/remoteEconomics";
import { haulerBody } from "../../src/behaviors/roles/hauler";
import { remoteMinerBody } from "../../src/mining/load";

describe("probe5", () => {
  it("real pooled cost for actual selection", () => {
    const energyCapacity = 1800;
    const config = {
      sourceRegenPerTick: 10, roomIncomeCap: 20, defaultHaulDistance: 10,
      energyPerCarry: 50, carryMargin: 1.2, maxTransport: 12
    };
    const remotes = [
      { distance: 26, reserved: false },
      { distance: 57, reserved: false },
      { distance: 65, reserved: false },
      { distance: 69, reserved: false },
    ];
    // local: assume colony has 2 local sources with a small local distance (approximate typical anchor->source ~5-15)
    const localIncome = 20; // roomIncomeCap for 2 sources
    const localDistance = 10; // defaultHaulDistance approx
    let totalIncome = localIncome;
    let weightedSum = localIncome * localDistance;
    for (const r of remotes) {
      const income = grossHarvest(r.reserved);
      totalIncome += income;
      weightedSum += income * r.distance;
    }
    const avgDistance = weightedSum / totalIncome;
    const headcount = wantedTransportHeadcount(totalIncome, avgDistance, energyCapacity, config);
    const body = haulerBody(energyCapacity);
    console.log("totalIncome:", totalIncome, "avgDistance:", avgDistance.toFixed(1), "headcount:", headcount, "parts:", headcount * body.length);

    let minerParts = 0;
    for (const r of remotes) minerParts += remoteMinerBody(energyCapacity, r.reserved).length;
    console.log("minerParts (4 remote miners):", minerParts);
    console.log("real remote fleet total (transport pooled minus local-only headcount, roughly):", headcount * body.length + minerParts);
  });
});
