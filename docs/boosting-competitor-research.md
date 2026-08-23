# How six open-source Screeps bots handle creep boosting

## Status: research only (2026-08-23)
Comparative code research, not a design doc — companion to [`boosting-reactions-plan.md`](boosting-reactions-plan.md),
which cites an earlier, shallower version of this same survey ("Overmind, bonzAI, TooAngel, The International")
as prior groundwork. This doc is the full, code-cited version of that research, expanded to six bots.

Six agents independently cloned each repository, grepped the boosting-relevant surface (`boost`, `LAB_BOOST`,
`StructureLab`, lab-manager classes), and traced the full lifecycle from spawn decision to `lab.boostCreep()`.
One finding stood out immediately: not every bot that *appears* to support boosting actually runs it in
production — **The International**'s implementation turned out to be entirely unreachable dead code, so
**HoPGoldy/my-screeps-ai** was added as a sixth, working bot rather than dropping the comparison to four.
The International's writeup is kept below as a useful negative case.

A published, browsable version of this doc (with styled code blocks and a comparison table) also exists as a
Claude artifact; this file is the source-of-truth text version for the repo.

**Bots covered:** `bencbartlett/Overmind` (dev branch) · `Mirroar/hivemind` · `The-International-Screeps-Bot/The-International-Open-Source` · `TooAngel/screeps` · `screeps-bot-kasamibot` (npm-published source) · `HoPGoldy/my-screeps-ai`

**Also checked, not included:** `ScreepsQuorum/screeps-quorum` (163 stars) — grepped positive for "boost" in
`extends/mineral.js`, `extends/room/alchemy.js`, `qos/kernel.js`, `roles/factotum.js`, but none of those hits
were about creep boosting: `kernel.js`'s "boost" is `CPU_GLOBAL_BOOST`, an unrelated CPU-unlock mechanic, and
the mineral/alchemy/factotum hits only use "boost" in comments about reaction-chain vats/feeders. Its actual
`extends/lab.js` is 5 lines with no boost content, and `boostCreep()` is never called anywhere in the repo —
Quorum does not implement creep boosting at all.

---

## Six questions, six bots — fast comparison

| Bot | 1. Trigger | 2. Walk + boost | 3. Tier chosen | 4. Logistics unit | 5. Proactive? |
|---|---|---|---|---|---|
| **Overmind** | `CreepMemory.needBoosts` written at spawn | Generic `TaskGetBoosted`, same Task framework as harvest/build | Dynamic, T3→T1 greedy fallback (`bestBoostAvailable`) | `manager`/queen Zerg via `TransportRequestGroup` | Compounds: yes (reaction stockpile). Lab-fill: on demand only |
| **Hivemind** | Per-role `getCreepBoosts()` predicate at spawn success | Cross-cutting `Role.preRun()` hijack via `overrideCreepLogic()` | Dynamic, best-effect-first, tier-capped by compound name length | Dedicated `helper` role, spawned only once a lab is assigned | No — lab claimed and released strictly per request |
| **The International** | *Not reachable* — `requestedBoosts` never written, `demandBoost`/`acceptBoost` have zero callers, `createBoostRoomLogisticsRequests()` is an empty stub | | | | |
| **TooAngel** | Role declares `boostActions`; checked once, right after spawn succeeds | Cross-cutting check in `Creep.prototype.handle()`, blocks role action until resolved | None — any compound >30 units in terminal qualifies, no tier ranking | Generic `mineral` distributor creep (shared with reaction duty) | No — `mineral` creep only spawns once a boost request exists |
| **KasamiBot** | Spawn-time (squads, baked into `Order`) *or* runtime threat check (defenders) | Dedicated always-on `BoostManager` at Critical priority; explicit `BoostStage` state machine | Fixed per squad tier / threat escalation level, not auto-best-of-stock | Conscripted `BaseHauler`, temporarily disabled from normal duty | No — `ClearLab` is stage one, buys/imports only what's missing |
| **HoPGoldy** | Player console command `.war()`, or tower auto-trigger on `checkEnemyThreat()` | `prepare` FSM stage (`boostPrepare()`) blocks role start; walk + `room.boostCreep()` call | None — hard-coded to T3 `CATALYZED_*` only, per fixed war archetype (WAR/DEFENSE) | Generic room-wide manager/hauler via `ROOM_TRANSFER_TASK` queue | Compounds: yes (reaction pipeline targets T3 stock). Lab-fill: no, gated on war state |

---

## Overmind

**Repo:** `github.com/bencbartlett/Overmind` — `dev` branch (materially more complete lab code than `master`)

Boosting is entirely **creep-memory-driven**: a `CreepMemory.needBoosts` array is written once at spawn and
drained element-by-element as each requested compound gets applied. Movement and the actual boost call are
not bespoke logic — they ride Overmind's generic **Task** framework, the same infrastructure used for
harvesting or building.

### 1 · How boosting is triggered
A `CreepSetup`/`CombatCreepSetup` declares which boost *types* it wants (e.g. `['attack','tough','heal','move']`).
At spawn time, `setup.create(colony)` resolves each type to a concrete resource via the colony's
`EvolutionChamber`, and `Hatchery.generateProtoCreep()` writes the result into the new creep's memory.

```ts
const boosts: ResourceConstant[] = [];
if (this.boosts.length > 0 && colony.evolutionChamber) {
    for (const boostType of this.boosts) {
        const numParts = bodyCounts[BoostTypeBodyparts[boostType]];
        const bestBoost = colony.evolutionChamber.bestBoostAvailable(boostType, numParts * LAB_BOOST_MINERAL);
        if (bestBoost) boosts.push(bestBoost);
    }
}
```
*src/creepSetups/CreepSetup.ts:72-82*

Every idle tick, each overlord's `autoRun()` checks `creep.needsBoosts` before dispatching the creep's normal task:

```ts
if (creep.isIdle) {
    if (creep.needsBoosts) {
        this.handleBoosting(creep);
    } else {
        taskHandler(creep);
    }
}
```
*src/overlords/Overlord.ts:560-577*

