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

import { afterAll, describe, expect, it } from "vitest";
import {
  CONTROLLER_LINK_LOW_FRACTION,
  LINK_DRAIN_FLOOR,
  registerControllerLinkTopUpRequest,
  registerLinkDrainRequest,
  registerMineralStorageWantRequest,
  registerMineralTerminalHaveRequest,
  registerStewardRequests,
  registerTerminalEnergyRebalanceRequest,
  RESOURCE_STORAGE_SURPLUS_MULTIPLIER,
  STORAGE_SURPLUS_FRACTION,
  TERMINAL_ENERGY_LOW,
  TERMINAL_ENERGY_TARGET
} from "../../../src/logistics/stewardRegister";
import { baseTargetFor, boostLineResources, setLiquidationModeOverrideForTest } from "../../../src/empire/boostTargets";
import { pickBestPair } from "../../../src/logistics/greedyMatch";
import { pickBestRequest } from "../../../src/logistics/request";
import { evaluateRoutes, pickBestRoute, type Buffer } from "../../../src/logistics/route";

// This whole file exercises Steward's NORMAL (non-liquidating) rebalance behavior against real
// BOOST_TARGETS numbers — force LIQUIDATION_MODE off regardless of its current hand-edited value in
// boostTargets.ts (see setLiquidationModeOverrideForTest's own doc). Set at module scope, not
// beforeEach/afterEach: several describe blocks below capture baseTargetFor(...)! into a module/describe-
// scoped const (e.g. GO_TARGET) eagerly during test COLLECTION, before any beforeEach hook would ever run —
// the override has to already be in place by then.
setLiquidationModeOverrideForTest(false);
afterAll(() => setLiquidationModeOverrideForTest(undefined));

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

  it("registers a matched pair (link OUTPUT, storage INPUT) once the link holds any energy above the floor", () => {
    // gh #59: registerLinkDrainRequest returns BOTH sides now (greedyMatch.ts's pickBestPair requires a
    // genuine opposite-signed counterpart to exist before pairing at all) — see its own doc for why a
    // shared, unconditional "storage always offers energy" pool entry was tried and reverted.
    const link = stubLink("link1", 400);
    const storage = stubStorage(0);
    const pair = registerLinkDrainRequest(link, storage);

    expect(pair).toBeDefined();
    expect(pair?.output.target).toBe(link);
    expect(pair?.output.resource).toBe(RESOURCE_ENERGY);
    expect(pair?.output.amount).toBe(-400); // requestOutput: "has to give", not "wants delivered"
    expect(pair?.output.dAmountdt).toBe(-0);
    expect(pair?.output.multiplier).toBe(1);
    expect(pair?.input.target).toBe(storage);
    expect(pair?.input.amount).toBe(400); // storage's counterpart mirrors the same amount
  });

  it("registers even a trivial amount — no fullness threshold on this leg (matches stewardBehavior.ts's LINK_DRAIN_FLOOR=0)", () => {
    const link = stubLink("link1", 1);
    const pair = registerLinkDrainRequest(link, stubStorage(0));
    expect(pair?.output.amount).toBe(-1);
    expect(pair?.input.amount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// registerControllerLinkTopUpRequest
// ---------------------------------------------------------------------------

describe("registerControllerLinkTopUpRequest", () => {
  it("returns undefined when the anchor link is missing", () => {
    expect(registerControllerLinkTopUpRequest(undefined, stubLink("clink", 0), stubStorage(100_000))).toBeUndefined();
  });

  it("returns undefined when the controller link is missing", () => {
    expect(registerControllerLinkTopUpRequest(stubLink("link", 0), undefined, stubStorage(100_000))).toBeUndefined();
  });

  it("returns undefined when storage is missing", () => {
    expect(registerControllerLinkTopUpRequest(stubLink("link", 0), stubLink("clink", 0), undefined)).toBeUndefined();
  });

  it("returns undefined when storage has nothing to give", () => {
    const link = stubLink("link", 0);
    const cLink = stubLink("clink", 0);
    expect(registerControllerLinkTopUpRequest(link, cLink, stubStorage(0))).toBeUndefined();
  });

  it("returns undefined when the controller link is already at/above CONTROLLER_LINK_LOW_FRACTION", () => {
    const link = stubLink("link", 0);
    const cLink = stubLink("clink", Math.ceil(LINK_CAPACITY * CONTROLLER_LINK_LOW_FRACTION));
    expect(registerControllerLinkTopUpRequest(link, cLink, stubStorage(100_000))).toBeUndefined();
  });

  // Regression test: this leg must target the ANCHOR link, never the controller link — the controller
  // link's own fullness is only the TRIGGER (mirrors stewardBehavior.ts's controllerLinkNeedsTopUp gate),
  // never somewhere Steward physically travels to. A prior version of this function built the request
  // against `controllerLink` directly, which sent a live Steward creep on a real multi-tile trip out to
  // the controller link every time it ran low — confirmed live on the pserver (creep visibly leaving its
  // anchor tile) before this test existed to catch it.
  it("registers a matched pair (link INPUT, storage OUTPUT) against the ANCHOR link (not the controller link) once the controller link runs low", () => {
    // gh #59: registerControllerLinkTopUpRequest returns BOTH sides now — see registerLinkDrainRequest's
    // own doc for why (a shared, unconditional storage energy request was tried and reverted).
    const stored = Math.floor(LINK_CAPACITY * CONTROLLER_LINK_LOW_FRACTION) - 1;
    const link = stubLink("link", 100, 25, 25); // anchor link: some energy already in it, has free capacity left
    const cLink = stubLink("clink", stored, 38, 8); // controller link, far from the anchor — must never be the target
    const storage = stubStorage(100_000);
    const pair = registerControllerLinkTopUpRequest(link, cLink, storage);

    expect(pair).toBeDefined();
    expect(pair?.input.target).toBe(link);
    expect(pair?.input.target).not.toBe(cLink);
    expect(pair?.input.resource).toBe(RESOURCE_ENERGY);
    expect(pair?.input.amount).toBe(LINK_CAPACITY - 100); // requestInput: the ANCHOR link's own free capacity
    expect(pair?.input.amount).toBeGreaterThan(0);
    expect(pair?.input.dAmountdt).toBe(0);
    expect(pair?.output.target).toBe(storage);
    expect(pair?.output.amount).toBe(-(LINK_CAPACITY - 100)); // storage's counterpart mirrors the same amount
  });

  it("returns undefined when the anchor link is already full (no free capacity to want), even though the controller link is low", () => {
    const link = stubLink("link", LINK_CAPACITY);
    const cLink = stubLink("clink", 0);
    expect(registerControllerLinkTopUpRequest(link, cLink, stubStorage(100_000))).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// registerTerminalEnergyRebalanceRequest
// ---------------------------------------------------------------------------

describe("registerTerminalEnergyRebalanceRequest", () => {
  it("returns undefined when either storage or terminal is missing", () => {
    expect(registerTerminalEnergyRebalanceRequest(undefined, stubTerminal(0))).toBeUndefined();
    expect(registerTerminalEnergyRebalanceRequest(stubStorage(800_000), undefined)).toBeUndefined();
  });

  it("returns undefined when storage has no surplus (at/below STORAGE_SURPLUS_FRACTION)", () => {
    const storage = stubStorage(Math.floor(STORAGE_CAPACITY * STORAGE_SURPLUS_FRACTION));
    const terminal = stubTerminal(0);
    expect(registerTerminalEnergyRebalanceRequest(storage, terminal)).toBeUndefined();
  });

  it("returns undefined when the terminal is not low (at/above the flat TERMINAL_ENERGY_LOW), even with a storage surplus", () => {
    const storage = stubStorage(900_000); // well above the 10% surplus line
    const terminal = stubTerminal(TERMINAL_ENERGY_LOW);
    expect(registerTerminalEnergyRebalanceRequest(storage, terminal)).toBeUndefined();
  });

  it("registers a matched PAIR once BOTH storage has a surplus AND the terminal is below TERMINAL_ENERGY_LOW, mirroring stewardBehavior.ts's combined gate", () => {
    // gh #59: registerTerminalEnergyRebalanceRequest returns BOTH sides now (greedyMatch.ts's pickBestPair
    // requires a genuine opposite-signed counterpart to exist before pairing at all) — the terminal's
    // input (want) and storage's own output (has, capped at the same amount), not a bare one-sided request.
    const storage = stubStorage(800_000);
    const terminalStored = 10_000;
    const terminal = stubTerminal(terminalStored);
    const pair = registerTerminalEnergyRebalanceRequest(storage, terminal);

    expect(pair).toBeDefined();
    expect(pair?.input.target).toBe(terminal);
    expect(pair?.input.resource).toBe(RESOURCE_ENERGY);
    // Capped at the flat TERMINAL_ENERGY_TARGET (50,000), NOT the terminal's full 300,000 free capacity —
    // gh #59's whole point in switching energy off a percent-of-capacity basis: Steward should top the
    // terminal up to a small usable floor, not dump all of storage's surplus into it.
    expect(pair?.input.amount).toBe(TERMINAL_ENERGY_TARGET - terminalStored);
    expect(pair?.input.amount).toBeGreaterThan(0);
    expect(pair?.output.target).toBe(storage);
    expect(pair?.output.amount).toBe(-(TERMINAL_ENERGY_TARGET - terminalStored)); // storage's output mirrors the same amount
  });

  it("caps the want at TERMINAL_ENERGY_TARGET even though far more free capacity exists in the terminal", () => {
    const storage = stubStorage(800_000);
    const terminal = stubTerminal(0); // 300,000 free capacity available, but only 50,000 should ever be asked for
    const pair = registerTerminalEnergyRebalanceRequest(storage, terminal);
    expect(pair?.input.amount).toBe(TERMINAL_ENERGY_TARGET);
  });

  it("requires BOTH conditions — a low terminal alone (no storage surplus) does not register", () => {
    const storage = stubStorage(Math.floor(STORAGE_CAPACITY * STORAGE_SURPLUS_FRACTION)); // exactly at the 10% surplus line, not above it
    const terminal = stubTerminal(0);
    expect(registerTerminalEnergyRebalanceRequest(storage, terminal)).toBeUndefined();
  });

  it("raises the wanted amount to empireReservedAmount so the terminal keeps replenishing toward a pending send", () => {
    const storage = stubStorage(800_000);
    const terminal = stubTerminal(10_000);
    const ordinary = registerTerminalEnergyRebalanceRequest(storage, terminal);
    const reserved = registerTerminalEnergyRebalanceRequest(storage, terminal, (ordinary?.input.amount ?? 0) + 20_000);

    expect(reserved?.input.amount).toBe((ordinary?.input.amount ?? 0) + 20_000);
  });
});

// ---------------------------------------------------------------------------
// registerMineralStorageWantRequest / registerMineralTerminalHaveRequest (gh #59 decision 7) — the
// non-energy mineral rebalance leg, split into two independent one-sided requests that land in the SAME
// pool rather than one paired function: storage's own want (target ownership lives here, storage alone)
// and the terminal's own have (a pure buffer, no standing allocation of its own — see each function's doc).
// ---------------------------------------------------------------------------

// registerMineralStorageWantRequest registers for EVERY boostLineResources() entry, not just the one a
// test cares about — an unspecified resource's stock defaults to its OWN target here (want-neutral, "at
// target, nothing wanted"), not to 0 (which would register a spurious want for all ~40 OTHER configured
// resources at once, exactly the bug this default avoids). Explicit `stored` overrides still win.
function neutralMineralStock(overrides: Partial<Record<ResourceConstant, number>>): Partial<Record<ResourceConstant, number>> {
  const neutral: Partial<Record<ResourceConstant, number>> = {};
  for (const r of boostLineResources()) neutral[r] = baseTargetFor(r) ?? 0;
  return { ...neutral, ...overrides };
}

function stubMultiStorage(stored: Partial<Record<ResourceConstant, number>>, x = 5, y = 5): StructureStorage {
  const full = neutralMineralStock(stored);
  return {
    id: "storage1" as Id<StructureStorage>,
    pos: pos(x, y),
    structureType: STRUCTURE_STORAGE,
    store: {
      getUsedCapacity: (r: ResourceConstant) => full[r] ?? 0,
      getCapacity: () => STORAGE_CAPACITY,
      getFreeCapacity: (r: ResourceConstant) => STORAGE_CAPACITY - (full[r] ?? 0)
    }
  } as unknown as StructureStorage;
}

function stubMultiTerminal(stored: Partial<Record<ResourceConstant, number>>, x = 20, y = 20): StructureTerminal {
  return {
    id: "terminal1" as Id<StructureTerminal>,
    pos: pos(x, y),
    structureType: STRUCTURE_TERMINAL,
    store: {
      getUsedCapacity: (r: ResourceConstant) => stored[r] ?? 0,
      getCapacity: () => TERMINAL_CAPACITY,
      getFreeCapacity: (r: ResourceConstant) => TERMINAL_CAPACITY - (stored[r] ?? 0)
    }
  } as unknown as StructureTerminal;
}

describe("registerMineralStorageWantRequest", () => {
  const GO_TARGET = baseTargetFor("GO")!; // flat 3000 per boostTargets.ts's current placeholder, sanity-checked below

  it("has a real configured target to test against", () => {
    expect(GO_TARGET).toBeGreaterThan(0);
  });

  it("returns undefined for a resource with no configured target at all", () => {
    // "power" is deliberately absent from boostTargets.ts's BOOST_TARGETS (every raw mineral + reaction
    // compound has an entry, but power is neither) — a genuine "no target configured" case.
    const storage = stubMultiStorage({ power: 0 });
    expect(registerMineralStorageWantRequest(storage, "power")).toBeUndefined();
  });

  it("returns undefined when storage is missing", () => {
    expect(registerMineralStorageWantRequest(undefined, "GO")).toBeUndefined();
  });

  it("registers an INPUT request for however much storage is short of its own target — unconditional on the terminal's state", () => {
    const storage = stubMultiStorage({ GO: 1000 });
    const request = registerMineralStorageWantRequest(storage, "GO");

    expect(request).toBeDefined();
    expect(request?.target).toBe(storage);
    expect(request?.resource).toBe("GO");
    expect(request?.amount).toBe(GO_TARGET - 1000);
    expect(request?.amount).toBeGreaterThan(0);
  });

  it("returns undefined once storage is at or above its own target", () => {
    const atTarget = stubMultiStorage({ GO: GO_TARGET });
    expect(registerMineralStorageWantRequest(atTarget, "GO")).toBeUndefined();
    const aboveTarget = stubMultiStorage({ GO: GO_TARGET * 2 });
    expect(registerMineralStorageWantRequest(aboveTarget, "GO")).toBeUndefined();
  });
});

describe("registerMineralTerminalHaveRequest", () => {
  const GO_TARGET = baseTargetFor("GO")!;

  it("returns undefined for a resource with no configured target at all", () => {
    const terminal = stubMultiTerminal({ power: 100 });
    expect(registerMineralTerminalHaveRequest(terminal, "power")).toBeUndefined();
  });

  it("returns undefined when the terminal is missing", () => {
    expect(registerMineralTerminalHaveRequest(undefined, "GO")).toBeUndefined();
  });

  it("returns undefined when the terminal holds none of the resource", () => {
    const terminal = stubMultiTerminal({ GO: 0 });
    expect(registerMineralTerminalHaveRequest(terminal, "GO")).toBeUndefined();
  });

  it("registers an OUTPUT request for the terminal's FULL stock, drained toward 0 — NOT toward the resource's target", () => {
    // Regression case for the bug found live: draining only down to `target` here, combined with
    // registerMineralStorageWantRequest also pulling storage up to that SAME target, meant the colony
    // settled with `target` sitting in EACH of storage and terminal at once (double the real target)
    // instead of `target` once, in storage, where it belongs. `target` is storage's number to hold; the
    // terminal has no standing allocation of its own.
    const terminal = stubMultiTerminal({ GO: 1000 }); // well below GO_TARGET (3000) — would have been blocked by the old ceiling-at-target logic
    const request = registerMineralTerminalHaveRequest(terminal, "GO");

    expect(request).toBeDefined();
    expect(request?.target).toBe(terminal);
    expect(request?.resource).toBe("GO");
    expect(request?.amount).toBe(-1000); // requestOutput: the terminal's ENTIRE stock, not stock-minus-target
  });

  it("drains the terminal's stock even when it's well above the resource's target", () => {
    const terminal = stubMultiTerminal({ GO: GO_TARGET * 3 });
    const request = registerMineralTerminalHaveRequest(terminal, "GO");
    expect(request?.amount).toBe(-(GO_TARGET * 3));
  });

  it("protects empireReservedAmount from the drain — a pending empire send isn't vacuumed back into storage", () => {
    const terminal = stubMultiTerminal({ GO: 4000 });
    const request = registerMineralTerminalHaveRequest(terminal, "GO", 3200);
    expect(request?.amount).toBe(-(4000 - 3200)); // only the UNreserved 800 is offered up
  });

  it("returns undefined once the reservation covers the entire stock", () => {
    const terminal = stubMultiTerminal({ GO: 1000 });
    expect(registerMineralTerminalHaveRequest(terminal, "GO", 1000)).toBeUndefined();
    expect(registerMineralTerminalHaveRequest(terminal, "GO", 5000)).toBeUndefined(); // reservation can exceed actual stock too
  });
});

describe("the mineral want/have pair together (storage above target / terminal 1,000 GO / target from boostTargets.ts)", () => {
  // The exact scenario that surfaced the original bug: storage already has genuine surplus above target
  // AND the terminal holds some below-target amount. Both requests should exist simultaneously so
  // pickBestRequest (not either registration function) decides what happens next — see
  // registerMineralTerminalHaveRequest's own doc for why draining stops mattering once storage itself
  // isn't the thing gating this pair (storage's want and the terminal's have are fully independent now).
  const GO_TARGET = baseTargetFor("GO")!;

  it("storage still wants topping up (it's below its own target) even though the terminal separately has stock to give", () => {
    const storage = stubMultiStorage({ GO: GO_TARGET + 1000 });
    expect(registerMineralStorageWantRequest(storage, "GO")).toBeUndefined(); // already above target — nothing wanted
  });

  it("the terminal's have request exists independently of storage's own surplus/deficit state", () => {
    const terminal = stubMultiTerminal({ GO: 1000 });
    const request = registerMineralTerminalHaveRequest(terminal, "GO");
    expect(request?.amount).toBe(-1000); // registers regardless of what storage looks like
    expect(GO_TARGET).toBeGreaterThan(1000); // sanity: this terminal stock is below target, would have been blocked pre-fix
  });
});

// ---------------------------------------------------------------------------
// registerStewardRequests — the whole pool
// ---------------------------------------------------------------------------

describe("registerStewardRequests", () => {
  it("returns an empty pool when nothing in the triangle qualifies", () => {
    // gh #59: each leg (link-drain, controller-topup, terminal-rebalance) now builds its OWN storage
    // counterpart directly, sized/gated to that specific leg — there's no longer a separate, unconditional
    // "storage always offers energy" pool entry independent of whether any leg actually needs it (see
    // registerLinkDrainRequest's own doc for why that shared-entry design was tried and reverted).
    const link = stubLink("link1", 0);
    const cLink = stubLink("clink", LINK_CAPACITY);
    const storage = stubStorage(0);
    const terminal = stubTerminal(TERMINAL_CAPACITY);
    expect(registerStewardRequests(link, cLink, storage, terminal)).toEqual([]);
  });

  it("collects every qualifying leg into one pool — not just the first match (proves this replaces three independent checks, not a single if/else)", () => {
    // Drain and top-up both target `link` (the anchor link) but are mutually exclusive in practice — a
    // link can't simultaneously hold enough to drain (LINK_DRAIN_FLOOR) and have free capacity to top up
    // without emptying first — so this seeds a link ABOVE the drain floor but not literally full, letting
    // both legs' independent conditions genuinely both qualify at once (drain: any energy > 0; top-up:
    // gated on the CONTROLLER link's fullness, not the anchor link's own).
    const link = stubLink("link1", 400); // qualifies: drain (has energy) AND has free capacity for top-up
    const cLink = stubLink("clink", 50); // qualifies: controller link running low, triggers top-up
    const storage = stubStorage(800_000); // surplus
    const terminal = stubTerminal(10_000); // low
    const requests = registerStewardRequests(link, cLink, storage, terminal);

    // Each of the three legs (link-drain, controller-topup, terminal-rebalance) is now a matched pair: 2
    // requests apiece (its own leg's target + storage's paired counterpart) — 6 total. The link is targeted
    // twice (drain's output, topup's input); storage three times (drain's input counterpart, topup's output
    // counterpart, rebalance's output counterpart); terminal once (rebalance's input).
    expect(requests).toHaveLength(6);
    const targets = requests.map(r => r.target);
    expect(targets.filter(t => t === link)).toHaveLength(2);
    expect(targets).toContain(terminal);
    expect(targets.filter(t => t === storage)).toHaveLength(3);
    expect(targets).not.toContain(cLink); // the controller link is only ever a trigger, never a target
  });

  it("also registers a mineral storage-want leg when storage is below a boost-line resource's target (gh #59 decision 7)", () => {
    const link = stubLink("link1", 0);
    const cLink = stubLink("clink", LINK_CAPACITY);
    const storage = stubMultiStorage({ energy: 0, GO: 1000 }); // below GO's target
    const terminal = stubMultiTerminal({ energy: TERMINAL_CAPACITY, GO: 0 }); // energy full (no energy leg); GO empty (no have leg)
    const requests = registerStewardRequests(link, cLink, storage, terminal);

    // Scoped to GO specifically — the pool also carries an experimental terminal-overflow-want leg per
    // resource now (registerMineralStorageOverflowWantRequest), so an exact total pool length is no longer
    // a stable assertion here.
    const goStorageWant = requests.find(r => r.resource === "GO" && r.target === storage);
    expect(goStorageWant).toBeDefined();
    expect(goStorageWant?.amount).toBeGreaterThan(0); // storage WANTS delivered
  });

  it("also registers a mineral terminal-have leg when the terminal holds any of a boost-line resource", () => {
    const link = stubLink("link1", 0);
    const cLink = stubLink("clink", LINK_CAPACITY);
    const GO_TARGET = baseTargetFor("GO")!;
    const storage = stubMultiStorage({ energy: 0, GO: GO_TARGET }); // at target — no want
    const terminal = stubMultiTerminal({ energy: TERMINAL_CAPACITY, GO: 500 }); // energy full (no energy leg); GO to give
    const requests = registerStewardRequests(link, cLink, storage, terminal);

    const goTerminalHave = requests.find(r => r.resource === "GO" && r.target === terminal && r.amount < 0);
    expect(goTerminalHave).toBeDefined();
    expect(goTerminalHave?.amount).toBe(-500); // terminal HAS to give, its full stock
  });

  it("protects a mineral empireReservations amount from the terminal-have drain, same colony-wide pool", () => {
    const link = stubLink("link1", 0);
    const cLink = stubLink("clink", LINK_CAPACITY);
    const GO_TARGET = baseTargetFor("GO")!;
    const storage = stubMultiStorage({ energy: 0, GO: GO_TARGET }); // at target — isolates the terminal-have leg (no storage-want)
    const terminal = stubMultiTerminal({ energy: TERMINAL_CAPACITY, GO: 4000 });
    const ordinary = registerStewardRequests(link, cLink, storage, terminal);
    const reserved = registerStewardRequests(link, cLink, storage, terminal, { GO: 3200 });

    // Scoped to the specific terminal-have leg (output, target=terminal) rather than every GO request —
    // the experimental storage-overflow leg also registers GO entries now (storage is exactly at target,
    // not above it, so it shouldn't fire here, but scoping keeps this test robust either way).
    expect(ordinary.find(r => r.resource === "GO" && r.target === terminal && r.amount < 0)?.amount).toBe(-4000); // nothing protected: full stock offered
    expect(reserved.find(r => r.resource === "GO" && r.target === terminal && r.amount < 0)?.amount).toBe(-800); // 3200 protected, only the rest offered
  });

  it("omits a leg from the pool once its own condition stops qualifying, leaving the others intact", () => {
    const link = stubLink("link1", LINK_DRAIN_FLOOR); // at the floor: drain doesn't qualify (empty, so
    // nothing to give) — the ONLY value that can disqualify drain, since any energy above the floor is
    // worth draining
    const cLink = stubLink("clink", LINK_CAPACITY); // full: controller link doesn't need topping up, so
    // the anchor link's own emptiness (which would otherwise trigger top-up too) never gets exercised
    const storage = stubStorage(800_000);
    const terminal = stubTerminal(10_000); // qualifies
    const requests = registerStewardRequests(link, cLink, storage, terminal);

    // Only the terminal rebalance pair (terminal input + storage output) — drain and top-up both fail
    // their own gates (link empty, controller link full), so neither leg (nor its storage counterpart)
    // appears at all.
    expect(requests).toHaveLength(2);
    const targets = requests.map(r => r.target);
    expect(targets).toContain(terminal);
    expect(targets.filter(t => t === storage)).toHaveLength(1);
    expect(targets).not.toContain(link); // drain didn't qualify, and nothing else targets the link here
  });
});

// ---------------------------------------------------------------------------
// Reuse proof: the built requests feed directly into request.ts's/greedyMatch.ts's REAL functions — no
// reimplementation of scoring or pairing logic anywhere in stewardRegister.ts. planStewardTask
// (stewardTaskRunner.ts) drives the live pool through greedyMatch.ts's pickBestPair, not pickBestRequest
// directly — but pickBestRequest remains real, reusable infra any pool of LogisticsRequests can be scored
// with (e.g. a single-direction lookup), so this proves stewardRegister.ts's output is genuinely that
// generic shape, not something bespoke.
// ---------------------------------------------------------------------------

describe("Steward's pool is plain LogisticsRequests, reusable with request.ts's pickBestRequest (gh #46)", () => {
  it("ranks a high-rate terminal want above a low-rate link drain by amount/distance, same as any other pool", () => {
    // Both targets equidistant from the creep (distance 1) so amount alone decides the rate race —
    // proves ranking is real (scoreRequest's multiplier*amount/distance), not registration-order luck.
    // Storage's own implicit requests are isolated out here by scoping pickBestRequest to only the
    // OUTPUT-direction candidates that aren't storage itself (storage's 800,000 output would otherwise
    // trivially dominate any energy amount a link or terminal could ever register).
    const link = stubLink("link1", 1); // tiny drain: rate 1/1 = 1
    const cLink = stubLink("clink", LINK_CAPACITY); // full: no top-up request
    const storage = stubStorage(800_000);
    const terminal = stubTerminal(10_000); // big want: rate (TERMINAL_ENERGY_TARGET-10000)/1 = 40000

    const requests = registerStewardRequests(link, cLink, storage, terminal).filter(r => r.target !== storage);
    expect(requests).toHaveLength(2); // link drain + terminal rebalance

    const best = pickBestRequest(requests, RESOURCE_ENERGY, () => 1); // same distance for every candidate
    expect(best?.target).toBe(terminal);
  });

  it("ranks the near link drain above a far, only-slightly-bigger terminal want when distance dominates the rate", () => {
    const link = stubLink("link1", 100); // rate 100/1 = 100
    const cLink = stubLink("clink", LINK_CAPACITY);
    const storage = stubStorage(800_000);
    const terminal = stubTerminal(10_000); // wants TERMINAL_ENERGY_TARGET-10000=40000, but placed far away below

    const requests = registerStewardRequests(link, cLink, storage, terminal).filter(r => r.target !== storage);
    const distanceTo = (target: { id: string }) => (target.id === "terminal1" ? 10_000 : 1); // rate 40000/10000 = 4
    const best = pickBestRequest(requests, RESOURCE_ENERGY, t => distanceTo(t as unknown as { id: string }));
    expect(best?.target).toBe(link);
  });
});

describe("Steward's delivery requests reuse route.ts's evaluateRoutes/pickBestRoute (gh #47) directly", () => {
  function asBuffer(storage: StructureStorage): Buffer {
    return storage as unknown as Buffer;
  }

  it("evaluates a via-storage detour for the controller-link top-up request (targeting the ANCHOR link), same shape a Transport delivery would get", () => {
    const link = stubLink("link", 50, 25, 25); // the anchor link — this leg's real target, not the controller link
    const cLink = stubLink("clink", 50, 38, 8); // far off at the controller — only a trigger, never a target
    const storage = stubStorage(800_000, 5, 5);
    const pair = registerControllerLinkTopUpRequest(link, cLink, storage);
    expect(pair).toBeDefined();
    if (!pair) return;
    const request = pair.input;
    expect(request.target).toBe(link);

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
    const pair = registerTerminalEnergyRebalanceRequest(storage, terminal);
    expect(pair).toBeDefined();
    if (!pair) return;
    const request = pair.input;

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
    const pair = registerLinkDrainRequest(link, storage);
    expect(pair).toBeDefined();
    if (!pair) return;
    const request = pair.output;

    const distanceTo = (a: RoomPosition, b: RoomPosition): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    const routes = evaluateRoutes(request, pos(0, 0), [asBuffer(storage)], 0, 50, distanceTo);
    expect(routes).toHaveLength(1); // direct only, no via-buffer candidate for a negative-amount request
    expect(routes[0].viaBuffer).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// LIQUIDATION_MODE: registerMineralTerminalHaveRequest must stay silent, or it starves the pool's only
// real liquidating pair — confirmed live: storage and terminal settled into a rough "balance" per resource
// instead of storage ever draining to zero, across every colony with a terminal.
// ---------------------------------------------------------------------------
describe("registerMineralTerminalHaveRequest under LIQUIDATION_MODE (target collapses to 0)", () => {
  afterAll(() => setLiquidationModeOverrideForTest(false)); // restore this file's own module-scope override

  it("returns undefined once the resource's target collapses to 0, even with real terminal stock", () => {
    setLiquidationModeOverrideForTest(true);
    const terminal = stubMultiTerminal({ GO: 1000 });
    expect(registerMineralTerminalHaveRequest(terminal, "GO")).toBeUndefined();
  });

  it(
    "end-to-end via pickBestPair: storage's surplus output wins and pairs with the terminal's overflow want, " +
      "even when the terminal happens to hold MORE of the resource than storage — the exact live scenario " +
      "where terminalHave (if left live) would have won the 'best output' race by magnitude, found no partner " +
      "(its only real one, storageWant, is also suppressed at target 0), and silently starved storageSurplus",
    () => {
      setLiquidationModeOverrideForTest(true);
      // Terminal holds MORE than storage — before this fix, terminalHave's output (-2200) would outscore
      // storageSurplus's output (-1000) by raw magnitude and win pickBestPair's "best output" slot, then
      // fail to find a matching input (registerMineralStorageOverflowWantRequest also targets the terminal,
      // excluded by the same-target self-pairing guard) — net result: nothing moves this pass.
      const storage = stubMultiStorage({ GO: 1000 });
      const terminal = stubMultiTerminal({ GO: 2200 });

      const pool = registerStewardRequests(undefined, undefined, storage, terminal);
      // terminalHave must not even be in the pool now.
      expect(pool.some(r => r.target === terminal && r.amount < 0)).toBe(false);

      const distanceTo = (): number => 1; // distance-neutral: only the pairing mechanics are under test
      const pair = pickBestPair(pool, distanceTo);
      expect(pair).toBeDefined();
      expect(pair?.resource).toBe("GO");
      expect(pair?.output.target).toBe(storage); // storageSurplus wins — the only real liquidating direction
      expect(pair?.input.target).toBe(terminal); // pairs with the terminal's overflow want
      expect(pair?.output.amount).toBe(-1000); // storage's FULL stock (threshold collapses to 0 too)
    }
  );
});
