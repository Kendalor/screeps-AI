# Empire logistics plan

## Status: design only (2026-08-20)
Zero code written. This file is the agreed design after a grilling session that started from
`boosting-reactions-plan.md`'s M2 (empire assignment) and M4 (terminal distribution) and generalized both
into a standalone capability: empire-wide resource logistics between colonies, with storage, terminals,
and (later) the market as participants. Boosting/reactions becomes one *consumer* of this capability
(supplying target numbers via a config file) rather than the thing that shapes its API. This doc
**supersedes** `boosting-reactions-plan.md`'s M2 and M4 outright — those milestones are no longer separate
work; M5 (reaction running) and M7 (boosting) still stand, unchanged, downstream of this.

## Handoff orientation (read this first if picking this up cold)
- Repo: `c:\Users\Kenda\Documents\GitHub\screeps-AI`, branch `dev`.
- Read `boosting-reactions-plan.md` first — this doc assumes its decisions 1-3 and M0/M1/M3/M5/M6/M7 as
  context, and only replaces M2+M4. In particular, decision 2 (standing tiered stockpile, not
  demand-triggered) and decision 3 (shared lab-logistics mover) are unchanged.
- Read `docs/adr/0008-logistics-unification-overmind-style.md` before writing any code here. That ADR's
  live-`Game.*`-self-registration carve-out (scoped to `src/logistics/` there) is extended by this plan to
  empire scope too — this is a deliberate continuation of that carve-out, not an independent decision to
  bypass `ColonySnapshot` again.
- `src/logistics/stewardRegister.ts` is the closest existing analogue and the direct integration point:
  its `registerTerminalRebalanceRequest` (energy-only today) is what this plan's Steward seam extends to
  arbitrary resources and to accept an empire-injected reservation amount.
- `src/empire/market.ts` already has `REACTIONS`-graph traversal (`manufacturingCost`) and price-history
  caching (`Memory.market`, `scanMarketNow`) — reused as-is by the (stubbed) market-fallback phase later,
  not rebuilt.
- No lab/reaction/boost/empire-transfer code exists anywhere in `src/` as of this doc. This is fully
  greenfield, same as `boosting-reactions-plan.md`'s M1 onward.
- Real engine constants used throughout (verified against `node_modules/@screeps/common/lib/constants.js`,
  not recalled from memory): `STORAGE_CAPACITY = 1,000,000`, `TERMINAL_CAPACITY = 300,000`,
  `LAB_MINERAL_CAPACITY = 3,000`, `LAB_BOOST_MINERAL = 30`, `LAB_BOOST_ENERGY = 20`,
  `LAB_REACTION_AMOUNT = 5`, `TERMINAL_SEND_COST` (log-distance-scaled, ~0.1 base rate),
  `TERMINAL_MIN_SEND = 100`, `TERMINAL_COOLDOWN = 10`.
- Research grounding: three rounds of source-verified investigation (clone + grep, not docs/memory) into
  Overmind (`bencbartlett/Overmind`), The International
  (`The-International-Screeps-Bot/The-International-Open-Source`), TooAngel (`TooAngel/screeps`), and a
  bonzAI-derived fork — cited inline below where a decision was informed by (or deliberately diverges
  from) one of them.

## The decisions (and why)

### 1. Scope: inter-colony transfer only; market is a fallback, not a peer
Three participants were considered for the request pool: colony storage, colony terminal, and the open
market. **Market trading (buy/sell orders, credits) is deliberately out of scope for this pass** — it's
priced and risk-bearing (order availability, price drift) in a way resource-for-resource transfer isn't,
and the plan doc it supersedes already flagged market-buying as "a genuinely separate capability... worth
its own plan later." Confirmed by research: even Overmind, which has the most complete market integration
of the bots surveyed, keeps `TradeNetwork` as a fully separate class from `TerminalNetwork`, called only
as a fallback when no internal terminal can satisfy a request or absorb an excess
(`TerminalNetwork.ts` calling `Overmind.tradeNetwork.buy/sell/sellDirectly`).