### 2 · Walking to the lab + boosting
`Overlord.handleBoosting()` finds a lab already reserved/stocked with the needed compound and assigns a `TaskGetBoosted`:

```ts
const boostLab = _.find(evolutionChamber.boostingLabs, lab => lab.mineralType == boost);
if (boostLab) {
    zerg.task = Tasks.getBoosted(boostLab, <ResourceConstant>boost);
    return;
}
```
*src/overlords/Overlord.ts:530-555*

No bespoke pathing exists — `Task.run()` calls the generic `moveToTarget()` (range 1) every tick until adjacent, then `work()` fires:

```ts
if (lab.mineralType == this.data.resourceType &&
    lab.store[lab.mineralType] >= LAB_BOOST_MINERAL * partCount &&
    lab.store.energy >= LAB_BOOST_ENERGY * partCount) {
    const result = this.target.boostCreep(deref(this._creep.name) as Creep, this.data.amount);
    return result;
} else {
    return ERR_NOT_FOUND;
}
```
*src/tasks/instances/getBoosted.ts*

A timeout guards against wasted compound: the task invalidates once the creep's remaining lifetime drops under 85% (`MIN_LIFETIME_FOR_BOOST`).

### 3 · When the tier is chosen
*Which body parts* get boosted is a static, design-time property of the role's setup. *Which tier* (T1/T2/T3)
is resolved dynamically, always preferring the strongest available:

```ts
bestBoostAvailable(boostType: BoostType, amount: number): ResourceConstant | undefined {
    const boosts = BOOST_TIERS[boostType];
    for (const boost of [boosts.T3, boosts.T2, boosts.T1]) {
        if (this.colony.assets[boost] >= amount) return boost;
        else if (this.terminalNetwork.canObtainResource(this.colony, boost, amount)) return boost;
    }
    return undefined;
}
```
*src/hiveClusters/evolutionChamber.ts:354-407*

If nothing is available at any tier, that boost type is silently dropped — the creep spawns unboosted for that
part rather than blocking the spawn. Once written to memory, the compound choice is **frozen for the creep's
life**; only remaining amounts get recomputed later.

### 4 · How compounds and energy reach labs
`EvolutionChamber.registerBoosterLabRequests()` posts **High-priority** requests into a `TransportRequestGroup`
for any lab holding a boost reservation:

```ts
if (lab.mineralType != mineralType && lab.mineralAmount > 0) {
    this.transportRequests.requestOutput(lab, Priority.High, {resourceType: lab.mineralType!});
} else {
    this.transportRequests.requestInput(lab, Priority.High, {
        resourceType: <ResourceConstant>mineralType,
        amount: amount - lab.mineralAmount
    });
}
```
*src/hiveClusters/evolutionChamber.ts:300-313*

The colony's `manager`/queen Zerg (`CommandCenterOverlord`) services those requests ahead of ordinary
storage↔terminal balancing. If the compound isn't locally stocked, `terminalNetwork.requestResource()` pulls
it in from another colony over the empire-wide terminal network.

### 5 · Proactive or reactive?
**Both, at different layers.** Raw compound production is fully speculative — `Abathur.getNextReaction()` runs
reactions toward fixed stockpile targets (e.g. `XGHO2: 10000`) every tick, regardless of whether any creep
currently needs a boost. But *loading a specific lab* is strictly reactive: it only starts once
`EvolutionChamber.requestBoosts()` is called with a real pending need, called from every overlord's
`preInit()` for every zerg that still needs a boost.

> **Two-tier design.** Compound is stockpiled speculatively at the colony/storage level; the final mile into a
> specific boosting lab is 100% demand-driven. HoPGoldy independently converges on the same split — Overmind's
> is just the more automatic version, with no war-state toggle required.

### 6 · End-to-end flow
1. **Setup declares intent.** A role's `CreepSetup` carries a non-empty `boosts: BoostType[]`, often gated by a caller-supplied `opts.boosted` flag.
2. **Spawn enqueued.** The overlord's `wishlist()` pushes a `SpawnRequest` into the hatchery queue — no lab readiness check yet.
3. **Tier resolved at spawn.** `bestBoostAvailable()` scans T3→T1 against live stock; result written to `ProtoCreep.memory.needBoosts`. Spawning proceeds unconditionally either way.
4. **Creep is born** already carrying its boost wishlist in memory.
5. **Every idle tick**, the owning overlord checks `creep.needsBoosts`.
6. **preInit() registers demand.** Each overlord's `preInit()` calls `evolutionChamber.requestBoosts(zerg.getNeededBoosts())`, accumulating into `neededBoosts`.
7. **EvolutionChamber reserves a lab** and posts High-priority transport requests for mineral + energy; requests inter-colony transfer if not locally stocked.
8. **Manager/queen delivers** the compound and energy into the reserved lab via a chained withdraw→transfer Task.
9. **handleBoosting() assigns the task** once the lab is actually stocked, via `Tasks.getBoosted(lab, resource)`.
10. **Creep walks to the lab** using the generic Task movement (range 1).
11. **`lab.boostCreep()` fires** once adjacent and the lab passes its readiness check.
12. **needBoosts drains**; once empty, `needsBoosts` flips false and the creep is released to its real task — alive, boosted, working.

> **Notable gap.** No mid-life re-boosting: once a compound is chosen at spawn it's frozen, even if a better
> tier becomes available later. Several older boost call-sites are commented out under `src/deprecated/` —
> confirmed superseded, not representative of current behavior.

---

## Hivemind

**Repo:** `github.com/Mirroar/hivemind`

Boosting is decided **per spawn-role** at the moment a creep successfully spawns, then enforced by hijacking
the shared `Role.preRun()` hook — every role gets boost-interception for free without any role-specific code.
A dedicated `helper` creep, spawned only on demand, does the lab logistics.

### 1 · How boosting is triggered
Each concrete `SpawnRole` subclass optionally overrides `getCreepBoosts()`. Trigger conditions are role-specific
predicates — e.g. the builder only boosts repair WORK parts when the room is under serious attack:

