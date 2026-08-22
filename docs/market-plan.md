# Market capability plan

## Status: design only (2026-08-22)
Zero code written. This file is the agreed design after a grilling session grounded in
`docs/screeps-market-research.md`-style research (how Overmind, The International, and TooAngel handle
market/terminal trading — see the published research artifact from this session) and this codebase's own
`src/empire/market.ts`, `src/empire/logistics.ts`, and `docs/boosting-reactions-plan.md`. This doc is the
"Market buying" future extension `boosting-reactions-plan.md` explicitly deferred — see that file's own
"Future extensions" section, which should be updated to point here once this lands.

## Handoff orientation (read this first if picking this up cold)
- Repo: `c:\Users\Kenda\Documents\GitHub\screeps-AI`, branch `dev`.
- Read order: this file top to bottom, then `src/empire/market.ts` (existing read-only price
  intelligence this design does NOT touch — `scanMarketNow`, `manufacturingCost` stay exactly as they
  are), `src/empire/logistics.ts` (the empire-wide transfer matcher this design plugs into —
  `matchEmpireRequests`' `leftover` return value and the already-stubbed `marketFallback()` function are
  the literal seam), `src/empire/boostTargets.ts` (`BOOST_TARGETS`, the resource set and per-resource
  target quantities this design's credit reserve and MVP scope both key off), `src/intents/types.ts` /
  `src/intents/execute.ts` (the `marketDeal`/`marketOrder` intent kinds already declared in the type union
  with **no dispatch case in `execute.ts`'s switch** — confirmed by grep before this doc was written;
  this design must both correct that union and add the dispatch).
- **Prerequisite, not part of this design's own scope**: `empire/logistics.ts`'s `runEmpireLogisticsPass`
  is not currently registered in `kernel/tick.ts`'s `SYSTEMS` array (confirmed by grep — no
  `empireLogistics` entry exists there today, only `market` and other tier-3 entries are wired). This
  design's seam (§2 below) assumes that wiring exists / lands first; it is not this doc's job to add it,
  but a fresh agent picking this up should confirm it's live before building the seam, or build both in
  the same session if it's still missing.
- No memory entries exist yet for this effort. Once M1 (below) lands, a memory entry should record it,
  same pattern as `[[Remote mining progress]]`.

## The decisions (and why)