This plan follows that shape: the empire matcher's colony-to-colony phase runs first (free, no price risk,
bounded only by `TERMINAL_SEND_COST`); a second, **structurally present but stubbed** market-fallback phase
receives whatever deficits/surplus the first phase couldn't pair, and does nothing yet. See decision 8.

### 2. Empire owns thresholds and applies them directly — not a colony-posted request pool
Two shapes were considered for "how does the empire know a colony needs resource X":
- **Colony-local posting** (a colony compares its own stock to an assigned target and posts a request into
  a shared pool when under; empire only matches, never decides thresholds) — mirrors The International's
  `TerminalRequest`/`createTerminalRequests`/`findBestTerminalRequest` (`terminalProcs.ts`). Rejected: this
  caps the empire's authority at "match what's voluntarily posted." It has no lever to override a colony's
  own view of its needs — e.g. "colony B is on the front line right now, prioritize keeping it stocked
  regardless of what its own local check would say."
- **Empire-owned targets, applied directly** (chosen) — the empire computes
  `effectiveTarget(colony, resource) = baseTarget(resource, boostLine) × roleMultiplier(colony)` for every
  colony, every resource with a target, and compares live stock against that number itself. Colonies are
  purely reactive participants; the empire can bias any colony's effective target up or down
  (decision 3) as a first-class, ordinary mechanism — not an exceptional-state escape hatch the way
  Overmind's `terminalState` is (`TerminalNetwork.ts`'s `registerTerminalState`/`handleTerminalState`,
  reserved for emergency/evacuate/rebuild directives only; routine `equalize()` never touches it).

### 3. Colony role multiplier: manual, persisted, defaults to neutral
`ColonyMemory` gains a manually-set field (e.g. `empireRole?: "frontline" | "backline"`, undefined =
neutral) — set via console command, persisted in `Memory`, defaulting every colony to neutral
(`roleMultiplier = 1.0`) until explicitly flagged. `effectiveTarget`'s role multiplier
(decision 2) reads this directly: a frontline colony's inflated target shows up as a bigger deficit and
gets matched first, purely as a consequence of the target number — no separate priority-queue mechanism
needed on top (see decision 5). Automatic derivation (from remote-danger state, active combat operations,
etc.) is a plausible future upgrade but out of scope now — no clean existing signal to key off, and manual
is a small, unambiguous piece of state to start with.

### 4. `EmpireRequest`: a new type, not a reuse of `LogisticsRequest`
`LogisticsRequest` (`src/logistics/request.ts`) is shaped around a live in-room object a creep physically
travels to (`target: _HasId & {pos: RoomPosition}`), scored by `multiplier × amount / distance` where
distance is real pathing tiles. An empire-level transfer has no creep leg at all — it's fulfilled by
`StructureTerminal.send()`, an instant cross-room transaction priced in energy
(`Game.market.calcTransactionCost`) and gated by a shared cooldown, not tiles or carry capacity. Forcing
inter-colony transfer through `LogisticsRequest`'s shape would mean immediately special-casing every field.
`EmpireRequest` is a new, standalone type instead.

**Shape mirrors `LogisticsRequest` deliberately** (one signed value per colony per resource — positive =
wants delivered, negative = has to give — existing independently of any match), rather than the empire
computing and emitting only fully-matched transfer pairs. This is a deliberate decoupling: keeping the
unmatched want/have list as its own value is what lets the market-fallback phase (decision 1) consume
exactly the leftover requests the colony-matching phase couldn't pair, without a second, differently-shaped
list built just for market's benefit.

```ts
interface EmpireRequest {
  colony: string; // colony/room name — no live object reference; see decision 9 on Game.* sourcing
  resource: ResourceConstant;
  amount: number; // positive = wants amount delivered; negative = has amount available to give
  // no dAmountdt/multiplier fields (unlike LogisticsRequest) — no known accrual rate at empire scope,
  // and the role-multiplier bias (decision 3) already lives inside how `amount` itself is computed
  // (effectiveTarget), not as a separate scoring factor applied afterward.
}
```

A separate `matchEmpireRequests()` function pairs two `EmpireRequest`s together (decision 5) — the type
itself carries no notion of a match.