```ts
getCreepBoosts(room: Room, option: BuilderSpawnOption, body: BodyPartConstant[]): Record<string, ResourceConstant> {
    // Only boost if ramparts need a lot of repairs.
    if (room.defense.getEnemyStrength() <= ENEMY_STRENGTH_NORMAL) return {};
    return this.generateCreepBoosts(room, body, WORK, 'repair');
}
```
*src/spawn-role/builder.ts:204-209*

Other roles gate on stockpile size (upgraders at RCL8, ≥50k energy), threat matching (defenders cap boost tier
to whatever the attacking enemy is using), or unconditional role membership (squad healers/attackers).

### 2 · Walking to the lab + boosting
Not a separate role or task — a cross-cutting override baked into every role's shared `preRun()`:

```ts
preRun(creep: Creep | PowerCreep): boolean {
    if (this.containSingleRoomCreep(creep)) return false;
    if (creep instanceof Creep && creep.room.boostManager?.overrideCreepLogic(creep)) {
        return false;
    }
    return true;
}
```
*src/role/role.ts:39-47*

If overridden, the creep's assigned role logic doesn't run *at all* that tick — it's fully diverted to walk
toward the lab and wait:

```ts
creep.whenInRange(1, lab, () => {
    if (lab.mineralType !== resourceType) return;
    if (lab.store.getUsedCapacity(resourceType) < amount * LAB_BOOST_MINERAL) return;
    if (lab.store.getUsedCapacity(RESOURCE_ENERGY) < amount * LAB_BOOST_ENERGY) return;
    if (lab.hasBoostedThisTick) return;
    if (lab.boostCreep(creep) === OK) {
        lab.hasBoostedThisTick = true;
        delete this.memory.creeps[creep.name][resourceType];
        ...
    }
});
```
*src/boost-manager.ts:186-213*

### 3 · When the tier is chosen
Chosen synchronously at spawn success, via a real greedy decision tree — `getBestBoost()` filters candidates
by effect type, rejects any compound without enough stock to cover *every* relevant body part, optionally caps
tier by compound-name string length (a clever proxy: T1 names are 2 chars, T2 are 4, T3 are 5), then picks
highest effect magnitude (lowest, for the "damage reduction" stat where smaller multipliers are better):

```ts
for (resourceType in availableBoosts) {
    if (availableBoosts[resourceType].available < count) continue;
    if (maxTier && resourceType.length > maxTier) continue;
    if (!bestBoost || (boostType === 'damage'
        ? availableBoosts[resourceType].effect < availableBoosts[bestBoost].effect
        : availableBoosts[resourceType].effect > availableBoosts[bestBoost].effect)) {
        bestBoost = resourceType;
    }
}
```
*src/spawn-role/spawn-role.ts:92-122*

The tier cap is used concretely in room defense: boost level is capped to match whatever tier the attacking
enemy is using, so defenders don't necessarily burn T3 against a T1-boosted attacker.

### 4 · How compounds and energy reach labs
A dedicated role, `helper`, exists purely for lab logistics — separate from the general `transporter` hauler,
which is explicitly barred from touching a boost lab's needed mineral:

```ts
if (room.boostManager.isLabUsedForBoosting(lab.id)
    && lab.mineralType === room.boostManager.getRequiredBoostType(lab.id)) continue;
```
*dispatcher/resource-source/lab.ts:57*

The helper only exists once a lab actually has a pending assignment:

```ts
if (helperCount < maxHelpers && room.boostManager.getBoostLabs().length > 0) {
    return [{ priority: 5, weight: 1.1 }];
}
```
*src/spawn-role/helper.ts:13-28*

### 5 · Proactive or reactive?
**Fully reactive at the lab level** — no pre-warming with common compounds. The lifecycle: request recorded →
`manageBoostLabs()` claims an available reactor lab only if a resourceType is requested and lab-less → helper
spawns only once a lab is claimed → lab released back to the reaction pool the instant the boost completes and
no other creep needs the same compound.

> A distinct `resource-level-manager.ts` does define stockpile brackets for boost compounds (e.g. 15,000 /
> 7,500 / 2,500 cutoffs) — but this feeds market/trade decisions, not lab-filling. Labs themselves are claimed
> and released strictly per-request.

### 6 · End-to-end flow
1. **Room init, every tick.** `room.boostManager.manageBoostLabs()` reconciles pending requests against lab assignments.
2. **Spawn role decides.** A `SpawnRole.getCreepBoosts()` predicate evaluates its trigger condition (threat, energy stock, controller level, squad membership).
3. **Body generated** independently of boosting via `getCreepBody()`.
4. **Spawn call executes**; only on success does boost logic run.
5. **Best compound chosen** via `getBestBoost()`'s greedy, tier-capped, effect-ranked search against live storage+terminal stock.
6. **Order recorded** — `room.boostManager.markForBoosting(creepName, boostResources)` writes body-part counts per resource to `Memory.boost.creeps`.
7. **Lab claimed next tick(s)** by `manageBoostLabs()`, simultaneously pulled out of the reaction pool.
8. **Helper creep spawns** (if not already alive) now that a lab needs stocking.
9. **Helper fills the lab**, alternating gather (withdraw from storage/terminal) and deliver (transfer into lab) until both mineral and energy thresholds are met.
10. **Creep diverted from its role** every tick via `preRun()`/`overrideCreepLogic()`, as long as it's not near end-of-life.
11. **Creep walks and waits** at range 1 via `getBestLabForBoosting`/`getMostPreparedLab`, scored by how close each candidate lab already is to fully stocked.
12. **Boost applied**; lab released if no other living creep needs the same compound; creep's role resumes next tick, alive and boosted.

---

## The International Open Source

**Repo:** `github.com/The-International-Screeps-Bot/The-International-Open-Source`

> **Headline finding.** Boosting is **not a live feature**. A substantial `LabManager` class exists with real
> boost-related plumbing — but nothing in the codebase ever calls it. This is scaffolded, then abandoned, code.

