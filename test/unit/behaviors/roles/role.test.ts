import { describe, expect, it } from "vitest";
import { Role } from "../../../../src/behaviors/roles/role";
import { SimpleHealerRole } from "../../../../src/behaviors/roles/simpleHealer";

describe("Role.boostable", () => {
  it("defaults to empty — most roles are never boost candidates", () => {
    expect(Role.boostable).toEqual([]);
  });

  it("Healer declares the abstract boost actions its body supports", () => {
    expect(SimpleHealerRole.boostable).toEqual(["heal", "tough"]);
  });
});

describe("CreepMemory.boosts", () => {
  it("accepts a list of outstanding boost action names, or is absent", () => {
    const withOrder: Pick<CreepMemory, "boosts"> = { boosts: ["heal", "tough"] };
    const withoutOrder: Pick<CreepMemory, "boosts"> = {};

    expect(withOrder.boosts).toEqual(["heal", "tough"]);
    expect(withoutOrder.boosts).toBeUndefined();
  });
});