### 5. Matching: pairwise sort-and-match, not a role-priority queue
Given effective targets already bake in the frontline/backline bias (decision 3), a plain sort is enough:
for each resource, sort colonies by `(stock − effectiveTarget)`, pair the highest surplus against the
lowest (most negative) deficit, repeat. A frontline colony's inflated target already surfaces as a larger
deficit and naturally sorts to the front of the match queue — no separate hard-priority tier (e.g.
"serve all frontline deficits before any backline deficit regardless of magnitude") is layered on top.
Rejected explicitly: an explicit role-priority queue, on the reasoning that the bias belongs in the target
number itself, not a second ranking dimension — simpler, and avoids two competing notions of "urgency."

Mirrors Overmind's `equalize()` (`TerminalNetwork.ts:322-371`, sort by `Colony.assets[resource]`, min-max
pair top/bottom against the network average) in shape, but diverges in what's being sorted against: Overmind
sorts against a *computed network average*; this plan sorts against an *empire-assigned, role-biased target*
(decision 2) — a deliberate, not incidental, difference.

### 6. The Steward seam: inject a reservation amount, don't override
Once a match is decided, the sending colony's local storage↔terminal balance (`Steward`, see
`src/logistics/stewardRegister.ts`) needs to know to keep the terminal topped up toward the send amount
(so the send can actually execute once cooldown clears) — and the receiving colony needs no special
handling at all, since an incoming `send()` lands directly in its terminal.

Two shapes were considered:
- **Override flag/target** (mirrors Overmind's `terminalState` exceptional-state mechanism) — rejected:
  bypasses Steward's own ranking, risking a reservation silently starving something else in that colony
  Steward would otherwise have caught.
- **Injected amount into Steward's existing request** (chosen) — the empire reservation raises the
  *wanted* amount `registerTerminalRebalanceRequest` already computes for that resource (today:
  `terminal.store.getFreeCapacity()`; becomes `max(that, empireReservedAmount)`), so it competes for
  Steward's attention via the same `scoreRequest` (amount/distance × multiplier) ranking as everything
  else in Steward's pool — no new override code path, no risk of silently starving other Steward work.

This requires generalizing `registerTerminalRebalanceRequest` (currently energy-only,
`STORAGE_SURPLUS_FRACTION`/`TERMINAL_LOW_FRACTION` at 50%/50% of structure *capacity*) to arbitrary
resources — see decision 7 for the threshold basis that generalization needs.

### 7. Storage holds the target; terminal holds surplus + a send-buffer; two threshold bases
Research finding across all three bots surveyed: none of them cleanly solve "how much of resource X lives
in storage vs. terminal specifically" — Overmind's mineral path just dumps *everything* into terminal
unconditionally (`manager.ts`'s `moveMineralsToTerminal`, no cap), The International decides total-band and
storage/terminal-split via two disconnected heuristics. Neither is a pattern worth copying.

**Chosen**: storage holds the colony's real per-resource target (decision 2's `baseTarget`); terminal only
ever holds surplus-above-target plus a small send-buffer sized to whatever's actively reserved for a
pending send (decision 6). Steward balances the two with a tolerance band, generalized from
`stewardRegister.ts`'s existing energy-only thresholds to a **two-basis** rule:

- **Energy: flat absolute target, unchanged from today's shape.** Terminal energy target = 50,000 (matches
  Overmind's own `equilibrium`, the one number among all three bots' balance logic that's actually
  well-reasoned), low threshold = 40,000. Energy is explicitly excluded from empire assignment (decision 1
  or the boosting-reactions plan's own scope) — it has no assigned target to be relative to, and terminal
  energy specifically can't wait for a storage-surplus fraction to trigger a top-up, since it's needed
  immediately to pay any send's fee (decision 8).
- **Every other resource: percentage of that resource's own assigned target**, not percentage of structure
  capacity — "50% of a 1,000,000-capacity storage" is meaningless for a compound with a 3,000-unit target.
  Terminal low threshold ≈ 30% of target (e.g. 1,000 of a 3,000 target), storage surplus threshold ≈ some
  factor above target (exact multiplier TBD at implementation time, not load-bearing for this design).

### 8. Send-cost accounting: carve out of the amount for energy; separate floor for everything else
`TERMINAL_SEND_COST` is always denominated in energy regardless of what's being shipped
(`calcTransactionCost` returns an energy amount). Two cases:
- **Sending energy itself**: the fee must be carved out of the computed send amount before issuing
  `send()` (mirrors Overmind's `equalize()`, which caps `sendAmount` at `store − sendCost − 10`,
  `TerminalNetwork.ts:360-362`) — otherwise a send sized to a colony's full energy surplus can exceed what
  the terminal can actually cover once its own fee is subtracted, since fee and cargo are the same
  resource competing for the same store.
- **Sending anything else**: the fee is paid from the terminal's separate energy floor (decision 7's flat
  50k target) — fee and cargo are different resources, so no carve-out of the shipped amount is needed;
  the 50k floor is sized generously enough to absorb it, kept available in practice by Steward's ordinary
  energy top-up (unchanged).