### 1 · How boosting is (not) triggered
`LabManager.requestedBoosts`, the queue that would drive lab assignment, is declared and initialized empty —
and never written to anywhere else in the codebase:

```ts
private requestedBoosts: MineralBoostConstant[] = []
```
*src/room/commune/labs.ts:144 — only read at line 381, never assigned elsewhere*

The two public methods that would serve as the trigger API — `demandBoost()` and `acceptBoost()` — have
**zero call sites** outside their own definitions. No role file, spawn manager, or combat/squad file references
`labManager` or `StructureLab` at all.

### 2 · Walking to the lab (dead code, but real logic)
The move+boost logic actually exists and is correct — it's simply unreachable:

```ts
public acceptBoost(creep: Creep, boost: MineralBoostConstant): boolean {
  if (creep.ticksToLive < CREEP_LIFE_TIME - 100) return false
  if (creep.boosts[boost] > 0) return false
  const labId = this.labsByBoost[boost]
  if (!labId) return false
  const lab = this.communeManager.room.roomManager.structures.lab.find(lab => lab.id == labId)
  if (lab.mineralType != boost) return false
  if (lab.mineralAmount < LAB_BOOST_MINERAL ||
      lab.store.getUsedCapacity(RESOURCE_ENERGY) < LAB_BOOST_ENERGY) return false
  let result = lab.boostCreep(creep)
  if (result == OK) return false
  if (result == ERR_NOT_IN_RANGE) {
    creep.createMoveRequest({ origin: creep.pos, goals: [{ pos: lab.pos, range: 1 }], avoidEnemyRanges: true })
  }
  return true
}
```
*src/room/commune/labs.ts:254-295*

### 3 · Tier priority list exists, but is unreachable
A full priority-ordered `boostsInOrder` array (T3→T2→T1 per category — fatigue, defence, heal, attack,
dismantle, upgradeController, etc.) is defined for lab assignment, but the loop that consumes it,
`assignBoosts()`, always finds zero matches since `requestedBoosts` is permanently empty. No role/spawn
body-generation file references boosts at all — nothing is chosen at spawn time either.

### 4-5 · Logistics: the final stub
Reaction-input/output logistics are real and working — haulers do get posted requests to feed the two-lab
reaction pipeline. But the boost-specific delivery function is a literal no-op:

```ts
private createBoostRoomLogisticsRequests() {}
```
*src/room/commune/labs.ts:727*

So even if a caller somehow invoked `demandBoost()`, the lab lookup would find nothing in `labsByBoost`, and
the function would loop forever without ever moving a compound into a boosting lab.

### 6 · Where the chain actually breaks
1. **Creep spawns** with a plain body — no boost intent attached anywhere.
2. **`labManager.run()`** executes every commune tick, calling `assignBoosts()` then `manageReactions()`.
3. **`assignBoosts()` is a no-op** — `requestedBoosts` is permanently `[]`.
4. **Reaction pipeline runs fine** — haulers service input/output lab requests, stockpiling compounds up to fixed `targetCompounds` targets in storage/terminal.
5. **No hauler is ever asked to fill a boosting lab** — `createBoostRoomLogisticsRequests()` does nothing.
6. **A creep that "wants" a boost** would need something to call `demandBoost(creep, boost)` — nothing does.
7. **End state:** `StructureLab.boostCreep()` is never invoked anywhere in the shipped code. The only functioning halves of the lab system are compound production and reading `creep.boosts` after the fact for stat calculations.

---

## TooAngel

**Repo:** `github.com/TooAngel/screeps`

The oldest codebase of the six, and it shows: boosting genuinely works end to end, but it's a small, rough
subsystem bolted onto the room's mineral economy. There's no dedicated lab role — the same generic `mineral`
distributor creep handles reaction-feeding *and* boost logistics.

### 1 · How boosting is triggered
Triggered as a side effect of a **successful spawn**, gated on the room owning a terminal and the role
declaring a static `boostActions` array:

```js
function prepareBoosting(room, creep, config) {
  if (!room.terminal || !room.terminal.my) return false;
  const unit = roles[creep.role];
  if (!unit.boostActions) return false;
  const boostConfig = { resources: [], time: Game.time };
  for (const part of new Set(config.body)) {
    for (const mineral of Object.keys(BOOSTS[part])) {
      for (const action of Object.keys(BOOSTS[part][mineral])) {
        if (unit.boostActions.includes(action) && room.terminal.store[mineral] > 30) {
          boostConfig.resources.push(mineral);
        }
      }
    }
  }
  if (boostConfig.resources.length === 0) return false;
  room.memory.boosts[config.name] = boostConfig;
}
```
*src/prototype_room_creepbuilder.js:548-580, called at line 611 right after spawnCreep() returns OK*

### 2 · Walking to the lab + boosting
No dedicated boosting role — *every* creep, of any role, checks this on every tick via the shared dispatcher
before its normal action runs:

```js
if (!this.memory.boosted && this.boost()) {
  return true;   // short-circuits normal role action while boosting
}
```
*src/prototype_creep.js:128-152*

```js
Creep.prototype.boost = function() {
  const boost = this.room.memory.boosts[this.name];
  if (!boost || !boost.lab) { this.memory.boosted = true; return false; }
  const lab = Game.getObjectById(boost.lab);
  this.moveToMy(lab.pos);
  const response = lab.boostCreep(this);
  if (response === OK || response === ERR_NOT_ENOUGH_RESOURCES) {
    this.memory.boosted = true;
    delete this.room.memory.boosts[this.name];
    return false;
  }
  return true;  // keep retrying / blocking normal action
};
```
*src/prototype_creep_mineral.js:32-64*

Note `boost.lab` is only set by the mineral logistics creep, not by the boosted creep itself — so a creep can
sit blocked, doing nothing else, until the hauler has picked a lab and started filling it.

