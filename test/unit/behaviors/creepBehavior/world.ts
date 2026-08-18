// A tiny stateful fake room+creep for driving a role's REAL Step[] end-to-end across many ticks
// (nextStep/firstRunnableStep + runStep from interpreter.ts), without a colony or screeps-server-mockup.
// Unlike interpreter.test.ts's per-step stubs (each fixture wired for exactly one call), this world
// tracks position/store/progress across ticks so a role's whole gather->work loop can be played out and
// asserted on, the way a single creep actually behaves in-game — just this creep, no siblings, no spawns.

export interface FakeSource {
  id: Id<_HasId>;
  pos: { x: number; y: number };
  energy: number;
  energyCapacity: number;
}

export interface FakeSite {
  id: Id<_HasId>;
  pos: { x: number; y: number };
  structureType: StructureConstant;
  progress: number;
  progressTotal: number;
}

export interface FakeContainer {
  id: Id<_HasId>;
  pos: { x: number; y: number };
  structureType: StructureConstant;
  energy: number; // generic carried-amount field — this world never mixes resources, so it also serves a mineral container
  capacity: number;
  hits: number;
  hitsMax: number;
}

export interface FakeMineral {
  id: Id<_HasId>;
  pos: { x: number; y: number };
  mineralAmount: number;
  ticksToRegeneration: number;
}

export interface FakeController {
  id: Id<_HasId>;
  pos: { x: number; y: number };
  level: number;
  my: true;
}

export interface WorldOptions {
  roomName?: string;
  creepPos?: { x: number; y: number };
  source?: Partial<FakeSource>;
  controllerPos?: { x: number; y: number };
  site?: Partial<FakeSite> | null;
  carryCapacity?: number;
  // A store-holding structure (container/storage/link) — for roles whose "gather" step draws from an
  // existing energy pool rather than self-harvesting a raw source (e.g. Upgrader, Builder's first choice).
  container?: Partial<FakeContainer> | null;
  // Present only for a mineralMiner-shaped world (mineralMiner.test.ts) — absent means find:"mineral"
  // resolves nothing, same "opt-in fixture" convention as site/container.
  mineral?: Partial<FakeMineral> | null;
}

// One WORK part's harvest() yield per tick, mirroring the engine constant used elsewhere in src/.
const HARVEST_POWER = 2;

