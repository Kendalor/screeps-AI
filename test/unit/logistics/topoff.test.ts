// Pure decision logic for a transport creep's live top-off detour — no Game.* mocking needed, unlike
// transport.test.ts's runTransport-level coverage of the same mechanism (which still owns the scenarios
// that exercise the Game.* candidate-gathering half, see logisticsRunner.ts's findLiveTopoff).

import { describe, expect, it } from "vitest";
import { pickTopoff, topoffRange, TOPOFF_RANGE_MAX, TOPOFF_RANGE_MIN, TOPOFF_RANGE_PER_ROOM, TOPOFF_WORTHWHILE_FLOOR, type TopoffCandidate } from "../../../src/logistics/topoff";

const candidate = (id: string, x: number, y: number, amount: number): TopoffCandidate => ({
  ref: { kind: "structure", id: id as Id<AnyStoreStructure> },
  pos: { x, y },
  amount
});

describe("topoffRange", () => {
  it("is TOPOFF_RANGE_MIN right at home (0 rooms away)", () => {
    expect(topoffRange(0)).toBe(TOPOFF_RANGE_MIN);
  });

  it("grows by TOPOFF_RANGE_PER_ROOM tiles per room of remaining trip", () => {
    expect(topoffRange(1)).toBe(TOPOFF_RANGE_MIN + TOPOFF_RANGE_PER_ROOM);
  });

  it("caps at TOPOFF_RANGE_MAX no matter how far the trip", () => {
    expect(topoffRange(10)).toBe(TOPOFF_RANGE_MAX);
  });
});

describe("pickTopoff", () => {
  it("picks the nearest worthwhile container over a pile", () => {
    const container = candidate("cont1", 1, 0, TOPOFF_WORTHWHILE_FLOOR);
    const pile = candidate("drop1", 0, 0, 500); // exactly at the creep's position, but a pile

    const picked = pickTopoff({ x: 0, y: 0 }, [container], [pile], undefined);

    expect(picked).toBe(container);
  });

  it("falls back to a pile only when no container qualifies", () => {
    const pile = candidate("drop1", 1, 0, 200);

    const picked = pickTopoff({ x: 0, y: 0 }, [], [pile], undefined);

    expect(picked).toBe(pile);
  });

  it("excludes the just-drained provider by id, even if otherwise eligible", () => {
    const drained = candidate("cont1", 1, 0, 500);
    const other = candidate("cont2", 2, 0, 500);

    const picked = pickTopoff({ x: 0, y: 0 }, [drained, other], [], "cont1" as Id<_HasId>);

    expect(picked).toBe(other);
  });

  it("filters out anything below the worthwhile floor", () => {
    const tooSmall = candidate("cont1", 1, 0, TOPOFF_WORTHWHILE_FLOOR - 1);

    const picked = pickTopoff({ x: 0, y: 0 }, [tooSmall], [], undefined);

    expect(picked).toBeUndefined();
  });

  it("picks the nearest of several eligible containers", () => {
    const far = candidate("cont1", 4, 0, 200);
    const near = candidate("cont2", 1, 0, 200);

    const picked = pickTopoff({ x: 0, y: 0 }, [far, near], [], undefined);

    expect(picked).toBe(near);
  });

  it("returns undefined when nothing qualifies", () => {
    expect(pickTopoff({ x: 0, y: 0 }, [], [], undefined)).toBeUndefined();
  });
});