### 3 · When the tier is chosen (it isn't, really)
Decided once, at spawn, from a snapshot of terminal stock. There is **no tier ranking** — `Object.keys(BOOSTS[part])`
is iterated and *every* compound present above 30 units in the terminal qualifies, with no preference for the
strongest available. The lab itself is picked lazily and crudely by the logistics creep:
`creep.room.findLabs()[0].id` — literally the first lab structure found, no capacity or suitability check.

### 4 · How compounds and energy reach labs
The generic `mineral` distributor creep's action checks for pending boosts before anything else:

```js
roles.mineral.action = function(creep) {
  if (creep.room.memory.boosts && Object.keys(creep.room.memory.boosts).length > 0) {
    if (prepareBoost(creep)) return true;
  }
  ...
};
```
*src/role_mineral.js:541-562*

`prepareBoost()` is a step-by-step state machine: pick a lab lazily → `cleanupLab()` evicts wrong minerals
back to terminal → `fillLabWithEnergy()` tops up from storage → `bringBoostMineralsToLab()`/`getBoostMineralsFromTerminal()`
deliver the compound → mark `config.done` once the lab has no free capacity.

The `mineral` creep only exists at all when a reaction or boost is pending:

```js
if (this.memory.reaction || (this.memory.boosts && Object.keys(this.memory.boosts).length)) {
  this.checkRoleToSpawn('mineral');
}
```
*src/prototype_room_my.js:513-521*

Reactions explicitly yield to pending boosts — the reaction pipeline pauses while any boost request is outstanding.

### 5 · Proactive or reactive?
**Strictly on-demand.** No pre-staging. The request itself is transient and timestamped — a 1,500-tick expiry
deletes stale entries in `room.memory.boosts` if a boost was never claimed (e.g. the creep died or was
rerouted before reaching a lab).

### 6 · End-to-end flow
1. **Spawn queue processes** a role with a declared `boostActions` array (e.g. upgrader → `['upgradeController']`).
2. **On spawn success**, `prepareBoosting()` scans the new body's part types against the engine's `BOOSTS` table and the terminal's current stock, recording `room.memory.boosts[creepName]` if anything qualifies.
3. **`checkForMineral()`** sees the pending request and spawns a `mineral` distributor creep if none exists.
4. **The `mineral` creep picks a lab** (first one found), cleans it, fills it with energy, then withdraws and delivers the compound from the terminal.
5. **Every tick, every creep** checks `!this.memory.boosted && this.boost()` before its normal role action.
6. **The boosted creep walks to the lab** (once `boost.lab` is set) and calls `lab.boostCreep(this)` repeatedly until `OK` or `ERR_NOT_ENOUGH_RESOURCES`.
7. **On resolution**, `memory.boosted = true` and the room-level request is deleted — permanently, whether or not the boost actually succeeded.
8. **Creep resumes** its real role action, boosted or not.
9. **Stale requests** older than 1,500 ticks are garbage-collected independently, preventing a permanent log-jam if a creep never reaches a lab.

> **Rough edges found in the code.** `role_nextroomer.js` sets `roles.builder.boostActions` again instead of
> its own role — an apparent copy-paste bug leaving `nextroomer` without real boosting. `carry.boostActions`
> is commented out — haulers are deliberately excluded. A `config.boosts.enabled` flag exists in config but is
> never read anywhere in the boost code path. No test coverage exists for boosting.

---

## KasamiBot

**Repo:** `screeps-bot-kasamibot@1.0.2` (npm) — the GitHub repo ships no source tree; the npm-published package
does, and was used for this research.

The only bot in this study with a **dedicated, always-on `BoostManager`** running at Critical priority
(guaranteed to execute every tick regardless of CPU budget) and an explicit named-stage state machine
(`ClearLab → BuyMinerals → LoadHauler → UnloadHauler → BoostCreep → ValidateBoost`). It's also the only one
that will actively *buy compounds off the market* mid-boost if local stock falls short.

### 1 · How boosting is triggered — two distinct paths
**Military squads:** baked into the `Order` at queue time, keyed by a `boostLevel` parameter that also changes
the body itself:

```js
case 1:
    healerorder.body = ProfileUtilities.getB1TeamHealerBody(tier);
    healerorder.memory.boost = [RESOURCE_GHODIUM_OXIDE, RESOURCE_LEMERGIUM_OXIDE, RESOURCE_ZYNTHIUM_OXIDE];
    break;
```
*lib.military.js:118-134*

**Base defenders:** evaluated every tick against a live threat assessment, only committing if the compound is
already roughly in stock:

```js
let boostLevelWanted = defendersShouldBoost(threat);
if (boostLevelWanted === 2 && hasMineralsForBoost(creep.room, 30, RESOURCE_CATALYZED_UTRIUM_ACID)) {
  creep.memory.boost = [RESOURCE_CATALYZED_UTRIUM_ACID];
}
```
*roles.RampartDefender.js:115-127*

Either way, the universal downstream gate is simply `creep.memory.boost !== undefined`, checked by the
per-tick creep dispatcher, which freezes ("disables") the creep and claims the room's single boost slot:

```js
if (creep.memory.boost !== undefined) {
  creep.disable();
  if (creep.room.memory.boostTarget === undefined) {
    creep.room.memory.boostTarget = creep.id;
  }
  return false;
}
```
*services.Creep.js:13-31*

### 2 · Walking to the lab + boosting
`BoostManager` runs unconditionally at Critical priority — no CPU-budget check gates it:

```js
run(pri) {
  if (pri === ManagerPriority.Critical) {
    for (let room of this.roomService.getNormalAndNotExpansion()) {
      if (BoostLib.roomHasCreepThatNeedsBoosting(room)) {
        this.boostCreepInRoom(room);
      }
    }
  }
}
```
*managers.Boost.js:14-23*

Both the boosted creep and its hauler `moveTo()` fixed offsets relative to a single, layout-reserved boost
lab, then the state machine's final steps fire the real call and validate it took:

