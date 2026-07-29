// Energy accounting for integration runs. Pure logic over per-tick world observations so it is
// unit-testable without the server: feed it a snapshot each tick, read the tallies at the end.
//
// "wasted" is the energy still sitting in a source at its regen reset — income no miner drained
// in time, distinct from "harvested" (capacity minus that leftover).
//
// "decayed" is modeled directly from the engine's per-tick rule (ceil(amount / ENERGY_DECAY) per
// dropped-energy pile, see @screeps/engine's energy/tick intent) rather than inferred from the
// pile total shrinking — a shrink is indistinguishable from a pickup, which would otherwise get
// double-counted as decay.
const ENERGY_DECAY = 1000;

// A loosely-typed room object row as the mockup returns it (engine schema).
export interface RawObj {
  type: string;
  _id?: unknown;
  energy?: number;
  energyCapacity?: number;
  ticksToRegeneration?: number;
  level?: number;
  progress?: number;
  progressTotal?: number;
  body?: { type: string }[];
  [k: string]: unknown;
}

const BODYPART_COST: Record<string, number> = {
  move: 50,
  work: 100,
  carry: 50,
  attack: 80,
  ranged_attack: 150,
  heal: 250,
  claim: 600,
  tough: 10
};

// `seenCreeps` is mutated so a creep's body cost is attributed exactly once, on the tick it first appears.
export function observeTick(objects: RawObj[], seenCreeps: Set<string>): TickObs {
  const sources: SourceObs[] = [];
  let droppedEnergy = 0;
  let droppedDecay = 0;
  let controllerProgress = 0;
  let controllerLevel = 0;
  let siteProgress = 0;
  let spawnedBodyCost = 0;

  for (const o of objects) {
    switch (o.type) {
      case "source":
        sources.push({
          id: String(o._id),
          energy: o.energy ?? 0,
          energyCapacity: o.energyCapacity ?? 0,
          ticksToRegeneration: o.ticksToRegeneration ?? 0
        });
        break;
      case "energy": {
        const amount = o.energy ?? 0;
        droppedEnergy += amount;
        // Per-pile ceiling, matching the engine: a pile decays independently of its neighbors,
        // so this must be summed per-object rather than derived from the aggregate.
        droppedDecay += Math.ceil(amount / ENERGY_DECAY);
        break;
      }
      case "controller":
        controllerLevel = o.level ?? 0;
        controllerProgress = o.progress ?? 0;
        break;
      case "constructionSite":
        siteProgress += o.progress ?? 0;
        break;
      case "creep": {
        const id = String(o._id);
        if (!seenCreeps.has(id)) {
          seenCreeps.add(id);
          spawnedBodyCost += (o.body ?? []).reduce((sum, p) => sum + (BODYPART_COST[p.type] ?? 0), 0);
        }
        break;
      }
    }
  }

  return { sources, droppedEnergy, droppedDecay, controllerProgress, controllerLevel, siteProgress, spawnedBodyCost };
}

export interface SourceObs {
  id: string;
  energy: number;
  energyCapacity: number;
  ticksToRegeneration: number;
}

export interface TickObs {
  sources: SourceObs[];
  droppedEnergy: number; // total dropped energy on the ground this tick
  droppedDecay: number; // sum of ceil(amount / ENERGY_DECAY) across dropped-energy piles this tick
  controllerProgress: number; // cumulative
  controllerLevel: number;
  siteProgress: number; // summed absolute progress across open sites
  spawnedBodyCost: number; // body cost of any creep that began spawning this tick
}

export interface EnergyReport {
  ticks: number;
  harvested: number;
  wasted: number;
  decayed: number;
  sinks: { upgrading: number; construction: number; creeps: number };
  perTick: { harvested: number; wasted: number };
}

export class EnergyMetrics {
  private ticks = 0;
  private harvested = 0;
  private wasted = 0;
  private decayed = 0;
  private upgrading = 0;
  private construction = 0;
  private creeps = 0;

  private prevSourceEnergy = new Map<string, number>();
  private prevControllerProgress?: number;
  private prevControllerLevel?: number;
  private prevSiteProgress?: number;

  /** Fold one tick's observation into the running tallies. */
  sample(obs: TickObs): void {
    this.ticks++;

    for (const s of obs.sources) {
      const prev = this.prevSourceEnergy.get(s.id);
      if (prev !== undefined) {
        if (s.energy < prev) {
          // Normal drain: energy fell, all of it was harvested.
          this.harvested += prev - s.energy;
        } else if (s.energy > prev) {
          // Regen reset: whatever sat in it just before refilling (prev) was never harvested.
          this.wasted += prev;
        }
      }
      this.prevSourceEnergy.set(s.id, s.energy);
    }

    this.decayed += obs.droppedDecay;

    if (this.prevControllerProgress !== undefined && this.prevControllerLevel !== undefined) {
      if (obs.controllerLevel > this.prevControllerLevel) {
        // Level-up zeroes progress; count the climb to the cap plus the new tail.
        this.upgrading += obs.controllerProgress;
      } else {
        this.upgrading += Math.max(0, obs.controllerProgress - this.prevControllerProgress);
      }
    }
    this.prevControllerProgress = obs.controllerProgress;
    this.prevControllerLevel = obs.controllerLevel;

    if (this.prevSiteProgress !== undefined) {
      // Site progress falls when a site completes (drops out of the sum); only
      // count upward movement as build work done.
      this.construction += Math.max(0, obs.siteProgress - this.prevSiteProgress);
    }
    this.prevSiteProgress = obs.siteProgress;

    this.creeps += obs.spawnedBodyCost;
  }

  report(): EnergyReport {
    return {
      ticks: this.ticks,
      harvested: this.harvested,
      wasted: this.wasted,
      decayed: this.decayed,
      sinks: { upgrading: this.upgrading, construction: this.construction, creeps: this.creeps },
      perTick: {
        harvested: this.ticks ? this.harvested / this.ticks : 0,
        wasted: this.ticks ? this.wasted / this.ticks : 0
      }
    };
  }
}
