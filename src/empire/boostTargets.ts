// Manually-edited empire resource stockpile targets (gh #59's config seam — see
// docs/empire-logistics-plan.md decision 3/"Target config file" and boosting-reactions-plan.md's M2,
// which this supersedes). No assignment algorithm decides who reacts what; empire/logistics.ts's matcher
// just moves surplus toward whatever colony is short of a resource with a nonzero target here. Energy is
// NOT listed here — its terminal floor is a flat, colony-local Steward constant
// (logistics/stewardRegister.ts's TERMINAL_ENERGY_TARGET), independent of this empire-owned system, since
// a terminal needs energy on hand to pay a send's fee regardless of what any resource target below says.
//
// Every raw mineral (H, O, U, L, K, Z, G, X — G is mined directly, not just produced) and every reaction
// compound (RESOURCES_ALL filtered to REACTIONS' keys/values, verified against
// node_modules/@screeps/common/lib/constants.js, not recalled) gets a target below — still a deliberate
// placeholder split, not a tuned number: nothing downstream (boosting/reactions) consumes stock yet, so
// there's no real demand signal to size these against. Retune per-resource once M5/M7 exist and actual
// consumption is observable. Omit an entry entirely to spend no storage/terminal budget or matching effort
// on it (decision 3's "leave unused boost lines with no target at all") — not used today, every resource
// below is intentionally included so raw mineral stock (already produced by mineralMiner) isn't left
// unmanaged by Steward/empire logistics while reactions remain unbuilt.
//
// MOVE (ZO/ZHO2/XZHO2) and CARRY (KH/KH2O/XKH2O) boost compounds are targeted at 0 — see BOOSTS.move/
// BOOSTS.carry in node_modules/@screeps/common/lib/constants.js — since those boost lines aren't wanted
// in the empire stockpile at all right now.
const BASE_MINERAL_TARGET = 3000;
const COMPOUND_TARGET = 6000;
const UNWANTED_BOOST_TARGET = 0;

const RAW_MINERALS: ResourceConstant[] = ["H", "O", "U", "L", "K", "Z", "G", "X"];

// T1/T2/T3 reaction compounds across every boost line, RESOURCES_ALL order — see this file's header for
// how this list was derived (REACTIONS' keys + values, not hand-typed from memory).
const REACTION_COMPOUNDS: ResourceConstant[] = [
  "OH",
  "ZK",
  "UL",
  "GH",
  "KH",
  "LH",
  "UH",
  "ZH",
  "GO",
  "LO",
  "ZO",
  "KO",
  "UO",
  "GH2O",
  "LH2O",
  "KH2O",
  "ZH2O",
  "UH2O",
  "GHO2",
  "LHO2",
  "KHO2",
  "ZHO2",
  "UHO2",
  "XGH2O",
  "XLH2O",
  "XKH2O",
  "XZH2O",
  "XUH2O",
  "XGHO2",
  "XLHO2",
  "XKHO2",
  "XZHO2",
  "XUHO2"
];

// MOVE and CARRY boost lines (all three tiers each) are zeroed out below regardless of the compound target.
const UNWANTED_BOOST_COMPOUNDS: ResourceConstant[] = ["ZO", "ZHO2", "XZHO2", "KH", "KH2O", "XKH2O"];

export const BOOST_TARGETS: Partial<Record<ResourceConstant, number>> = Object.fromEntries([
  ...RAW_MINERALS.map(resource => [resource, BASE_MINERAL_TARGET]),
  ...REACTION_COMPOUNDS.map(resource => [resource, COMPOUND_TARGET]),
  ...UNWANTED_BOOST_COMPOUNDS.map(resource => [resource, UNWANTED_BOOST_TARGET])
]);

// Build-time override (mirrors __PROFILER_ENABLED__/__SERVER__ in rollup.config.mjs, substituted the same
// way — see rollup.config.mjs's replace() call and each vitest.*.config.ts's define block): lets the
// integration test harness build a private bundle with liquidation forced off, since LIQUIDATION_MODE's
// real effect (storage/terminal targets collapsing to 0) runs inside the bundled bot's own sandboxed
// isolate, completely out of reach of setLiquidationModeOverrideForTest's in-process module variable
// below — a test asserting boost compounds stay stocked and get hauled to a lab needs the SOURCE default
// actually replaced at build time, not merely overridden from the test process.
declare const __LIQUIDATION_MODE__: boolean;

// Liquidation switch: flip to true and redeploy to empty out the empire's ENTIRE boost-line stockpile —
// baseTargetFor collapses every configured resource's target to 0 (still `undefined` for anything not in
// BOOST_TARGETS at all — a target of 0 and "not tracked" are different states, see baseTargetFor's own
// doc). This is the single source of truth for the flag: Steward (logistics/stewardRegister.ts) and the
// empire matcher (empire/logistics.ts's runEmpireLogisticsPass) both call baseTargetFor/BOOST_TARGETS and
// so both see the zeroed targets automatically, with no separate wiring in either module. Concretely, with
// every target at 0: registerMineralStorageWantRequest never fires (storage stops pulling resource in),
// registerMineralStorageSurplusRequest's threshold becomes 0 so a colony's ENTIRE storage stock reads as
// surplus and gets pushed to the terminal, and runEmpireLogisticsPass's computeEmpireRequests reads every
// colony's full stock as surplus with no deficit side to pair against — so colony-to-colony redistribution
// becomes a structural no-op and the whole stockpile flows through to marketFallback's leftover, ready for
// its own looser liquidation sell floor (see marketFallback.ts's own LIQUIDATION_MODE-gated logic) to
// actually clear it. Same manual, hand-edited (not runtime Memory) convention as marketFallback.ts's
// BUYING_ACTIVATED, for the same reason: nothing should be able to silently start liquidating the
// stockpile on its own.
export const LIQUIDATION_MODE = __LIQUIDATION_MODE__;

// Test-only override for LIQUIDATION_MODE, since the constant above is intentionally not a function
// parameter (baseTargetFor/BOOST_TARGETS are called unparameterized throughout the codebase — Steward and
// runEmpireLogisticsPass alike just want "today's real target", not a value threaded through every call
// site). Lets tests exercise normal (non-liquidating) target behavior regardless of LIQUIDATION_MODE's
// current hand-edited value above, same need marketFallback.ts's own `liquidationMode` parameter serves for
// its exported functions. Must be reset (setLiquidationModeOverrideForTest(undefined)) after use — afterEach
// in a test file, not left dangling for other test files to trip over.
let liquidationModeOverride: boolean | undefined;
export function setLiquidationModeOverrideForTest(value: boolean | undefined): void {
  liquidationModeOverride = value;
}

/** The empire-assigned base target for `resource`, or undefined if it isn't a stockpiled boost line.
 * Collapses to 0 for every tracked resource while LIQUIDATION_MODE is on — see its own doc. */
export function baseTargetFor(resource: ResourceConstant): number | undefined {
  const target = BOOST_TARGETS[resource];
  if (target === undefined) return undefined;
  return (liquidationModeOverride ?? LIQUIDATION_MODE) ? 0 : target;
}

/** Every resource with a configured target — the set both empireLogistics's matcher and Steward's
 * terminal-rebalance registration iterate over. */
export function boostLineResources(): ResourceConstant[] {
  return Object.keys(BOOST_TARGETS) as ResourceConstant[];
}
