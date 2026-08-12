import { describe, expect, it } from "vitest";
import { planPixels } from "../../../src/empire/pixels";

describe("planPixels", () => {
  it("emits generatePixel when the bucket is at PIXEL_CPU_COST", () => {
    expect(planPixels(PIXEL_CPU_COST)).toEqual([{ kind: "generatePixel" }]);
  });

  it("emits generatePixel when the bucket exceeds PIXEL_CPU_COST", () => {
    expect(planPixels(PIXEL_CPU_COST + 1)).toEqual([{ kind: "generatePixel" }]);
  });

  it("emits nothing below PIXEL_CPU_COST", () => {
    expect(planPixels(PIXEL_CPU_COST - 1)).toEqual([]);
  });
});
