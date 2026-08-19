// Steward's self-registration (gh #51, ADR 0008's "Steward gets its own rate-ranked pool, same shape as
// Transport's" decision): the anchor link/storage/terminal triangle stewardBehavior.ts manages today via
// hand-tuned fixed thresholds (LINK_DRAIN_FLOOR, STORAGE_SURPLUS_FRACTION, TERMINAL_LOW_FRACTION,
// CONTROLLER_LINK_LOW_FRACTION — see that file), expressed instead as real signed LogisticsRequests so the
// three legs compete under request.ts's scoreRequest/pickBestRequest and route.ts's buffer-detour
// evaluation, same as Transport's pool will (#52+), rather than three independent if-checks run in a fixed
// order. This module builds the requests only — selection reuses pickBestRequest/pickBestRoute directly
// (see behaviors/stewardTaskRunner.ts), no reimplementation of either.
//
// Self-registration reads live Game.* state directly, same as register.ts/supplyRegister.ts (ADR 0008's
// scoped departure from ColonySnapshot for src/logistics/ only). links.ts's own hardwired, unconditional,
// instant link-firing legs (source->anchor, anchor->controller) are untouched by this module — there is no
// creep trip on those legs for a rate to apply to (see links.ts's header).
//
// Threshold values are carried over VERBATIM from stewardBehavior.ts's hand-tuned constants (same
// reasoning documented there) — this ticket replaces the shape of the decision (three independent checks
// -> three ranked requests), not the numbers themselves. A future tuning pass can touch these without
// touching the request/route reuse this ticket proves.
//
// Post-cutover fix: registerControllerLinkTopUpRequest originally built its request against the
// CONTROLLER link directly, sending a live Steward creep on a real multi-tile trip out to the controller
// (confirmed live on the pserver) — stewardBehavior.ts only ever used the controller link's fullness as a
// TRIGGER, never as somewhere it travelled to; the actual delivery target was always the anchor link (see
// registerControllerLinkTopUpRequest's own doc). Fixed to take both links and target the anchor one.

import { requestInput, requestOutput, type LogisticsRequest } from "./request";

// A link should never sit full — it needs headroom for the next source delivery — so drain it toward
// storage the instant it holds anything at all, no fractional floor needed on this leg. Mirrors
// stewardBehavior.ts's LINK_DRAIN_FLOOR exactly.
export const LINK_DRAIN_FLOOR = 0;
// Storage is treated as "has plenty to spare" only once comfortably above the point Logistics itself would
// start drawing it down to cover a spawn deficit — 50% keeps Steward from fighting that drain. Mirrors
// stewardBehavior.ts's STORAGE_SURPLUS_FRACTION exactly.
export const STORAGE_SURPLUS_FRACTION = 0.5;
// Only worth topping the terminal up once it's run fairly low. Mirrors stewardBehavior.ts's
// TERMINAL_LOW_FRACTION exactly.
export const TERMINAL_LOW_FRACTION = 0.5;
// Below this, the controller link is "running low enough to bother." Mirrors stewardBehavior.ts's
// CONTROLLER_LINK_LOW_FRACTION exactly.
export const CONTROLLER_LINK_LOW_FRACTION = 0.5;

/**
 * The anchor link's energy, if it holds enough to be worth draining (LINK_DRAIN_FLOOR) — an output
 * request (the link HAS energy to give up). Steward's pool pairs an output request like this with a fixed,
 * known delivery target (storage — the only place a drained link's energy has ever gone, see
 * stewardBehavior.ts's own drain leg) rather than a separate requestInput on storage: storage's own
 * capacity is never the constraint on whether this leg is worth doing, the link's fullness is.
 */
export function registerLinkDrainRequest(link: StructureLink | undefined, storage: StructureStorage | undefined): LogisticsRequest | undefined {
  if (!link || !storage) return undefined;
  const stored = link.store.getUsedCapacity(RESOURCE_ENERGY);
  if (stored <= LINK_DRAIN_FLOOR) return undefined;
  return requestOutput(link, RESOURCE_ENERGY, stored);
}