```js
case BoostStage.BoostCreep:
  lab.boostCreep(boostTarget);
  this.setBoostStage(room, BoostStage.ValidateBoost);
  break;
case BoostStage.ValidateBoost:
  this.setBoostStage(room, BoostStage.ClearLab);
  if (BoostLib.creepIsBoosted(boostTarget, boosts.type)) {
    BoostLib.removeWantedBoostTypeFromCreepMemory(boostTarget, boosts.type);
  }
  break;
```
*managers.Boost.js:105-118*

### 3 · When the tier is chosen
Split by creep class: squads get a **fixed tier at order time** tied to body strength (`boostLevel` 0-3);
defenders get a **live escalating tier** re-evaluated every tick against the current threat snapshot. Neither
path auto-picks "best available" the way Overmind or Hivemind do — KasamiBot's tiers are externally decided
(by the caller ordering the squad, or by the threat-escalation table), not derived from a stock-scanning
greedy search.

### 4 · How compounds and energy reach labs
Energy is a hard precondition, gated before anything else starts:

```js
if (room.memory.boosting !== true && lab.energy < lab.energyCapacity) {
  Logger.log.error("Waiting with boost until lab has full energy", room.name);
  return;
}
```
*managers.Boost.js:40-43*

The hauler isn't a dedicated boost role — it's a conscripted `BaseHauler`, temporarily disabled from normal
duty for the boost's duration. Compound acquisition has a genuine two-tier fallback: pull surplus from another
owned room's terminal first, or buy on the open market:

```js
let targetRoom = /* find owned room with terminal.store[mineral] > count, highest stock */;
if (targetRoom !== undefined) {
  targetRoom.terminal.send(mineral, count, room.name);
} else {
  buyMineralsForBoosting(room, mineral, count);  // Game.market.deal() against cheapest sell order
}
```
*managers.Trade.js:828-871*

### 5 · Proactive or reactive?
**Reactive.** `ClearLab` — assuming the lab might be dirty from a previous boost and needs emptying first — is
literally the first stage of the state machine. The single boost lab is walled off from the general
reaction-lab pool the instant a boost starts, and returned to it the instant the boost finishes. No compound
is pre-staged in the boost lab ahead of a real request.

> **Two systems sharing one structure.** A separate `LabManager` (lowest priority, only runs when CPU budget
> allows) proactively stockpiles reaction end-products into the terminal as a background economy.
> `BoostManager` (highest priority, always runs) then opportunistically draws down or tops up that same
> terminal inventory purely on a per-request basis — mirroring Overmind's split, but with the physical lab
> itself shared and time-multiplexed rather than dedicated.

### 6 · End-to-end flow
1. **Trigger.** Either a squad order bakes in `memory.boost` at queue time, or a defender's runtime threat check sets it live.
2. **Registration.** The universal creep dispatcher sees `memory.boost`, disables the creep, and claims the room's single `boostTarget` slot (first creep wins; later claimants wait disabled).
3. **Dispatch.** `BoostManager`, running every tick at Critical priority, sees the claimed slot and calls `boostCreepInRoom()`.
4. **Preconditions checked** — terminal exists, boost lab exists, lab energy is full, a hauler is conscripted (reusing one already assigned, or grabbing + disabling a fresh `BaseHauler`).
5. **Positioning.** Both creeps `moveTo()` fixed tiles relative to the lab; once both arrive, `room.memory.boosting = true` latches and the state machine begins.
6. **ClearLab** — hauler evacuates any leftover mineral from a previous boost back to the terminal.
7. **BuyMinerals** — if the terminal doesn't hold enough, requests an inter-room transfer or falls back to a market buy; retries every tick until satisfied.
8. **LoadHauler / UnloadHauler** — hauler withdraws from the terminal, then transfers into the lab.
9. **BoostCreep** — `lab.boostCreep(boostTarget)` fires.
10. **ValidateBoost** — confirms every relevant body part now shows the correct `.boost` value; on success, shifts that compound off the creep's wishlist (a list — multiple compounds queue and repeat the cycle).
11. **Release.** Once the wishlist is empty, both creeps are re-enabled and the room's boost state is cleared; the lab returns to the reaction pool.

> **Design constraint.** Only one boost target per room at a time — no per-room queueing or priority across
> multiple simultaneous requesters; later claimants simply sit disabled until the slot frees.

---

## HoPGoldy · my-screeps-ai

**Repo:** `github.com/HoPGoldy/my-screeps-ai`

Added specifically to replace The International as a working example — confirmed via a direct call chain from
a combat role to the native `lab.boostCreep()` API before committing to the full research pass. Boosting here
is gated behind a room-wide **war-state toggle** (`Room.memory.boost`), shares its lab hardware with the
automated mineral-reaction pipeline, and can trigger either from a player console command or fully
automatically from tower threat-detection.

### 1 · How boosting is triggered — two paths, one entry point
**Manual:** a pure player console command, no automated policy behind it at all:

```ts
public war(): string {
    const result = this.startWar('WAR')
    if (result === OK) stats += `已启动战争状态，正在准备 boost 材料...`
    // "War state started, preparing boost materials..."
}
```
*src/mount/room/console.ts:347-357*

**Automatic:** the tower's own threat assessment trips a defensive boost with no player input:

```ts
public checkEnemyThreat(): boolean {
    const enemy = this.room._enemys || this.room.find(FIND_HOSTILE_CREEPS, { filter: whiteListFilter })
    if (enemy.length <= 0) return false
    if (!enemy.find(creep => creep.owner.username !== 'Invader')) return false
    const bodyNum = enemy.map(c => c instanceof Creep ? c.body.length : 0).reduce((p, c) => p + c)
    return bodyNum > MAX_CREEP_SIZE  // combined enemy body parts exceed one full creep (50)
}
```
*src/mount/structures/controller.ts:74-89*

```ts
private prepareBoost(defenderName: string): void {
    if (!this.room.memory.boost) {
        this.log('正在准备 boost 主动防御')  // "preparing boost for active defense"
        const result = this.room.startWar('DEFENSE')
    }
}
```
*src/mount/structures/tower.ts:105-114*