### 1. Scope: boost-line resources only (MVP)
`BOOST_TARGETS` (raw minerals + every T1/T2/T3 reaction compound, 41 resources today) is the only
resource set this design trades. Energy, power, and pixels were all considered (the research doc shows
all three appearing in at least one of Overmind/The International/TooAngel) and explicitly **deferred**,
not built:
- **Energy** — Steward already owns energy's terminal floor locally
  (`logistics/stewardRegister.ts`'s `TERMINAL_ENERGY_TARGET`), independent of the empire-owned
  `BOOST_TARGETS` system (see `boostTargets.ts`'s own header). Energy-buying is a different problem (no
  empire deficit signal to trigger off) that would drag in scope this design doesn't need.
- **Power** — no colony-side demand signal exists yet (power creeps/power spawns are unbuilt).
- **Pixels** — a wallet-scale resource with no colony destination; a genuinely separate policy (see
  The International's `advancedSellPixels()`) that would dilute this design's single throughline:
  "leftover empire-internal deficits get resolved on the market."

Rationale for scoping to `BOOST_TARGETS` specifically (rather than "everything tradeable" or "T3 only"):
`empire/logistics.ts`'s `matchEmpireRequests` already only ever operates on `BOOST_TARGETS`' resource set
(`computeEmpireRequests`' `targets` parameter is always called with `BOOST_TARGETS` at the one real call
site, `runEmpireLogisticsPass`) — so `leftover`, this design's actual input, can never contain anything
outside that set anyway. Building against a wider resource set than `leftover` can ever produce would be
dead code.

### 2. The seam: one more phase of the existing empire-logistics pass, not a separate cadence
`matchEmpireRequests` already returns `{ matches, leftover }`; `runEmpireLogisticsPass` currently only
consumes `matches` and calls the stubbed, no-op `marketFallback(leftover)`. This design fills that stub
in and calls it from inside `runEmpireLogisticsPass`, appending its returned intents to the same
`Intent[]` the matches already produce — same `EMPIRE_LOGISTICS_INTERVAL` cadence (`TERMINAL_COOLDOWN +
1`, ~11 ticks), same tier-3 SYSTEMS entry.

Two options were considered:
- **A separate tier-3 SYSTEMS entry, its own interval** — rejected: decision 11 in `empire/logistics.ts`
  is explicit that `EmpireRequest`/matches are recomputed fresh every pass and never persisted. A second,
  differently-timed entry would either have to violate that (persist `leftover` somewhere to read later)
  or redundantly recompute `computeEmpireRequests` + `matchEmpireRequests` itself just to get the same
  `leftover` a beat later, for no benefit.
- **Same pass, same cadence (chosen)** — `leftover` is exactly what it says: the tail end of one coherent
  decision, not a second one. `marketFallback` is a pure continuation of the same match pass.

**Important distinction from the market *scan* (decision 4 below): the scan and the fallback-decision are
NOT the same cadence.** The scan writes a cache; the fallback logic reads that cache. Only the
*decision* logic (buy/sell/reprice/prune) runs on `EMPIRE_LOGISTICS_INTERVAL` — the expensive
`getAllOrders()` call itself runs on its own, coarser interval (decision 4).

### 3. Credit reserve: derived from BOOST_TARGETS x live sell price, not a hardcoded floor
Overmind's `TraderJoe` uses a flat, hand-tuned `reserveCredits = 10000`. This design instead computes the
reserve as: **the credit cost to buy a full `BOOST_TARGETS` quantity (3,000 today, per resource) of every
boost-line resource, at today's market price** — i.e. "how much would it cost, right now, to buy the
entire standing stockpile target from scratch."

```
creditReserve = sum(
  BOOST_TARGETS[resource] * (MarketStats.orders[resource]?.sellMin ?? MarketStats.prices[resource]?.avgPrice ?? 0)
) for every resource in BOOST_TARGETS

spendable = Game.market.credits - creditReserve
```

- **Price feed: `sellMin` (live order-book), not `avgPrice` (7-day rolling history).** The reserve
  answers "could I actually afford this transaction today," which is what a real `deal()` against a live
  sell order would cost — `avgPrice` is the right feed for `manufacturingCost`'s build-vs-buy comparison
  (a different question), but understates/overstates today's real transaction cost for this purpose.
- **Fallback to `avgPrice` when `sellMin` is missing** (no live sell orders for that resource yet, or the
  50-tick order cache hasn't run this session) — simpler than a cascading multi-tier fallback; if both are
  ever missing, that resource contributes `0` to the reserve (the market has no signal for it at all).
- **Why derived from the flat target, not from live shortfall/deficit**: a reserve computed as "cost to
  cover the *current* shortfall" would create circularity — `marketFallback` is called *because* there's
  a shortfall (that's what `leftover` is); if the reserve floor is *also* sized off the current shortfall,
  it either always blocks buying (the reserve consumes exactly the credits the buy needs) or needs a
  second, subtler tie-breaking rule. Deriving the reserve from the flat, stock-independent `BOOST_TARGETS`
  quantities avoids this: the reserve only moves when market prices move, never when the empire's actual
  stock moves.
- **`spendable` (credits above the reserve) is explicitly scoped for future non-boost-line spending**
  (energy, power — see decision 1's deferred items) — not consumed by this design's own MVP buy logic,
  which only spends on `leftover`'s boost-line deficits regardless of the reserve (see decision 6 on why
  the reserve doesn't gate MVP buying at all, only future convenience-spend).

### 4. Three independent cadences, not one
Three distinct pieces of market state/logic run on three distinct, independently-tuned intervals — this
was the single most-revised decision in the session (an earlier draft conflated all three into one pass):

| What | Reads/writes | Interval | Why this number |
|---|---|---|---|
| `getHistory()` scan | writes `MarketStats.prices` | `MARKET_SCAN_INTERVAL = 20000` (existing, unchanged) | The 7-day rolling average genuinely doesn't move within a single scan interval — running it more often buys nothing. |
| `getAllOrders()` scan | writes `MarketStats.orders` | new `ORDER_SCAN_INTERVAL = 50` | The order book is the most volatile part of market data (other players' live orders change constantly) despite `getAllOrders()` being the more expensive call — needs to run ~400x more often than the history scan. |
| `marketFallback` decision (buy/sell/reprice/prune) | reads `MarketStats.orders`, emits intents | `EMPIRE_LOGISTICS_INTERVAL` (existing, unchanged, ~11 ticks) | Inherits the cadence of the pass it's a phase of (decision 2) — reads whatever the order cache last had, which may be up to `ORDER_SCAN_INTERVAL` ticks stale. Acceptable: `MarketStats.tick` (decision 5) makes that staleness auditable. |

The order-book scan and the empire-logistics pass are deliberately **decoupled, separate tier-3 SYSTEMS
entries** — not run in the same call frame, so a full market scan never has to happen at the same moment
as a full empire-logistics matching pass. The reprice/buy/sell decision logic works entirely off
whatever's currently cached, however stale.

### 5. Cache: `Memory.stats.market`, not a new top-level `Memory.market`
All market-related persisted state (both the existing `getHistory()`-derived prices and the new
`getAllOrders()`-derived order book) lives under `Memory.stats.market`, migrated out of the old
freestanding `Memory.market: MarketMemory`. `MarketMemory` as a standalone interface is deleted; its
consumers (`scanMarketNow`, the `scanMarket()` console command) are updated to read/write
`Memory.stats.market` instead.

**Why this move, and why now (not deferred as unrelated cleanup):** every existing Grafana panel in this
repo reads exclusively from `Memory.stats.*` (confirmed by grep across `grafana/dashboard.json` — every
panel description cites a `Memory.stats.*` path, none reference `Memory.market` or any other top-level
key). A cache living outside `Memory.stats` is invisible to the dashboard by construction. Since this
design's whole point is operational data the user explicitly wants on a dashboard ("do make it available
for dashboards"), leaving the pre-existing `prices` cache un-migrated while adding a new, differently-located
`orders` cache would mean two market-data locations going forward for no reason — accepted as worth fixing
now rather than carried as new technical debt.

```ts
// memory/schema.ts — StatsMemory gains a new top-level field, its own type (not nested inside
// EmpireStats): the two are independently-scoped concerns (EmpireStats = wallet/deficit gauges written by
// the empire-logistics match pass; MarketStats = market-observation state written by two separate,
// differently-cadenced scans) that should be free to grow independently, per this session's own framing.
export interface StatsMemory {
  // ...existing fields unchanged...
  market?: MarketStats;
}

export interface MarketStats {
  tick: number; // Game.time this snapshot was last refreshed — ONE shared field, not per-resource. A
                // per-resource tick was considered and rejected: the container-level field already
                // answers "how stale is this whole cache," which is what matters for auditing a bad
                // trading decision after the fact (was the cache 400 ticks old during a CPU-starved
                // stretch?) — a per-resource copy would only add ~1.6KB of pure duplication for no new
                // information, since orders/prices always refresh together as one full scan each.
  prices: Partial<Record<MarketResourceConstant, { avgPrice: number; stddevPrice: number }>>;
  // Migrated from the old MarketMemory.prices — NOTE: no longer carries a per-entry `date` field. The
  // internal computation (summarizeMarketHistory) still uses getHistory()'s per-day `date` string
  // TRANSIENTLY to pick the latest of several returned days (getHistory() is documented oldest-first, so
  // this could also just take the last element — either is fine internally); only the WRITE to Memory
  // drops `date`, since the container-level `tick` above already answers every freshness question
  // downstream code needs. `date` (a calendar-day string) and `tick` (a game-tick number) measure
  // different axes and are not interchangeable in general — dropped here specifically because nothing
  // downstream of this cache needs the calendar-day axis at all, not because they're redundant in
  // principle.
  orders: Partial<Record<ResourceConstant, { buyMax: number; sellMin: number }>>;
  // NEW. From getAllOrders(), filtered/reduced to the current best buy price and best sell price per
  // BOOST_TARGETS resource (not the full order list — see "future extension" below for why a full-order
  // cache is explicitly not this). Scoped to BOOST_TARGETS resources only (decision 1), not every
  // ResourceConstant.
}
```

- **JSON footprint was explicitly checked, not assumed**: the full 41-resource `orders` table at
  `{buyMax, sellMin}` per resource is ~1.6KB serialized; adding a naive per-resource `tick` would have
  pushed that to ~2.3KB for zero informational gain, which is why the shared container-level `tick` was
  chosen over a per-resource one.

### 6. `marketFallback`'s actual buy/sell/reprice/prune logic

**Signature:**
```ts
function marketFallback(
  leftover: readonly EmpireRequest[],
  terminalCapacityPct: (colony: string, resource: ResourceConstant) => number
): Intent[]
```
`leftover`'s existing sign convention (from `matchEmpireRequests`) already splits buy-candidates from
sell-candidates with no new data needed: `amount > 0` = still a deficit (buy path), `amount < 0` = still a
surplus (sell path). `terminalCapacityPct` is injected the same way `receiverFreeCapacity`/`sendCost` are
already injected into `matchEmpireRequests` — keeps this testable over plain stubs, no live `Game.rooms`
lookup inside the pure decision logic itself.

**Per-resource, per-colony, for every entry in `leftover`:**

1. **Sell path (`amount < 0`, this colony has surplus)**:
   - If `terminalCapacityPct(colony, resource) >= 0.90`: **force-sell** — take the best current live buy
     order immediately (`Game.market.deal`-equivalent), ignoring price. A jammed terminal blocks
     everything else (can't receive empire-logistics transfers, can't receive mining output) — this
     mirrors Overmind's `terminalNearCapacity` branch and TooAngel's `force` flag (both ~90-95%
     thresholds). Threshold checked **per-resource** (is *this* resource's stock, not the terminal's
     overall fullness from unrelated resources, causing the jam) — deliberately not whole-terminal, so a
     terminal that's 95% full of a resource in deficit elsewhere doesn't force-sell it just because an
     unrelated resource is crowding the same terminal.
   - Otherwise: maintain a standing sell order at `MarketStats.orders[resource].sellMin` (reprice
     in-place if one already exists for this colony+resource, per decision 7 below).
2. **Buy path (`amount > 0`, this colony has a deficit)**: maintain a standing buy order at
   `MarketStats.orders[resource].buyMax`. (MVP does not gate this on the credit reserve/`spendable` — see
   decision 3's closing note: the reserve is scoped for *future* non-boost-line convenience spend, not
   this design's own boost-line buying. A boost-line buy order competing with the boost-line reserve
   itself would be the same circularity decision 3 already ruled out avoiding.)
3. **Prune**: for a colony+resource pair that appeared in a *previous* pass's `leftover` (i.e. had a
   standing order) but does NOT appear in `leftover` this pass (deficit/surplus resolved, either
   internally via `matchEmpireRequests` or by the order itself filling) — `cancelOrder()` that colony's
   now-unwanted standing order for that resource+direction. An inert, unwanted order isn't harmless
   clutter: it's a live standing offer that can still transact at a stale price, which would silently
   violate the "trading only happens when marketFallback actively decides it should" invariant the rest
   of this design relies on.

### 7. Order lifecycle: reprice/extend, never cancel-and-recreate; max 2 per resource **per colony**
Every order-placing bot in the research (Overmind's `maintainSellOrder`/`maintainBuyOrder`, The
International's `optimizeMyOrders`) prefers `changeOrderPrice`/`extendOrder` on an existing order over
cancel-and-recreate, since Screeps charges a market fee (5% of remaining value) on cancellation but not on
a price/amount change. This design follows the same rule: `marketFallback` looks for an existing live
order matching `{roomName: colony, resourceType: resource, type: buy|sell}` in `Game.market.orders`
**every pass, derived live** (no persisted order-ID bookkeeping — `Game.market.orders` is already a small,
cheap-to-iterate object, and persisting a second copy of information it already holds would be exactly the
kind of redundant state decision 11 already rejected elsewhere in `empire/logistics.ts`; a persisted
mapping would also need its own reconciliation logic for the case where an order fills/expires between
passes, which deriving live never has).

- If found: `changeOrderPrice` (reprice toward the cached `buyMax`/`sellMin` — see below) and/or
  `extendOrder` (top up the amount) as needed.
- If not found: `createOrder`.
- **Reprice trigger: no separate hysteresis band.** Every pass, if the cached price has moved, reprice
  directly to it. The International's 10%-delta threshold (added to avoid repricing on tick-to-tick noise
  against a continuously-fresh order book) has no equivalent need here: `MarketStats.orders` only refreshes
  every `ORDER_SCAN_INTERVAL` (50) ticks — the cache's own cadence already IS the throttle. Adding a
  second threshold on top of an already-coarse cache would only make the bot slower to follow real price
  movement, for no noise-reduction benefit that doesn't already exist.
- **Scope: 2 orders (1 buy + 1 sell) per resource, PER COLONY** — not empire-wide. Each colony with its
  own `leftover` entry for a resource maintains its own order pair from its own terminal, so a colony is
  always forced to update/reprice its own order for a given resource before anything else happens for
  that colony+resource combination — no cross-colony funneling through one terminal's cooldown, no
  colonies contending over who "owns" the empire's market presence for a resource. **Accepted tradeoff**:
  total order count scales as `2 x |BOOST_TARGETS| x colonyCount` rather than a flat ~82 — worth watching
  against Screeps' own per-account order limits as colony count grows, but not a concern at current scale.
  A same-resource buy AND sell order can be simultaneously active for the same colony (e.g. genuinely
  can't place internally due to congestion) — this is not treated as a contradiction to collapse to a net
  direction; both are real, independent situations `matchEmpireRequests`' congestion cap (decision 12,
  `empire/logistics.ts`) already tried and failed to resolve internally.

### 8. Intent kinds: one per distinct `Game.market.*` call, matching existing convention
The type union already declares `marketDeal` and `marketOrder`, but neither has a dispatch case in
`execute.ts`'s switch — pure unused scaffolding today (confirmed by grep). This design needs four
distinct market side effects (`deal`, `createOrder`, `changeOrderPrice`, `extendOrder`); every other
stateful effect in this codebase is one intent kind per one Screeps API call (`linkSend`, `placeSite`,
`removeStructure` are separate kinds despite all being "structure mutation" in the same loose sense these
four are all "order mutation") — so this design adds four kinds rather than folding reprice/extend into a
widened `marketOrder` with an action discriminant, keeping the established one-kind-one-call convention
instead of introducing the first exception to it.

```ts
// intents/types.ts
| { kind: "marketDeal"; order: string; amount: number; room: string } // existing, unchanged
| { kind: "marketCreateOrder"; room: string; resource: ResourceConstant; amount: number; price: number; type: "buy" | "sell" }
  // renamed from the existing "marketOrder" — also gains a `type` field the original stub was missing;
  // createOrder() needs ORDER_BUY/ORDER_SELL and the original scaffolding had no way to express it
| { kind: "marketReprice"; order: string; price: number } // new
| { kind: "marketExtendOrder"; order: string; amount: number } // new
```
`execute.ts` gains a dispatch case for all four, calling the corresponding `Game.market.*` method.

### 9. File split: scan and decide stay in separate files, mirroring the existing precedent
- **`src/empire/market.ts`** — unchanged. Stays read-only (`scanMarketNow`, `manufacturingCost`), still
  gated by `MARKET_SCAN_INTERVAL`.
- **`src/empire/marketOrders.ts`** (new) — the `getAllOrders()` scan, reduces to `MarketStats.orders`
  shape, its own tier-3 SYSTEMS entry gated by new `ORDER_SCAN_INTERVAL = 50`. No decision logic.
- **`src/empire/marketFallback.ts`** (new) — credit reserve (decision 3) + the buy/sell/reprice/prune
  decision logic (decisions 6/7), called from `runEmpireLogisticsPass` (decision 2).

This mirrors the split that already exists between `market.ts` (scan, own interval) and `logistics.ts`
(decide, own interval, reads the scan's output) — the order-book scan and the trading decision are on
genuinely different cadences and different SYSTEMS entries (decision 4), so folding them into one file
would blur a boundary the codebase already draws cleanly elsewhere.

### 10. Server gating: trading code doesn't ship at all outside the real World build
Market trading (order scan + fallback decision logic) must never run against the local pserver — not
because the pserver's `Game.market` API is missing (it isn't; `@screeps/launcher` implements the full
Market API surface, unlike e.g. `Game.cpu.generatePixel`, which pservers genuinely omit and which
`empire/pixels.ts`'s `planPixels` already feature-detects for), but because trading against a local,
single-player pserver's market is meaningless activity that shouldn't run there at all.

**Mechanism: a rollup-`replace`d build constant, mirroring the existing `__GIT_COMMIT__`/
`__PROFILER_ENABLED__` precedent** (`rollup.config.mjs`) — not a runtime `Game.shard.name` check. A
runtime check was considered and rejected: the local pserver has no shard configured in
`server/.screepsrc` and defaults to reporting `shard0`, while the real World colony currently runs on
`shard1` — meaning a `Game.shard.name` check would happen to work today, but only as an artifact of
current, undocumented config, not a guaranteed distinction (fragile if either default ever changes).

`rollup.config.mjs` already exposes `process.env.DEST` (`"main" | "dev" | "pserver" | "sim"`, set per npm
script — `push-main`, `push-dev`, `push-pserver`, `push-sim`) as exactly the fact needed. New `replace`
value:
```js
// rollup.config.mjs, alongside the existing __GIT_COMMIT__/__PROFILER_ENABLED__ values:
__SERVER__: JSON.stringify(dest ?? "unknown")
```
```ts
// marketOrders.ts / marketFallback.ts
declare const __SERVER__: string;
const MARKET_TRADING_ENABLED = __SERVER__ === "main";
```
Gating on this dead-code-eliminates the entire order-scan + fallback-trading logic out of every non-main
build (pserver, dev, sim, plain `bundle`) — not just a runtime no-op, the code doesn't ship in those
bundles at all, same zero-overhead property `__PROFILER_ENABLED__` already gets for the profiler wrapping.

## Open, deliberately deferred (write down, don't build)

- **Spending `spendable` (credits above the reserve) on non-boost-line resources** — energy, power. The
  reserve computation (decision 3) already produces this number; nothing yet consumes it. Scoped out per
  decision 1.
- **Pixel trading** — The International's `advancedSellPixels()` shows the shape (wallet-scale resource,
  no colony destination); a genuinely separate policy, not built here.
- **A full-order `global` cache** — during this session it was noted that a *complete* `getAllOrders()`
  result (not just min/max) could be cached in `global` (not `Memory` — too large to persist) to enable
  some future, more expensive, less-frequent analysis pass to work off real orders instead of just the
  summarized min/max this design produces. Nothing in this design needs it; flagged as a forward-looking
  idea only, same treatment as `boosting-reactions-plan.md`'s own "Local demand override" future extension.
- **Order-count ceiling monitoring**: given decision 7's `2 x |BOOST_TARGETS| x colonyCount` scaling
  (rather than a flat ~82), worth a metric/alert once colony count grows past a handful, to catch an
  approach toward Screeps' own per-account order limits before it silently starts failing `createOrder`
  calls.
