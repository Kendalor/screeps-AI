// Energy accounting for integration runs. Pure logic over per-tick world
// observations so it is unit-testable without the server: feed it a snapshot
// each tick, read the tallies at the end.
//
// Definitions (per the RCL3-stall investigation):
//   harvested  — source energy actually drained. A source holds energyCapacity
//                and refills to full at each regen; at the reset tick the energy
//                still sitting in it was NEVER harvested (wasted), and
//                (capacity - leftover) was harvested over that cycle.
//   wasted     — the leftover at each regen reset: income the colony left on the
//                table because no miner drained it in time.
//   decayed    — dropped energy that vanished without being picked up (only
//                dropped resources decay).
//   sinks      — where spent energy went: upgrading (controller progress delta),
//                construction (site progress delta), creeps (spawn body cost).

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

/**
 * Turn one tick's raw room objects into a TickObs. `seenCreeps` is mutated to
 * remember which creep ids have already been counted, so a creep's body cost is
 * attributed exactly once — on the tick it first appears (i.e. begins spawning).
 */
export function observeTick(objects: RawObj[], seenCreeps: Set<string>): TickObs {
  const sources: SourceObs[] = [];
  let droppedEnergy = 0;
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
      case "energy":
        droppedEnergy += o.energy ?? 0;
        break;
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

  return { sources, droppedEnergy, controllerProgress, controllerLevel, siteProgress, spawnedBodyCost };
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
  private prevDropped = 0;
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
          // Regen reset: the source refilled. Whatever sat in it just before the
          // refill (prev) was never harvested this cycle — that is wasted income.
          // The difference the miners did take is already counted on the drains.
          this.wasted += prev;
        }
      }
      this.prevSourceEnergy.set(s.id, s.energy);
    }

    // Dropped energy that disappeared without the pile growing is decay. A drop
    // that grows (a fresh pile) is not decay; only a net shrink counts.
    if (obs.droppedEnergy < this.prevDropped) {
      this.decayed += this.prevDropped - obs.droppedEnergy;
    }
    this.prevDropped = obs.droppedEnergy;

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