/**
 * The ANCHOR link's remaining want, triggered once the CONTROLLER link has run low
 * (CONTROLLER_LINK_LOW_FRACTION) AND storage actually has energy to give — an input request (the anchor
 * link WANTS energy delivered). Mirrors stewardBehavior.ts's controllerLinkNeedsTopUp gate exactly,
 * including its target: the controller link's own fullness is only the TRIGGER, never the delivery
 * target — "the steward itself never goes near the controller link, which sits out of its reach at the
 * controller, not the anchor" (stewardBehavior.ts's own comment on this leg). Before RCL7 (no source
 * links yet) nothing else ever puts energy into the link chain at all; links.ts's own anchor->controller
 * leg carries it the rest of the way once it lands in the anchor link (see that file's header) — a real
 * bug shipped here once (gh #51/#54): registering this request against `controllerLink` directly sent a
 * creep on a real multi-tile trip to the controller link, something Steward must never do.
 */
export function registerControllerLinkTopUpRequest(
  link: StructureLink | undefined,
  controllerLink: StructureLink | undefined,
  storage: StructureStorage | undefined
): LogisticsRequest | undefined {
  if (!link || !controllerLink || !storage) return undefined;
  if (storage.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) return undefined;
  const capacity = controllerLink.store.getCapacity(RESOURCE_ENERGY);
  const used = controllerLink.store.getUsedCapacity(RESOURCE_ENERGY);
  if (used >= capacity * CONTROLLER_LINK_LOW_FRACTION) return undefined;
  const wanted = link.store.getFreeCapacity(RESOURCE_ENERGY);
  if (wanted <= 0) return undefined;
  return requestInput(link, RESOURCE_ENERGY, wanted);
}

/**
 * The terminal's remaining want, once storage has a genuine surplus (STORAGE_SURPLUS_FRACTION) AND the
 * terminal itself is genuinely low (TERMINAL_LOW_FRACTION) — an input request (the terminal WANTS energy
 * delivered). Mirrors stewardBehavior.ts's storage->terminal rebalance gate exactly, including requiring
 * BOTH conditions so this can't oscillate against Logistics' own storage-as-source/sink switch.
 */
export function registerTerminalRebalanceRequest(
  storage: StructureStorage | undefined,
  terminal: StructureTerminal | undefined
): LogisticsRequest | undefined {
  if (!storage || !terminal) return undefined;
  const storageSurplus = storage.store.getUsedCapacity(RESOURCE_ENERGY) > storage.store.getCapacity(RESOURCE_ENERGY) * STORAGE_SURPLUS_FRACTION;
  if (!storageSurplus) return undefined;
  const terminalUsed = terminal.store.getUsedCapacity(RESOURCE_ENERGY);
  const terminalCapacity = terminal.store.getCapacity(RESOURCE_ENERGY);
  if (terminalUsed >= terminalCapacity * TERMINAL_LOW_FRACTION) return undefined;
  const wanted = terminal.store.getFreeCapacity(RESOURCE_ENERGY);
  if (wanted <= 0) return undefined;
  return requestInput(terminal, RESOURCE_ENERGY, wanted);
}

/**
 * Every live request in Steward's pool right now: at most one each of link-drain, controller-link top-up,
 * and storage-to-terminal rebalance — the whole triangle stewardBehavior.ts manages by hand-tuned
 * thresholds today, replaced here by real signed requests (see this module's header). `storage` is
 * required for every leg (mirrors stewardBehavior.ts, where every branch already guards on `storage`
 * existing) — a colony with no storage yet has nothing for Steward's pool to rank.
 */
export function registerStewardRequests(
  link: StructureLink | undefined,
  controllerLink: StructureLink | undefined,
  storage: StructureStorage | undefined,
  terminal: StructureTerminal | undefined
): LogisticsRequest[] {
  const out: LogisticsRequest[] = [];
  const drain = registerLinkDrainRequest(link, storage);
  if (drain) out.push(drain);
  const topUp = registerControllerLinkTopUpRequest(link, controllerLink, storage);
  if (topUp) out.push(topUp);
  const rebalance = registerTerminalRebalanceRequest(storage, terminal);
  if (rebalance) out.push(rebalance);
  return out;
}
