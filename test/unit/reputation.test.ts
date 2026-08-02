import { beforeEach, describe, expect, it } from "vitest";
import { isDangerous, recordHostileAction, reputationOf } from "../../src/memory/reputation";

describe("reputation", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).Memory = {};
  });

  it("defaults an unlisted player to neutral", () => {
    expect(reputationOf("SomePlayer")).toBe("neutral");
    expect(isDangerous("SomePlayer")).toBe(false);
  });

  it("defaults an absent username (no owner) to neutral", () => {
    expect(reputationOf(undefined)).toBe("neutral");
    expect(isDangerous(undefined)).toBe(false);
  });

  it("hard-codes Invader as hostile and Source Keeper as dangerous, regardless of Memory", () => {
    Memory.playerReputation = { Invader: "friendly", "Source Keeper": "friendly" };

    expect(reputationOf("Invader")).toBe("hostile");
    expect(reputationOf("Source Keeper")).toBe("dangerous");
    expect(isDangerous("Invader")).toBe(true);
    expect(isDangerous("Source Keeper")).toBe(true);
  });

  it("reads a console-set reputation from Memory.playerReputation", () => {
    Memory.playerReputation = { Griefer: "dangerous", Ally: "friendly" };

    expect(reputationOf("Griefer")).toBe("dangerous");
    expect(isDangerous("Griefer")).toBe(true);
    expect(reputationOf("Ally")).toBe("friendly");
    expect(isDangerous("Ally")).toBe(false);
  });

  it("recordHostileAction bumps an unlisted player to hostile", () => {
    recordHostileAction("Attacker");
    expect(Memory.playerReputation?.Attacker).toBe("hostile");
    expect(isDangerous("Attacker")).toBe(true);
  });

  it("recordHostileAction never downgrades an existing dangerous rating", () => {
    Memory.playerReputation = { Attacker: "dangerous" };
    recordHostileAction("Attacker");
    expect(Memory.playerReputation.Attacker).toBe("dangerous");
  });

  it("recordHostileAction overwrites a friendly/neutral rating with hostile", () => {
    Memory.playerReputation = { Turncoat: "friendly" };
    recordHostileAction("Turncoat");
    expect(Memory.playerReputation.Turncoat).toBe("hostile");
  });

  it("recordHostileAction never writes an NPC into Memory", () => {
    recordHostileAction("Invader");
    expect(Memory.playerReputation?.Invader).toBeUndefined();
  });
});