Both paths converge on the same `Room.prototype.startWar(boostType)`. Combat roles never decide to boost
themselves — whether a role participates is a hard split at the role-definition level (`dismantler` vs.
`boostDismantler`, `doctor` vs. `boostDoctor`), chosen by whichever code spawns the creep, not evaluated at
runtime inside a shared role body. Both trigger paths require a pre-placed map flag (`<roomName>Boost`) with
enough labs in range — a build-time layout precondition, not a dynamic decision.

### 2 · Walking to the lab + boosting
A dedicated `prepare` stage in the creep's generic FSM, shared by every boost-enabled role via a factory function:

```ts
const boostPrepare = () => ({
    prepare: (creep: Creep) => {
        const boostTask = creep.room.memory.boost
        if (boostTask.state !== 'waitBoost') { creep.say('boost 未准备就绪'); return false }
        const boostPos = new RoomPosition(boostTask.pos[0], boostTask.pos[1], creep.room.name)
        if (creep.pos.isEqualTo(boostPos)) {
            const boostResult = creep.room.boostCreep(creep)
            if (boostResult === OK) { creep.say('💥 强化完成'); return true }
            return false
        }
        else creep.goTo(boostPos)
        return false
    }
})
```
*src/role/war.ts:228-259*

The creep's run-loop refuses to advance to its real job until `prepare` returns true:

```ts
if (!this.memory.ready) {
    if (creepConfig.prepare) this.memory.ready = creepConfig.prepare(this)
    else this.memory.ready = true
}
if (!this.memory.ready) return
```
*src/mount/creep/extension.ts:30-42*

`Room.prototype.boostCreep()` itself does **no movement** — purely the native call, tolerant of a
partially-destroyed lab cluster:

```ts
public boostCreep(creep: Creep): OK | ERR_NOT_FOUND | ERR_BUSY | ERR_NOT_IN_RANGE {
    if (!this.memory.boost) return ERR_NOT_FOUND
    if (this.memory.boost.state != 'waitBoost') return ERR_BUSY
    let executiveLab: StructureLab[] = []
    for (const resourceType in this.memory.boost.lab) {
        const lab = Game.getObjectById<StructureLab>(this.memory.boost.lab[resourceType])
        if (lab) executiveLab.push(lab)
    }
    const boostResults = executiveLab.map(lab => lab.boostCreep(creep))
    if (boostResults.includes(OK)) {
        this.addRoomTransferTask({ type: ROOM_TRANSFER_TASK.BOOST_GET_RESOURCE })
        this.addRoomTransferTask({ type: ROOM_TRANSFER_TASK.BOOST_GET_ENERGY })
        return OK
    }
    else return ERR_NOT_IN_RANGE
}
```
*src/mount/room/extension.ts:602-634*

### 3 · When it's chosen — structural, not dynamic, no tier fallback
Which role name gets spawned is the only decision point — there's no runtime "boosted or not" branch inside a
shared role. The compound list is a flat, single-tier array, T3 only, for exactly two fixed war archetypes:

```ts
export const BOOST_RESOURCE: BoostResourceConfig = {
    WAR: [
        RESOURCE_CATALYZED_ZYNTHIUM_ACID,      // DISMANTLE
        RESOURCE_CATALYZED_KEANIUM_ALKALIDE,   // RANGED_ATTACK
        RESOURCE_CATALYZED_LEMERGIUM_ALKALIDE, // HEAL
        RESOURCE_CATALYZED_ZYNTHIUM_ALKALIDE,  // MOVE
        RESOURCE_CATALYZED_GHODIUM_ALKALIDE    // TOUGH
    ],
    DEFENSE: [
        RESOURCE_CATALYZED_UTRIUM_ACID,        // ATTACK
        RESOURCE_CATALYZED_GHODIUM_ALKALIDE,   // TOUGH
        RESOURCE_CATALYZED_ZYNTHIUM_ALKALIDE   // MOVE
    ]
}
```
*src/setting.ts:421-444*

If a required T3 compound is at zero, the state machine doesn't substitute a lower tier — it simply parks,
looping `BOOST_GET_RESOURCE` tasks forever until the terminal has stock. The bot's economy compensates by
keeping T3 pre-stocked (see §5) rather than the boost code having a fallback tree.

### 4 · How compounds and energy reach labs
Delivery runs through the same generic room-wide transfer-task queue used for extensions, towers, and lab
reactions — three boost-specific task types:

```ts
BOOST_GET_RESOURCE: 'boostGetResource',
BOOST_GET_ENERGY: 'boostGetEnergy',
BOOST_CLEAR: 'boostClear'
```
*src/setting.ts:411-414*

Producers live in `lab.ts`'s `boostController()`: `boostGetResource()` queues a delivery for any boost lab
still missing its designated compound (sourced from the **terminal**); once all labs have compound,
`boostGetEnergy()` queues energy top-offs (sourced from **storage**) for any lab under 1,000 energy. Only once
both pass does state flip to `waitBoost`. Generic manager creeps consume these tasks via handlers in
`advanced.ts:546-648`.

Boosting and reactions share the lab cluster's state machine but never run concurrently — reactions explicitly yield:

```ts
private labGetTarget(): void {
    // 如果有 boost 任务的话就优先执行 ("if there's a boost task, prioritize it")
    if (this.room.memory.boost) {
        this.room.memory.lab.state = LAB_STATE.BOOST
        return
    }
    ...
}
```
*src/mount/structures/lab.ts:183-188*

### 5 · Proactive or reactive? Both, at different layers
**Terminal stockpile: proactive.** The reaction pipeline's production targets (`labTarget` in `setting.ts`)
deliberately include the exact T3 `CATALYZED_*` compounds boosting needs, each held to a 4,000-unit target —
independent of whether any war is active. By the time a player calls `.war()`, the terminal has very likely
already stocked what's needed.

**Lab-loading: reactive.** Compounds sit in the terminal until a war state is explicitly started. Only then
does `Room.memory.boost` get created and the delivery tasks begin. There's also no per-creep reservation — the
unit of granularity is the whole war-type, reserving a fixed set of labs that any qualifying creep can then
walk up and consume from.

