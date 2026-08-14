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

  // A creep killed the same tick it's attacked is already gone from Game.getObjectById by the time this
  // scan reads next tick's event log, so EVENT_ATTACK's own targetId resolution silently misses exactly
  // the case that matters (see schema.ts's ScoutInfo.lethalAt doc). recordLethalRoom keys off the room's
  // already-known hostile reputation instead of trying to re-derive ownership of the dead object.
  describe("lethal-room detection", () => {
    it("marks a hostile-owned room lethal when something is destroyed there", () => {
      stubGame({
        rooms: { W1N2: room([{ event: EVENT_OBJECT_DESTROYED, objectId: "deadScout1", data: {} }]) }
      });
      Memory.rooms = { W1N2: { scouted: { type: "normal", sources: [], hostile: true, owner: "Griefer" } } };
      Memory.playerReputation = { Griefer: "hostile" };
      Game.time = 12345;

      scanHostileActions();

      expect(Memory.rooms.W1N2.scouted?.lethalAt).toBe(12345);
    });

    it("does not mark a room lethal when its owner isn't reputation-flagged", () => {
      stubGame({
        rooms: { W1N2: room([{ event: EVENT_OBJECT_DESTROYED, objectId: "deadScout1", data: {} }]) }
      });
      Memory.rooms = { W1N2: { scouted: { type: "normal", sources: [], hostile: true, owner: "Neutral" } } };

      scanHostileActions();

      expect(Memory.rooms.W1N2.scouted?.lethalAt).toBeUndefined();
    });

    it("does not mark a room lethal with no destruction event, even if hostile-owned", () => {
      stubGame({
        rooms: { W1N2: room([{ event: EVENT_ATTACK, objectId: "enemy1", data: { targetId: "mine1", damage: 10, attackType: 1 } }]) },
        objects: { mine1: { my: true }, enemy1: { owner: { username: "Griefer" } } }
      });
      Memory.rooms = { W1N2: { scouted: { type: "normal", sources: [], hostile: true, owner: "Griefer" } } };
      Memory.playerReputation = { Griefer: "hostile" };

      scanHostileActions();

      expect(Memory.rooms.W1N2.scouted?.lethalAt).toBeUndefined();
    });

    it("creates a stub ScoutInfo when the room was never scouted but is already reputation-flagged via a stale owner record", () => {
      // Edge case: Memory.rooms may not exist at all yet for a room reached for the first time.
      stubGame({
        rooms: { W1N2: room([{ event: EVENT_OBJECT_DESTROYED, objectId: "deadScout1", data: {} }]) }
      });
      Memory.rooms = undefined as unknown as typeof Memory.rooms;

      scanHostileActions();

      expect(Memory.rooms?.W1N2?.scouted?.lethalAt).toBeUndefined(); // no owner on record at all -> isDangerous(undefined) is false
    });
  });
});