### 9. Data source: live `Game.*`, not `ColonySnapshot`
`ColonySnapshot` today only tracks single scalars (`storageEnergy`, `storageMineral`, `terminalEnergy`,
`terminalCapacity`) — no per-resource breakdown. Rather than widening the snapshot (a per-tick cost paid by
every colony, every tick, for data an infrequent — every ~11 ticks — consumer needs), the empire matcher
reads `Game.rooms[x].storage.store` / `.terminal.store` directly at match-time. This is a direct extension
of ADR 0008's existing self-registration carve-out (`src/logistics/`'s live-object reads, scoped there
explicitly) to empire scope — not an independent decision to bypass `ColonySnapshot` again elsewhere in the
planner stack. `EmpireRequest.colony` is a bare room-name string, not a live object reference (decision 4),
resolved back to `Game.rooms[...]` only when actually reading/acting.

### 10. Cadence: tier-3 interval, ~`TERMINAL_COOLDOWN`-scaled
The full matching pass (compute effective targets, read live stock, sort, match, issue sends) runs as a
new empire-scoped tier-3 `SYSTEMS` entry (`kernel/tick.ts`, same shape as `market.ts`'s
`MARKET_SCAN_INTERVAL`/`scanMarketNow`), interval ≈ `TERMINAL_COOLDOWN + 1` (~11 ticks). Since any single
terminal can only send once per 10-tick cooldown regardless, running the full pass every tick would waste
CPU recomputing decisions that can't act yet. Mirrors Overmind's own `equalize()` cadence
(`2*(TERMINAL_COOLDOWN+1)`, `TerminalNetwork.ts:76-77`) closely, though not identically.

### 11. Cooldown-blocked matches: skip and re-evaluate, no persisted intent
If a pass computes a good match but the sending colony's terminal is currently on cooldown, the match is
simply **not made this cycle** — no "A owes B" intent is persisted across passes. Next tier-3 tick
recomputes from scratch; a different (possibly better) match might win instead. Matches every bot surveyed
(none persist a pending send across cooldown — Overmind's `readyTerminals` filtering is entirely
same-tick) and fits this codebase's own decide-fresh-from-current-state planner philosophy (the same
reasoning `boosting-reactions-plan.md`'s decision 1 already used against "detect and correct"). At an
~11-tick cadence, a skipped match is nearly always still valid next pass since stock moves slowly —
persisting intent would add real staleness/invalidation complexity to fix a problem that mostly
self-resolves.

### 12. Congestion: cap send amount by the receiver's current terminal free capacity
`sendAmount = min(sender's sendable surplus, receiver's deficit, receiver's terminal.store.getFreeCapacity(resource))`.
Matches The International's approach (`terminalProcs.ts` clamps request amount to the requester's free
capacity before matching). Simple and always safe — `send()` would otherwise partially fail or error on
overflow. A large deficit that can't fully fit this pass just gets filled incrementally across future
passes as Steward drains the receiver's terminal toward storage between them (decision 7).