function cheb(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * Builds one self-contained room+creep pair. `tick()` advances the fake creep one step toward its
 * current travelTo destination (so a role's move-then-act steps resolve over several ticks, same as
 * the real engine), then returns whatever runStep/nextStep produce for that tick.
 */
export class FakeWorld {
  roomName: string;
  pos: { x: number; y: number };
  store: { energy: number; free: number; capacity: number };
  source: FakeSource;
  controller: FakeController;
  site: FakeSite | null;
  container: FakeContainer | null;
  mineral: FakeMineral | null;
  workParts: number;
  private travelDest: { x: number; y: number } | null = null;
  built: string[] = [];
  upgraded: string[] = [];
  harvested: string[] = [];
  repaired: string[] = [];
  transferred: string[] = [];

  constructor(opts: WorldOptions = {}) {
    this.roomName = opts.roomName ?? "W1N1";
    this.pos = { ...(opts.creepPos ?? { x: 10, y: 10 }) };
    const capacity = opts.carryCapacity ?? 50;
    this.store = { energy: 0, free: capacity, capacity };
    this.source = {
      id: "source1" as Id<_HasId>,
      pos: { x: 25, y: 25 },
      energy: 3000,
      energyCapacity: 3000,
      ...opts.source
    };
    this.controller = {
      id: "controller1" as Id<_HasId>,
      pos: opts.controllerPos ?? { x: 40, y: 40 },
      level: 2,
      my: true
    };
    this.site =
      opts.site === null
        ? null
        : {
            id: "site1" as Id<_HasId>,
            pos: { x: 15, y: 30 },
            structureType: STRUCTURE_ROAD,
            progress: 0,
            progressTotal: 100,
            ...opts.site
          };
    this.container =
      opts.container === null || opts.container === undefined
        ? null
        : {
            id: "container1" as Id<_HasId>,
            pos: { x: 26, y: 25 },
            structureType: STRUCTURE_CONTAINER,
            energy: 2000,
            capacity: 2000,
            hits: 250000,
            hitsMax: 250000,
            ...opts.container
          };
    this.mineral =
      opts.mineral === null || opts.mineral === undefined
        ? null
        : {
            id: "mineral1" as Id<_HasId>,
            pos: { x: 25, y: 25 },
            mineralAmount: 50000,
            ticksToRegeneration: 0,
            ...opts.mineral
          };
    this.workParts = 2;
  }

  /** Moves the fake creep one tile toward its last travelTo() destination, if any is pending. */
  private stepToward(dest: { x: number; y: number }): void {
    const dx = Math.sign(dest.x - this.pos.x);
    const dy = Math.sign(dest.y - this.pos.y);
    this.pos = { x: this.pos.x + dx, y: this.pos.y + dy };
  }

  /** Advance one tile toward wherever the last tick's runStep called travelTo(), then clear it. */
  advance(): void {
    if (this.travelDest) {
      this.stepToward(this.travelDest);
      this.travelDest = null;
    }
  }

  // A rich RoomPosition-shaped stand-in — targets.ts calls inRangeTo/getRangeTo/lookFor generically on
  // every candidate's `.pos`, not just the acting creep's, so every structure/site/source/controller
  // exposed to it needs one of these, not a plain {x,y}.
  roomPos(p: { x: number; y: number }) {
    return {
      x: p.x,
      y: p.y,
      roomName: this.roomName,
      inRangeTo: (target: { x: number; y: number } | { pos: { x: number; y: number } }, range: number) => {
        const t = "pos" in target ? target.pos : target;
        return cheb(p, t) <= range;
      },
      getRangeTo: (target: { x: number; y: number } | { pos: { x: number; y: number } }) => {
        const t = "pos" in target ? target.pos : target;
        return cheb(p, t);
      },
      findClosestByPath: (list: { pos: { x: number; y: number } }[]) =>
        list.length === 0
          ? null
          : list.reduce((best, cur) => (cheb(p, cur.pos) < cheb(p, best.pos) ? cur : best)),
      isEqualTo: (other: { x: number; y: number }) => other.x === p.x && other.y === p.y,
      lookFor: () => [],
      // harvestStep (interpreter.ts) looks for a container sitting right at a source's mining tile —
      // the only findInRange caller in the production step logic this world drives.
      findInRange: (
        _find: FindConstant,
        range: number,
        opts?: { filter?: (s: { structureType?: string }) => boolean }
      ) => {
        if (!this.container) return [];
        const c = this.containerObj();
        if (cheb(p, this.container.pos) > range) return [];
        return !opts?.filter || opts.filter(c) ? [c] : [];
      }
    };
  }

  // Store-shaped view of the container matching what targets.ts's toCandidate/findCandidates expect
  // (structureType + a `store` with getFreeCapacity/getUsedCapacity + hits for repairStep), rebuilt
  // fresh each call so it always reflects the container's current energy/hits level.
  private containerObj() {
    const c = this.container!;
    return {
      id: c.id,
      pos: this.roomPos(c.pos),
      structureType: c.structureType,
      hits: c.hits,
      hitsMax: c.hitsMax,
      store: {
        getFreeCapacity: () => c.capacity - c.energy,
        getUsedCapacity: () => c.energy
      }
    };
  }

  private mineralObj() {
    const m = this.mineral!;
    return {
      id: m.id,
      pos: this.roomPos(m.pos),
      mineralType: RESOURCE_LEMERGIUM,
      mineralAmount: m.mineralAmount,
      ticksToRegeneration: m.ticksToRegeneration
    };
  }

  private siteObj() {
    const s = this.site!;
    return { id: s.id, pos: this.roomPos(s.pos), structureType: s.structureType, progress: s.progress, progressTotal: s.progressTotal };
  }

  private sourceObj() {
    const s = this.source;
    return {
      id: s.id,
      pos: this.roomPos(s.pos),
      energy: s.energy,
      energyCapacity: s.energyCapacity,
      // openHarvestTiles (targets.ts's source share cap) reads this off the candidate itself, not the
      // acting creep's room — an all-plains terrain gives every source its full 8-tile share cap.
      room: { getTerrain: () => ({ get: () => 0 }) }
    };
  }

  private controllerObj() {
    const c = this.controller;
    return { id: c.id, pos: this.roomPos(c.pos), level: c.level, my: c.my as true };
  }

  /** Builds a duck-typed Creep object bound to this world's current tick state. */
  creep(): Creep {
    return {
      id: "creep1",
      name: "test1",
      pos: this.roomPos(this.pos),
      // mineralId set whenever a mineral fixture exists, mirroring how MineralMining's real creep request
      // stamps memory.mineralId — needed for the assignedMineral positional filter (near: "assignedMineral")
      // mineralMiner's repair/build/transfer steps use to scope onto their own container.
      memory: { role: "test", home: this.roomName, ...(this.mineral ? { mineralId: this.mineral.id } : {}) },
      room: {
        name: this.roomName,
        controller: this.controllerObj(),
        find: (kind: FindConstant) => {
          if (kind === FIND_SOURCES || kind === FIND_SOURCES_ACTIVE) return this.source.energy > 0 ? [this.sourceObj()] : [];
          // A finished site is removed from the game the instant its progress completes — the fake mirrors
          // that so a role's build step naturally stops resolving it (see the "before upgrading" test).
          if (kind === FIND_MY_CONSTRUCTION_SITES)
            return this.site && this.site.progress < this.site.progressTotal ? [this.siteObj()] : [];
          if (kind === FIND_STRUCTURES || kind === FIND_MY_STRUCTURES) return this.container ? [this.containerObj()] : [];
          if (kind === FIND_MINERALS) return this.mineral && this.mineral.mineralAmount > 0 ? [this.mineralObj()] : [];
          if (kind === FIND_DROPPED_RESOURCES) return [];
          if (kind === FIND_HOSTILE_CREEPS) return [];
          return [];
        }
      },
      store: {
        getFreeCapacity: () => this.store.free,
        getUsedCapacity: () => this.store.energy,
        getCapacity: () => this.store.capacity
      },
      getActiveBodyparts: (part: BodyPartConstant) => (part === WORK ? this.workParts : part === CARRY ? 1 : 0),
      withdraw: (target: { id: Id<_HasId> }) => {
        if (!this.container || target.id !== this.container.id) return ERR_INVALID_TARGET;
        const amount = Math.min(this.container.energy, this.store.free);
        this.container.energy -= amount;
        this.store.energy += amount;
        this.store.free -= amount;
        return OK;
      },
      harvest: (target: { id: Id<_HasId> }) => {
        if (this.mineral && target.id === this.mineral.id) {
          const amount = Math.min(HARVEST_POWER * this.workParts, this.mineral.mineralAmount, this.store.free);
          this.mineral.mineralAmount -= amount;
          this.store.energy += amount; // generic carried-amount field, see FakeContainer's own doc
          this.store.free -= amount;
          this.harvested.push(target.id);
          return OK;
        }
        if (target.id !== this.source.id) return ERR_INVALID_TARGET;
        const amount = Math.min(HARVEST_POWER * this.workParts, this.source.energy, this.store.free);
        this.source.energy -= amount;
        this.store.energy += amount;
        this.store.free -= amount;
        this.harvested.push(target.id);
        return OK;
      },
      repair: (target: { id: Id<_HasId> }) => {
        if (!this.container || target.id !== this.container.id) return ERR_INVALID_TARGET;
        if (this.store.energy === 0) return ERR_NOT_ENOUGH_RESOURCES;
        const spend = Math.min(this.workParts, this.store.energy, (this.container.hitsMax - this.container.hits) / 100);
        this.container.hits = Math.min(this.container.hitsMax, this.container.hits + spend * 100);
        this.store.energy -= spend;
        this.store.free += spend;
        this.repaired.push(target.id);
        return OK;
      },
      transfer: (target: { id: Id<_HasId> }) => {
        if (!this.container || target.id !== this.container.id) return ERR_INVALID_TARGET;
        const amount = Math.min(this.store.energy, this.container.capacity - this.container.energy);
        this.container.energy += amount;
        this.store.energy -= amount;
        this.store.free += amount;
        this.transferred.push(target.id);
        return OK;
      },
      build: (site: { id: Id<_HasId> }) => {
        if (!this.site || site.id !== this.site.id) return ERR_INVALID_TARGET;
        const spend = Math.min(this.workParts * 5, this.store.energy, this.site.progressTotal - this.site.progress);
        this.site.progress += spend;
        this.store.energy -= spend;
        this.store.free += spend;
        this.built.push(site.id);
        return OK;
      },
      upgradeController: (controller: { id: Id<_HasId> }) => {
        if (controller.id !== this.controller.id) return ERR_INVALID_TARGET;
        const spend = Math.min(this.workParts, this.store.energy);
        this.store.energy -= spend;
        this.store.free += spend;
        this.upgraded.push(controller.id);
        return OK;
      },
      travelTo: (target: { pos?: { x: number; y: number } } | { x: number; y: number }) => {
        const p = "pos" in target && target.pos ? target.pos : (target as { x: number; y: number });
        this.travelDest = { x: p.x, y: p.y };
        return OK;
      }
    } as unknown as Creep;
  }
}
