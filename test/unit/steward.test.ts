import { describe, expect, it } from "vitest";
import { runSteward } from "../../src/behaviors/steward";
import { stubGame } from "../helpers";
import { clearTiles, stubTile } from "../constants";

const ANCHOR = { x: 20, y: 20 };
const HOME = "W1N1";

function store(used: number, capacity: number) {
  return {
    getUsedCapacity: () => used,
    getFreeCapacity: () => capacity - used,
    getCapacity: () => capacity
  };
}

function setMemory(over: { anchor?: { x: number; y: number }; controllerLink?: string } = {}): void {
  (Memory as unknown as { colonies: Record<string, unknown> }).colonies = {
    [HOME]: {
      anchor: "anchor" in over ? over.anchor : ANCHOR,
      links: over.controllerLink ? { controller: over.controllerLink } : {}
    }
  };
}

interface StewardFixture {
  memory: CreepMemory;
  pos?: { x: number; y: number };
  used?: number;
  capacity?: number;
  storage?: { id: string; used: number; capacity: number } | null;
  terminal?: { id: string; used: number; capacity: number } | null;
  // The anchor-adjacent link, registered onto the tile map so RoomPosition.findInRange (the real
  // engine's own lookup, exercised via the RoomPositionStub in test/constants.ts) can find it —
  // anchorLink() in steward.ts calls findInRange on the ANCHOR position, not on the creep's own pos.
  link?: { id: string; used: number; capacity: number } | null;
}

function stewardCreep(fixture: StewardFixture): {
  creep: Creep;
  calls: { withdraw: number; pickup: number; transfer: number };
  traveled: { x: number; y: number }[];
} {
  const calls = { withdraw: 0, pickup: 0, transfer: 0 };
  const traveled: { x: number; y: number }[] = [];
  const pos = fixture.pos ?? ANCHOR;

  // All three sit adjacent to the anchor in the real bunker layout — give every stub a `pos` at the
  // anchor itself so RoomPositionStub.inRangeTo (which the shared act-or-travel leaf in actions.ts
  // checks before withdraw/transfer) reads them as in range, exactly as the real game would.
  const anchorPosLike = { x: ANCHOR.x, y: ANCHOR.y, roomName: HOME };
  const storageObj = fixture.storage
    ? { id: fixture.storage.id, structureType: STRUCTURE_STORAGE, pos: anchorPosLike, store: store(fixture.storage.used, fixture.storage.capacity) }
    : undefined;
  const terminalObj = fixture.terminal
    ? { id: fixture.terminal.id, structureType: STRUCTURE_TERMINAL, pos: anchorPosLike, store: store(fixture.terminal.used, fixture.terminal.capacity) }
    : undefined;

  clearTiles();
  if (fixture.link) {
    const linkObj = {
      id: fixture.link.id,
      structureType: STRUCTURE_LINK,
      pos: anchorPosLike,
      room: { name: HOME },
      store: store(fixture.link.used, fixture.link.capacity)
    };
    stubTile(HOME, ANCHOR.x, ANCHOR.y, { structure: [linkObj] });
  }

  const creep = {
    id: "steward1",
    name: "steward1",
    memory: fixture.memory,
    store: store(fixture.used ?? 0, fixture.capacity ?? 800),
    pos: new (RoomPosition as unknown as new (x: number, y: number, roomName: string) => RoomPosition)(pos.x, pos.y, HOME),
    room: {
      name: HOME,
      storage: storageObj,
      terminal: terminalObj
    },
    withdraw: () => {
      calls.withdraw++;
      return OK;
    },
    pickup: () => {
      calls.pickup++;
      return OK;
    },
    transfer: () => {
      calls.transfer++;
      return OK;
    },
    travelTo: (t: { x: number; y: number }) => {
      traveled.push({ x: t.x, y: t.y });
    }
  };
  return { creep: creep as unknown as Creep, calls, traveled };
}