### 13. Market-fallback phase: structural stub only
The matcher's third phase (unmatched deficits/surplus after colony-to-colony matching, decision 5) is
**structurally present but does nothing yet** — a named extension point (e.g. `marketFallback(leftover)`),
not a no-op deletion. Fully specifying order price limits, credit budget, buy-vs-deal mechanics is
deliberately deferred to its own future session, same as the original boosting-reactions plan already
deferred "Market buying" as a genuinely separate capability. This keeps the current build scoped to what's
actually needed first (inter-colony transfer, decision 14's step 1).

## Build order

Reprioritized from the original `boosting-reactions-plan.md` (which had M5 reactions before M7 boosting,
and M2's assignment algorithm as a hard prerequisite). This plan drops M2's *algorithm* entirely — target
assignment is manual-config only (decision below) — and reorders the remainder:

1. **Empire transfer** (this doc): `EmpireRequest` type, `computeEmpireRequests()` (reads live storage/
   terminal stock vs. `effectiveTarget`), `matchEmpireRequests()` (pairwise sort-and-match, decision 5),
   the Steward-injection seam (decision 6), send-cost accounting (decision 8), congestion cap
   (decision 12). Tested standalone against **manually hand-set config targets** and seeded stock — no
   reaction production needs to exist yet.
2. **Steward generalization**: `registerTerminalRebalanceRequest` extended from energy-only to arbitrary
   resources, two-basis thresholds (decision 7).
3. **Market fallback**: fills in the stub from decision 13 with real buy/sell logic — its own dedicated
   design session.
4. **Boosting** (original plan's M7): pure stock consumer, unchanged from that plan's decision 2 — works
   correctly even before reactions exist, since it only ever checks current stock (which can come from
   manual seeding during testing, or empire transfer moving pre-existing stock around).
5. **Reactions** (original plan's M5): production/replenishment engine, built last since everything
   upstream (transfer, boosting) is already independently testable without it.

## Explicitly deferred / out of scope for this doc

- **M2's original assignment algorithm** ("empire assigns who reacts what, based on mineral surplus/
  terminal/lab capability") — dropped, not deferred-to-later. `baseTarget(resource, boostLine)` is a
  manually-edited config file (per-boost-line, per-tier, only for boost lines actually in use — not every
  one of the 9 body-part boost categories needs a nonzero target). No algorithm decides *who* is
  responsible for producing toward a target; the pairwise matcher (decision 5) dynamically moves whatever
  surplus exists toward whatever deficit exists, every pass, which subsumes the need for a fixed
  assignment in practice.
- **Automatic colony-role derivation** (decision 3) — manual only for now.
- **Market trading mechanics** (decision 13) — structural stub only.
- **Exact config file schema** — established only as "a separate, easily-editable file, per-boost-line,
  per-tier targets" — precise TypeScript shape is implementation-time work, not load-bearing here.

## Reference: TOUGH boost line volume sanity-check

Worked during design to sanity-check whether per-tier flat targets (3,000-6,000 range) are storage-feasible
empire-wide, using the TOUGH chain as a concrete example (verified against
`@screeps/common/lib/constants.js`'s real `REACTIONS`/`REACTION_TIME`/`BOOSTS` tables, not recalled):
`GO` (T1, `G + O`) → `GHO2` (T2, `GO + OH`) → `XGHO2` (T3, `GHO2 + X`). A single boost line's full T1+T2+T3
stockpile at 6k/3k/3k ≈ 12,000 units; if every one of the 9 body-part boost categories needed its own full
stockpile plus 7 raw mineral types at 6k each, total volume ≈ 150,000 units — about 15% of one storage's
1,000,000 capacity, or half of one terminal's 300,000. Confirms flat per-tier targets in this range are
comfortably affordable on the storage-budget axis; the real constraint is lab throughput/reaction time
(e.g. `XGHO2`'s 150-tick `REACTION_TIME` per 5-unit batch), not storage volume. Per your decision, actual
targets are per-boost-line (only lines you use), not applied flatly across all 9 — this sanity-check number
is therefore an upper bound, not the expected real footprint.
