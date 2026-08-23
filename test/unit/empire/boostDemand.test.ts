import { describe, expect, it } from "vitest";
import { aggregateBoostDemand } from "../../../src/empire/boostDemand";

describe("aggregateBoostDemand", () => {
  it("pools two creeps needing the SAME compound into one summed amount", () => {
    const result = aggregateBoostDemand([
      { creepId: "creepA" as Id<Creep>, needs: { GH2O: 400 } },
      { creepId: "creepB" as Id<Creep>, needs: { GH2O: 400 } }
    ]);

    expect(result).toEqual({ GH2O: 800 });
  });

  it("keeps DIFFERENT compounds as separate entries, summed only across the creeps that need each", () => {
    const result = aggregateBoostDemand([
      { creepId: "creepA" as Id<Creep>, needs: { GH2O: 400 } },
      { creepId: "creepB" as Id<Creep>, needs: { XUH2O: 200 } },
      { creepId: "creepC" as Id<Creep>, needs: { GH2O: 100 } }
    ]);

    expect(result).toEqual({ GH2O: 500, XUH2O: 200 });
  });

  it("returns a single creep's demand unchanged", () => {
    const result = aggregateBoostDemand([{ creepId: "creepA" as Id<Creep>, needs: { GH2O: 400 } }]);

    expect(result).toEqual({ GH2O: 400 });
  });

  it("sums multiple compounds needed by the SAME creep alongside pooling across creeps", () => {
    const result = aggregateBoostDemand([
      { creepId: "creepA" as Id<Creep>, needs: { GH2O: 400, XUH2O: 100 } },
      { creepId: "creepB" as Id<Creep>, needs: { GH2O: 400 } }
    ]);

    expect(result).toEqual({ GH2O: 800, XUH2O: 100 });
  });

  it("returns an empty object for no demands", () => {
    const result = aggregateBoostDemand([]);

    expect(result).toEqual({});
  });
});