### 6 · End-to-end flow
1. **Prerequisite (map-time).** A `<roomName>Boost` flag is placed with enough labs within range 1.
2. **Trigger.** Player runs `.war()`, or the tower's `checkEnemyThreat()` trips and calls `prepareBoost()` automatically.
3. **Task creation.** `startWar(boostType)` finds the flag, collects nearby labs, and builds a `BoostTask`: `{ state: 'boostGet', pos, type, lab: {...} }`, assigning one lab per required resource.
4. **Lab cluster yields.** The reaction state machine sees `Room.memory.boost` exists and flips to `LAB_STATE.BOOST`, pausing synthesis.
5. **Compound delivery.** `boostGetResource()` queues terminal→lab transfers for any lab still empty; manager creeps fulfill them. Once all labs hold compound, state advances.
6. **Energy delivery.** `boostGetEnergy()` queues storage→lab energy top-offs. Once all labs are full, state flips to `waitBoost` and a console log invites spawning.
7. **Boosted creep spawned** — player command (WAR) or the tower itself (DEFENSE), gated on `boost.state === 'waitBoost'`.
8. **Creep's `prepare` stage blocks its real job** until it walks to the stored boost position and `room.boostCreep(creep)` returns `OK` — calling native `lab.boostCreep()` across every lab in the task.
9. **Successful boost** optimistically re-queues resource/energy refill tasks immediately, anticipating next-tick depletion.
10. **Creep released** to its real combat/heal loop, alive and boosted.
11. **Post-war cleanup.** Player calls `.nowar()` → state flips to `boostClear`; manager creeps return leftover compound from labs to the terminal; once empty, `Room.memory.boost` is deleted and the lab cluster resumes reactions.

> **Clear limitation.** No dynamic tier selection at all — hard-wired to T3 only, for exactly two war
> archetypes. If T3 stock runs dry, the pipeline stalls indefinitely rather than falling back to T2/T1 the way
> Overmind or Hivemind would. Boost participation is also fixed at the role-name level (`boostDismantler` vs.
> `dismantler`), not a runtime choice made per-spawn based on live stock.

---

## Cross-cutting patterns

### The boosting check always hijacks a shared hook, never a dedicated role
Overmind, Hivemind, TooAngel, KasamiBot, and HoPGoldy all converge on the same shape: a single interception
point that every creep passes through each tick (`Overlord.autoRun`, `Role.preRun`, `Creep.prototype.handle`,
`services.Creep.creepShouldRun`, HoPGoldy's `prepare` FSM stage), which diverts a creep toward its lab and
*fully suppresses its normal role logic* until the boost resolves or is abandoned. None of the five implement
boosting as its own spawned role — it's always a cross-cutting concern layered onto whatever role the creep
already has. HoPGoldy's variant is the most structural of the five: it doesn't even make the decision at
runtime — a role is compiled as boosted or not (`boostDismantler` vs. `dismantler`) before the creep ever spawns.

### Compound tier selection is a real feature only in Overmind and Hivemind
Both run a genuine greedy search over available compounds (T3→T1 in Overmind; effect-ranked with a tier cap in
Hivemind) at spawn time. TooAngel accepts *any* qualifying compound with no ranking. KasamiBot's tier is
externally imposed (squad `boostLevel` parameter, or a threat-escalation table) rather than derived from a
live stock scan. HoPGoldy goes furthest in the other direction: it's hard-wired to T3 `CATALYZED_*` compounds
only, for exactly two named war archetypes, with no fallback at all — if T3 stock runs dry, the pipeline
simply stalls rather than settling for a weaker boost.

### Lab logistics is always a distinct actor from the boosted creep itself

| Bot | Who moves the compound |
|---|---|
| Overmind | Colony's `manager`/queen Zerg, via a generic transport-request queue |
| Hivemind | Dedicated `helper` role, spawned only once a lab is claimed |
| TooAngel | Generic `mineral` distributor creep, shared with reaction duty |
| KasamiBot | A `BaseHauler` conscripted and temporarily disabled for the duration |
| HoPGoldy | Generic manager/hauler creeps executing a room-wide `ROOM_TRANSFER_TASK` queue, shared with extension/tower/nuker fills |

### Compounds are stockpiled speculatively; loading the specific lab never is
Every working implementation separates two concerns that are easy to conflate: bulk mineral *production*
(reactions run continuously toward fixed stockpile targets, independent of any known creep need) versus
*lab-loading* for a specific boost (always gated on a real, currently-pending request). None of the five
working bots pre-fills a boosting lab speculatively. Overmind and HoPGoldy show the clearest version of this
split: both run a reaction pipeline that deliberately targets the exact compounds boosting will eventually
need (Overmind's `wantedStockAmounts`, HoPGoldy's `labTarget` tuned to the same `CATALYZED_*` resources as its
`BOOST_RESOURCE` table) — but in both bots that's a background economic policy, decoupled from the actual
per-request lab fill.

### The failure mode: The International shows what "half-built" looks like
Its lab manager has correct, working move-and-boost logic, a correct tier-priority table, and a correct
reaction pipeline — but the two connective pieces (a populated `requestedBoosts` queue, and a non-empty
`createBoostRoomLogisticsRequests()`) were never written. It's a useful negative case: every other bot's
`demandBoost`-equivalent function has at least one real caller: `Overlord.handleBoosting`, `Role.preRun`,
`Creep.prototype.handle`, `services.Creep.creepShouldRun`, or HoPGoldy's `prepare`. The International's
`acceptBoost`/`demandBoost` have zero — which is exactly why HoPGoldy was pulled in to stand alongside it as
the working counter-example.

---

## Provenance
Research compiled from 6 parallel code-reading passes over each repository's default/dev branch (The
International was researched first, found to be dead code, and kept as a negative-case reference;
HoPGoldy/my-screeps-ai was added afterward as a working replacement). File:line citations reflect the commit
read at research time (2026-08-23) — verify against current HEAD before reuse. A styled, browsable version of
this same content also exists as a published Claude artifact.
