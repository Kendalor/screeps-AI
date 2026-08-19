// dispatchSteward's own movement-gate logic (empire/creeps.ts) — the anchor-travel mechanics that used to
// be covered by test/unit/steward.test.ts (stewardBehavior.ts's own tests, deleted at gh #54's cutover
// alongside stewardBehavior.ts itself). Deliberately narrow: this only proves the travel-then-delegate
// gate dispatchSteward owns (no anchor -> no-op, not parked -> travelTo only, parked -> delegates to
// stewardTaskRunner.ts's runStewardTask and does real work). The rate-ranking/registration decisions
// runStewardTask delegates to are already covered by test/unit/logistics/stewardRegister.test.ts — not
// re-proven here.

import { describe, expect, it } from "vitest";
import { dispatchSteward } from "../../../src/empire/creeps";
import { stubGame } from "../../helpers";
import { clearTiles, stubTile } from "../../constants";

const ANCHOR = { x: 20, y: 20 };
const HOME = "W1N1";

function store(used: number, capacity: number) {
  return {
    getUsedCapacity: () => used,
    getFreeCapacity: () => capacity - used,
    getCapacity: () => capacity
  };
}

function setMemory(over: { anchor?: { x: number; y: number } } = {}): void {
  (Memory as unknown as { colonies: Record<string, unknown> }).colonies = {
    [HOME]: { anchor: "anchor" in over ? over.anchor : ANCHOR, links: {} }
  };
}

interface StewardFixture {
  pos?: { x: number; y: number };
  used?: number;
  capacity?: number;
  storage?: { id: string; used: number; capacity: number } | null;
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
  const anchorPosLike = { x: ANCHOR.x, y: ANCHOR.y, roomName: HOME };

  const storageObj = fixture.storage
    ? { id: fixture.storage.id, structureType: STRUCTURE_STORAGE, pos: anchorPosLike, store: store(fixture.storage.used, fixture.storage.capacity) }
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
    memory: { role: "steward", home: HOME },
    store: store(fixture.used ?? 0, fixture.capacity ?? 800),
    pos: new (RoomPosition as unknown as new (x: number, y: number, roomName: string) => RoomPosition)(pos.x, pos.y, HOME),
    room: { name: HOME, storage: storageObj, terminal: undefined },
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

describe("dispatchSteward", () => {
  it("does nothing (no crash) when no anchor is known yet", () => {
    stubGame({});
    setMemory({ anchor: undefined });
    const { creep, traveled, calls } = stewardCreep({});

    dispatchSteward(creep);

    expect(traveled).toHaveLength(0);
    expect(calls).toEqual({ withdraw: 0, pickup: 0, transfer: 0 });
  });

  it("travels to the anchor when not yet parked there, without running the task pool this tick", () => {
    stubGame({});
    setMemory();
    const { creep, traveled, calls } = stewardCreep({ pos: { x: 0, y: 0 }, link: { id: "link1", used: 500, capacity: 800 } });

    dispatchSteward(creep);

    expect(traveled).toEqual([ANCHOR]);
    expect(calls).toEqual({ withdraw: 0, pickup: 0, transfer: 0 });
  });

  it("does not move once parked on the anchor", () => {
    stubGame({});
    setMemory();
    const { creep, traveled } = stewardCreep({});

    dispatchSteward(creep);

    expect(traveled).toHaveLength(0);
  });

  it("delegates to the rate-ranked pool once parked, draining a link that holds energy toward storage", () => {
    stubGame({});
    setMemory();
    const { creep, calls } = stewardCreep({
      storage: { id: "storage1", used: 1000, capacity: 100_000 },
      link: { id: "link1", used: 500, capacity: 800 }
    });

    dispatchSteward(creep);

    expect(calls.withdraw).toBe(1);
  });

  it("does nothing when parked but the pool has no work", () => {
    stubGame({});
    setMemory();
    const { creep, calls, traveled } = stewardCreep({
      storage: { id: "storage1", used: 10_000, capacity: 100_000 }
    });

    dispatchSteward(creep);

    expect(calls).toEqual({ withdraw: 0, pickup: 0, transfer: 0 });
    expect(traveled).toHaveLength(0);
  });
});
