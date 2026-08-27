// canHostBoosting (gh #61 epic, Task E): a colony that can never host boost labs at all — below RCL6, fewer
// than 3 labs actually built, or no terminal — must never even be considered a candidate for a boosted
// sponsor pick, regardless of tier stock. See sponsor.ts's own doc for the exact three-part rule.

import { describe, expect, it } from "vitest";
import { canHostBoosting } from "../../../src/empire/sponsor";
import { testColony } from "../../fixtures";
import { stubGame } from "../../helpers";

function setUpLabs(room: string, labCount: number): void {
  const game = (globalThis as { Game: { rooms: Record<string, unknown> } }).Game;
  game.rooms[room] = {
    find: (_type: unknown, opts?: { filter: (s: { structureType: string }) => boolean }) => {
      const labs = Array.from({ length: labCount }, () => ({ structureType: "lab" }));
      return opts?.filter ? labs.filter(opts.filter) : labs;
    }
  };
}

describe("canHostBoosting", () => {
  it("is false below RCL6 even with a terminal and 3+ labs", () => {
    stubGame();
    setUpLabs("W1N1", 3);
    const colony = testColony({ name: "W1N1", controllerLevel: 5, terminalId: "term1" as Id<StructureTerminal> });
    expect(canHostBoosting(colony)).toBe(false);
  });

  it("is false with fewer than 3 labs built, even at RCL6+ with a terminal", () => {
    stubGame();
    setUpLabs("W1N1", 2);
    const colony = testColony({ name: "W1N1", controllerLevel: 6, terminalId: "term1" as Id<StructureTerminal> });
    expect(canHostBoosting(colony)).toBe(false);
  });

  it("is false with no terminal, even at RCL6+ with 3+ labs", () => {
    stubGame();
    setUpLabs("W1N1", 3);
    const colony = testColony({ name: "W1N1", controllerLevel: 6, terminalId: undefined });
    expect(canHostBoosting(colony)).toBe(false);
  });

  it("is true at RCL6+, 3+ labs, and a terminal", () => {
    stubGame();
    setUpLabs("W1N1", 3);
    const colony = testColony({ name: "W1N1", controllerLevel: 6, terminalId: "term1" as Id<StructureTerminal> });
    expect(canHostBoosting(colony)).toBe(true);
  });

  it("is true with more than 3 labs built", () => {
    stubGame();
    setUpLabs("W1N1", 6);
    const colony = testColony({ name: "W1N1", controllerLevel: 8, terminalId: "term1" as Id<StructureTerminal> });
    expect(canHostBoosting(colony)).toBe(true);
  });
});
