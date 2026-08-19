// Unit-proves gh #51's Steward registration functions (logistics/stewardRegister.ts) against minimal
// stubs of the exact Game API surface they read (.store.getUsedCapacity/getCapacity/getFreeCapacity),
// same "fake the live-object shape, not a ColonySnapshot" pattern test/unit/logistics/register.test.ts
// already uses for registerMinerContainerOutput. Also proves the reuse half of the ticket directly: the
// LogisticsRequest objects these functions build are fed straight into request.ts's real
// scoreRequest/pickBestRequest (gh #46) and route.ts's real evaluateRoutes/pickBestRoute (gh #47) — no
// reimplementation, no stubbing of the scorer/detour logic itself, only the live Game.* target shapes are
// faked. The mockup-server integration seam originally planned for this ticket was dropped (too heavy to
// seed reliably — link/storage/terminal store-mutation semantics didn't behave as expected under
// withdraw/transfer in the sandboxed server); stewardTaskRunner.ts's dispatch glue (the part that actually
// calls Game.getObjectById/creep.withdraw/creep.travelTo) is therefore left committed but UNTESTED — see
// this file's own header note repeated in the PR/commit description.

import { describe, expect, it } from "vitest";
import {
  CONTROLLER_LINK_LOW_FRACTION,
  LINK_DRAIN_FLOOR,
  registerControllerLinkTopUpRequest,
  registerLinkDrainRequest,
  registerStewardRequests,
  registerTerminalRebalanceRequest,
  STORAGE_SURPLUS_FRACTION,
  TERMINAL_LOW_FRACTION
} from "../../../src/logistics/stewardRegister";
import { pickBestRequest } from "../../../src/logistics/request";
import { evaluateRoutes, pickBestRoute, type Buffer } from "../../../src/logistics/route";

const LINK_CAPACITY = 800;
const STORAGE_CAPACITY = 1_000_000;
const TERMINAL_CAPACITY = 300_000;

function pos(x: number, y: number): RoomPosition {
  return { x, y, roomName: "W1N1" } as unknown as RoomPosition;
}

function stubLink(id: string, stored: number, x = 10, y = 10): StructureLink {
  return {
    id: id as Id<StructureLink>,
    pos: pos(x, y),
    structureType: STRUCTURE_LINK,
    store: {
      getUsedCapacity: (r: ResourceConstant) => (r === RESOURCE_ENERGY ? stored : 0),
      getCapacity: (r: ResourceConstant) => (r === RESOURCE_ENERGY ? LINK_CAPACITY : 0),
      getFreeCapacity: (r: ResourceConstant) => (r === RESOURCE_ENERGY ? LINK_CAPACITY - stored : 0)
    }
  } as unknown as StructureLink;
}

function stubStorage(stored: number, x = 5, y = 5): StructureStorage {
  return {
    id: "storage1" as Id<StructureStorage>,
    pos: pos(x, y),
    structureType: STRUCTURE_STORAGE,
    store: {
      getUsedCapacity: (r: ResourceConstant) => (r === RESOURCE_ENERGY ? stored : 0),
      getCapacity: (r: ResourceConstant) => (r === RESOURCE_ENERGY ? STORAGE_CAPACITY : 0),
      getFreeCapacity: (r: ResourceConstant) => (r === RESOURCE_ENERGY ? STORAGE_CAPACITY - stored : 0)
    }
  } as unknown as StructureStorage;
}

function stubTerminal(stored: number, x = 20, y = 20): StructureTerminal {
  return {
    id: "terminal1" as Id<StructureTerminal>,
    pos: pos(x, y),
    structureType: STRUCTURE_TERMINAL,
    store: {
      getUsedCapacity: (r: ResourceConstant) => (r === RESOURCE_ENERGY ? stored : 0),
      getCapacity: (r: ResourceConstant) => (r === RESOURCE_ENERGY ? TERMINAL_CAPACITY : 0),
      getFreeCapacity: (r: ResourceConstant) => (r === RESOURCE_ENERGY ? TERMINAL_CAPACITY - stored : 0)
    }
  } as unknown as StructureTerminal;
}

