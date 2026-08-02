import { beforeEach, describe, expect, it } from "vitest";
import { scanHostileActions } from "../../src/kernel/hostileActions";
import { stubGame } from "../helpers";

function room(events: unknown[]): Record<string, unknown> {
  return { getEventLog: () => events };
}

describe("scanHostileActions", () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).Memory = {};
  });

  it("marks an attacker's owner hostile when it damages one of our creeps", () => {
    stubGame({
      rooms: { W1N1: room([{ event: EVENT_ATTACK, objectId: "enemy1", data: { targetId: "mine1", damage: 10, attackType: 1 } }]) },
      objects: {
        mine1: { my: true },
        enemy1: { owner: { username: "Griefer" } }
      }
    });

    scanHostileActions();

    expect(Memory.playerReputation?.Griefer).toBe("hostile");
  });

  it("ignores an attack that doesn't target something of ours", () => {
    stubGame({
      rooms: { W1N1: room([{ event: EVENT_ATTACK, objectId: "enemy1", data: { targetId: "theirs1", damage: 10, attackType: 1 } }]) },
      objects: {
        theirs1: { my: false },
        enemy1: { owner: { username: "Griefer" } }
      }
    });

    scanHostileActions();

    expect(Memory.playerReputation?.Griefer).toBeUndefined();
  });

  it("ignores non-attack events", () => {
    stubGame({
      rooms: { W1N1: room([{ event: EVENT_HEAL, objectId: "healer1", data: { targetId: "mine1", amount: 10, healType: 1 } }]) },
      objects: { mine1: { my: true }, healer1: { owner: { username: "SomePlayer" } } }
    });

    scanHostileActions();

    expect(Memory.playerReputation).toBeUndefined();
  });

  it("never downgrades a player already marked dangerous", () => {
    stubGame({
      rooms: { W1N1: room([{ event: EVENT_ATTACK, objectId: "enemy1", data: { targetId: "mine1", damage: 10, attackType: 1 } }]) },
      objects: { mine1: { my: true }, enemy1: { owner: { username: "Griefer" } } }
    });
    Memory.playerReputation = { Griefer: "dangerous" };

    scanHostileActions();

    expect(Memory.playerReputation.Griefer).toBe("dangerous");
  });
});