describe("runSteward", () => {
  it("does nothing (no crash) when no anchor is known yet", () => {
    stubGame({});
    setMemory({ anchor: undefined });
    const { creep, traveled } = stewardCreep({ memory: { role: "steward", home: HOME } });

    runSteward(creep);

    expect(traveled).toHaveLength(0);
  });

  it("travels to the anchor when not yet parked there", () => {
    stubGame({});
    setMemory();
    const { creep, traveled } = stewardCreep({ memory: { role: "steward", home: HOME }, pos: { x: 0, y: 0 } });

    runSteward(creep);

    expect(traveled).toEqual([ANCHOR]);
  });

  it("does not move once parked on the anchor", () => {
    stubGame({});
    setMemory();
    const { creep, traveled } = stewardCreep({ memory: { role: "steward", home: HOME } });

    runSteward(creep);

    expect(traveled).toHaveLength(0);
  });

  it("delivers carried energy to its recorded destination", () => {
    stubGame({ objects: { storage1: { id: "storage1", pos: { x: ANCHOR.x, y: ANCHOR.y, roomName: HOME }, store: store(1000, 100_000) } } });
    setMemory();
    const { creep, calls } = stewardCreep({
      memory: { role: "steward", home: HOME, stewardDest: "storage1" as Id<StructureStorage> },
      used: 200,
      capacity: 800
    });

    runSteward(creep);

    expect(calls.transfer).toBe(1);
  });

  it("drains the anchor link toward storage the instant it holds anything", () => {
    stubGame({});
    setMemory();
    const { creep, calls } = stewardCreep({
      memory: { role: "steward", home: HOME },
      storage: { id: "storage1", used: 1000, capacity: 100_000 },
      link: { id: "link1", used: 1, capacity: 800 }
    });

    runSteward(creep);

    expect(calls.withdraw).toBe(1);
    expect(creep.memory.stewardDest).toBe("storage1");
  });

  describe("feeding the anchor link toward a low controller link", () => {
    it("withdraws from storage and heads for the anchor link when the controller link is running low", () => {
      stubGame({});
      setMemory({ controllerLink: "clink1" });
      // Live controller-link lookup goes through Game.getObjectById — stub it low (below the 50% floor).
      (Game as unknown as { getObjectById: (id: string) => unknown }).getObjectById = (id: string) =>
        id === "clink1" ? { store: store(100, 800) } : null;

      const { creep, calls } = stewardCreep({
        memory: { role: "steward", home: HOME },
        storage: { id: "storage1", used: 50_000, capacity: 100_000 },
        link: { id: "alink1", used: 0, capacity: 800 } // anchor link empty — nothing to drain, room to feed
      });

      runSteward(creep);

      expect(calls.withdraw).toBe(1);
      expect(creep.memory.stewardDest).toBe("alink1");
    });

    it("does not feed the link when the controller link is already well-stocked", () => {
      stubGame({});
      setMemory({ controllerLink: "clink1" });
      (Game as unknown as { getObjectById: (id: string) => unknown }).getObjectById = (id: string) =>
        id === "clink1" ? { store: store(700, 800) } : null; // above the 50% floor

      const { creep, calls } = stewardCreep({
        memory: { role: "steward", home: HOME },
        storage: { id: "storage1", used: 50_000, capacity: 100_000 },
        link: { id: "alink1", used: 0, capacity: 800 }
      });

      runSteward(creep);

      expect(calls.withdraw).toBe(0);
    });

    it("does not feed the link when no controller link has been recorded yet", () => {
      stubGame({});
      setMemory(); // no controllerLink
      const { creep, calls } = stewardCreep({
        memory: { role: "steward", home: HOME },
        storage: { id: "storage1", used: 50_000, capacity: 100_000 },
        link: { id: "alink1", used: 0, capacity: 800 }
      });

      runSteward(creep);

      expect(calls.withdraw).toBe(0);
    });

    it("drains a full anchor link toward storage rather than feeding it further", () => {
      // A full anchor link still has energy (draining takes priority — see the drain branch above), so
      // this must never fall through to the feed branch and try to push even more into it.
      stubGame({});
      setMemory({ controllerLink: "clink1" });
      (Game as unknown as { getObjectById: (id: string) => unknown }).getObjectById = (id: string) =>
        id === "clink1" ? { store: store(100, 800) } : null;

      const { creep, calls } = stewardCreep({
        memory: { role: "steward", home: HOME },
        storage: { id: "storage1", used: 50_000, capacity: 100_000 },
        link: { id: "alink1", used: 800, capacity: 800 } // already full
      });

      runSteward(creep);

      expect(calls.withdraw).toBe(1);
      expect(creep.memory.stewardDest).toBe("storage1"); // drained toward storage, not fed further
    });
  });

  it("rebalances storage -> terminal once storage has a surplus and the terminal is low", () => {
    stubGame({});
    setMemory();
    const { creep, calls } = stewardCreep({
      memory: { role: "steward", home: HOME },
      storage: { id: "storage1", used: 60_000, capacity: 100_000 }, // > 50%
      terminal: { id: "terminal1", used: 1_000, capacity: 100_000 } // < 50%
    });

    runSteward(creep);

    expect(calls.withdraw).toBe(1);
    expect(creep.memory.stewardDest).toBe("terminal1");
  });

  it("does not rebalance when storage has no surplus", () => {
    stubGame({});
    setMemory();
    const { creep, calls } = stewardCreep({
      memory: { role: "steward", home: HOME },
      storage: { id: "storage1", used: 10_000, capacity: 100_000 },
      terminal: { id: "terminal1", used: 1_000, capacity: 100_000 }
    });

    runSteward(creep);

    expect(calls.withdraw).toBe(0);
  });

  it("does nothing when there is no work at all", () => {
    stubGame({});
    setMemory();
    const { creep, calls, traveled } = stewardCreep({
      memory: { role: "steward", home: HOME },
      storage: { id: "storage1", used: 10_000, capacity: 100_000 }
    });

    runSteward(creep);

    expect(calls).toEqual({ withdraw: 0, pickup: 0, transfer: 0 });
    expect(traveled).toHaveLength(0);
  });
});