// ---------------------------------------------------------------------------
// registerLinkDrainRequest
// ---------------------------------------------------------------------------

describe("registerLinkDrainRequest", () => {
  it("returns undefined when the link is empty (at LINK_DRAIN_FLOOR)", () => {
    const link = stubLink("link1", LINK_DRAIN_FLOOR);
    const storage = stubStorage(0);
    expect(registerLinkDrainRequest(link, storage)).toBeUndefined();
  });

  it("returns undefined when there is no link", () => {
    expect(registerLinkDrainRequest(undefined, stubStorage(0))).toBeUndefined();
  });

  it("returns undefined when there is no storage to drain into", () => {
    expect(registerLinkDrainRequest(stubLink("link1", 400), undefined)).toBeUndefined();
  });

  it("registers an OUTPUT request (negative amount) once the link holds any energy above the floor", () => {
    const link = stubLink("link1", 400);
    const storage = stubStorage(0);
    const request = registerLinkDrainRequest(link, storage);

    expect(request).toBeDefined();
    expect(request?.target).toBe(link);
    expect(request?.resource).toBe(RESOURCE_ENERGY);
    expect(request?.amount).toBe(-400); // requestOutput: "has to give", not "wants delivered"
    expect(request?.dAmountdt).toBe(-0);
    expect(request?.multiplier).toBe(1);
  });

  it("registers even a trivial amount — no fullness threshold on this leg (matches stewardBehavior.ts's LINK_DRAIN_FLOOR=0)", () => {
    const link = stubLink("link1", 1);
    const request = registerLinkDrainRequest(link, stubStorage(0));
    expect(request?.amount).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// registerControllerLinkTopUpRequest
// ---------------------------------------------------------------------------

describe("registerControllerLinkTopUpRequest", () => {
  it("returns undefined when the controller link is missing", () => {
    expect(registerControllerLinkTopUpRequest(undefined, stubStorage(100_000))).toBeUndefined();
  });

  it("returns undefined when storage is missing", () => {
    expect(registerControllerLinkTopUpRequest(stubLink("clink", 0), undefined)).toBeUndefined();
  });

  it("returns undefined when storage has nothing to give", () => {
    const cLink = stubLink("clink", 0);
    expect(registerControllerLinkTopUpRequest(cLink, stubStorage(0))).toBeUndefined();
  });

  it("returns undefined when the controller link is already at/above CONTROLLER_LINK_LOW_FRACTION", () => {
    const cLink = stubLink("clink", Math.ceil(LINK_CAPACITY * CONTROLLER_LINK_LOW_FRACTION));
    expect(registerControllerLinkTopUpRequest(cLink, stubStorage(100_000))).toBeUndefined();
  });

  it("registers an INPUT request (positive amount, wanted = free capacity) once running low, mirroring stewardBehavior.ts's controllerLinkNeedsTopUp gate", () => {
    const stored = Math.floor(LINK_CAPACITY * CONTROLLER_LINK_LOW_FRACTION) - 1;
    const cLink = stubLink("clink", stored);
    const storage = stubStorage(100_000);
    const request = registerControllerLinkTopUpRequest(cLink, storage);

    expect(request).toBeDefined();
    expect(request?.target).toBe(cLink);
    expect(request?.resource).toBe(RESOURCE_ENERGY);
    expect(request?.amount).toBe(LINK_CAPACITY - stored); // requestInput: "wants delivered"
    expect(request?.amount).toBeGreaterThan(0);
    expect(request?.dAmountdt).toBe(0);
  });

  it("returns undefined when the controller link is already full (no free capacity to want)", () => {
    const cLink = stubLink("clink", LINK_CAPACITY);
    expect(registerControllerLinkTopUpRequest(cLink, stubStorage(100_000))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// registerTerminalRebalanceRequest
// ---------------------------------------------------------------------------

describe("registerTerminalRebalanceRequest", () => {
  it("returns undefined when either storage or terminal is missing", () => {
    expect(registerTerminalRebalanceRequest(undefined, stubTerminal(0))).toBeUndefined();
    expect(registerTerminalRebalanceRequest(stubStorage(800_000), undefined)).toBeUndefined();
  });

  it("returns undefined when storage has no surplus (at/below STORAGE_SURPLUS_FRACTION)", () => {
    const storage = stubStorage(Math.floor(STORAGE_CAPACITY * STORAGE_SURPLUS_FRACTION));
    const terminal = stubTerminal(0);
    expect(registerTerminalRebalanceRequest(storage, terminal)).toBeUndefined();
  });

  it("returns undefined when the terminal is not low (at/above TERMINAL_LOW_FRACTION), even with a storage surplus", () => {
    const storage = stubStorage(900_000); // well above the 50% surplus line
    const terminal = stubTerminal(Math.ceil(TERMINAL_CAPACITY * TERMINAL_LOW_FRACTION));
    expect(registerTerminalRebalanceRequest(storage, terminal)).toBeUndefined();
  });

  it("registers an INPUT request once BOTH storage has a surplus AND the terminal is low, mirroring stewardBehavior.ts's combined gate", () => {
    const storage = stubStorage(800_000);
    const terminalStored = 10_000;
    const terminal = stubTerminal(terminalStored);
    const request = registerTerminalRebalanceRequest(storage, terminal);

    expect(request).toBeDefined();
    expect(request?.target).toBe(terminal);
    expect(request?.resource).toBe(RESOURCE_ENERGY);
    expect(request?.amount).toBe(TERMINAL_CAPACITY - terminalStored);
    expect(request?.amount).toBeGreaterThan(0);
  });

  it("requires BOTH conditions — a low terminal alone (no storage surplus) does not register", () => {
    const storage = stubStorage(400_000); // exactly at 40%, below the 50% surplus line
    const terminal = stubTerminal(0);
    expect(registerTerminalRebalanceRequest(storage, terminal)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// registerStewardRequests — the whole pool
// ---------------------------------------------------------------------------

describe("registerStewardRequests", () => {
  it("returns an empty pool when nothing in the triangle qualifies", () => {
    const link = stubLink("link1", 0);
    const cLink = stubLink("clink", LINK_CAPACITY);
    const storage = stubStorage(0);
    const terminal = stubTerminal(TERMINAL_CAPACITY);
    expect(registerStewardRequests(link, cLink, storage, terminal)).toEqual([]);
  });

  it("collects every qualifying leg into one pool — not just the first match (proves this replaces three independent checks, not a single if/else)", () => {
    const link = stubLink("link1", 400); // qualifies: drain
    const cLink = stubLink("clink", 50); // qualifies: top-up
    const storage = stubStorage(800_000); // surplus
    const terminal = stubTerminal(10_000); // low
    const requests = registerStewardRequests(link, cLink, storage, terminal);

    expect(requests).toHaveLength(3);
    expect(requests.map(r => r.target)).toEqual(expect.arrayContaining([link, cLink, terminal]));
  });

  it("omits a leg from the pool once its own condition stops qualifying, leaving the others intact", () => {
    const link = stubLink("link1", 0); // does NOT qualify
    const cLink = stubLink("clink", 50); // qualifies
    const storage = stubStorage(800_000);
    const terminal = stubTerminal(10_000); // qualifies
    const requests = registerStewardRequests(link, cLink, storage, terminal);

    expect(requests).toHaveLength(2);
    expect(requests.some(r => r.target === link)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Reuse proof: the built requests feed directly into request.ts's/route.ts's REAL functions — no
// reimplementation of scoring or buffer-detour logic anywhere in stewardRegister.ts.
// ---------------------------------------------------------------------------

describe("Steward's pool reuses request.ts's pickBestRequest (gh #46) directly", () => {
  it("ranks a high-rate terminal want above a low-rate link drain even though stewardBehavior.ts would have checked the link branch first", () => {
    // Both targets equidistant from the creep (distance 1) so amount alone decides the rate race —
    // proves ranking is real (scoreRequest's multiplier*amount/distance), not registration-order luck.
    const link = stubLink("link1", 1); // tiny drain: rate 1/1 = 1
    const cLink = stubLink("clink", LINK_CAPACITY); // full: no top-up request
    const storage = stubStorage(800_000);
    const terminal = stubTerminal(10_000); // big want: rate (300000-10000)/1 = 290000

    const requests = registerStewardRequests(link, cLink, storage, terminal);
    expect(requests).toHaveLength(2); // link drain + terminal rebalance

    const best = pickBestRequest(requests, RESOURCE_ENERGY, () => 1); // same distance for every candidate
    expect(best?.target).toBe(terminal);
  });

  it("ranks the near link drain above a far, only-slightly-bigger terminal want when distance dominates the rate", () => {
    const link = stubLink("link1", 100); // rate 100/1 = 100
    const cLink = stubLink("clink", LINK_CAPACITY);
    const storage = stubStorage(800_000);
    const terminal = stubTerminal(10_000); // wants 290000, but placed far away below

    const requests = registerStewardRequests(link, cLink, storage, terminal);
    const distanceTo = (target: { id: string }) => (target.id === "terminal1" ? 10_000 : 1); // rate 290000/10000 = 29
    const best = pickBestRequest(requests, RESOURCE_ENERGY, t => distanceTo(t as unknown as { id: string }));
    expect(best?.target).toBe(link);
  });
});

describe("Steward's delivery requests reuse route.ts's evaluateRoutes/pickBestRoute (gh #47) directly", () => {
  function asBuffer(storage: StructureStorage): Buffer {
    return storage as unknown as Buffer;
  }

  it("evaluates a via-storage detour for the controller-link top-up request, same shape a Transport delivery would get", () => {
    const cLink = stubLink("clink", 50, 30, 30);
    const storage = stubStorage(800_000, 5, 5);
    const request = registerControllerLinkTopUpRequest(cLink, storage);
    expect(request).toBeDefined();
    if (!request) return;

    const from = pos(0, 0);
    const distanceTo = (a: RoomPosition, b: RoomPosition): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    const routes = evaluateRoutes(request, from, [asBuffer(storage)], 0, 50, distanceTo);

    // Direct route delivers 0 (creep carries nothing); the via-storage route delivers something, since
    // it loads up at storage first — same mechanical reason gh #47's own route-detour test relies on.
    const direct = routes.find(r => !r.viaBuffer);
    const viaStorage = routes.find(r => r.viaBuffer === storage);
    expect(direct?.amount).toBe(0);
    expect(viaStorage).toBeDefined();
    expect(viaStorage!.amount).toBeGreaterThan(0);

    const picked = pickBestRoute(request, from, [asBuffer(storage)], 0, 50, distanceTo);
    expect(picked?.route.viaBuffer).toBe(storage);
  });

  it("picks the direct route when the creep already carries enough to satisfy the request outright", () => {
    const terminal = stubTerminal(10_000, 2, 0);
    const storage = stubStorage(800_000, 40, 40); // far away — a detour here would only lose distance
    const request = registerTerminalRebalanceRequest(storage, terminal);
    expect(request).toBeDefined();
    if (!request) return;

    const from = pos(1, 0); // adjacent to terminal
    const distanceTo = (a: RoomPosition, b: RoomPosition): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    // Carrying the full wanted amount already — direct delivers everything, a detour can't beat that.
    const carrying = request.amount;
    const picked = pickBestRoute(request, from, [asBuffer(storage)], carrying, carrying, distanceTo);
    expect(picked?.route.viaBuffer).toBeUndefined();
  });

  it("a link-drain (output) request never gets a buffer detour scored — evaluateRoutes only detours delivery requests", () => {
    const link = stubLink("link1", 400);
    const storage = stubStorage(0);
    const request = registerLinkDrainRequest(link, storage);
    expect(request).toBeDefined();
    if (!request) return;

    const distanceTo = (a: RoomPosition, b: RoomPosition): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    const routes = evaluateRoutes(request, pos(0, 0), [asBuffer(storage)], 0, 50, distanceTo);
    expect(routes).toHaveLength(1); // direct only, no via-buffer candidate for a negative-amount request
    expect(routes[0].viaBuffer).toBeUndefined();
  });
});
