// Integration harness for the screeps-server-mockup (docs/rewrite-skeleton.md §8).
//
// Unit tests verify the pure planner cores against plain snapshots. The
// API-touching glue (resolveTarget candidate fetch, runStep dispatch, snapshot
// builders) can only be verified against a real engine — mocking it would only
// test the mocks. This harness boots the *bundled* bot inside a real private
// server one tick at a time and observes world state (not intent lists — the
// `creeps` system acts by side effect and returns []), so milestones assert on
// what actually happened in the world.
//
// Requires Node 24 + the native mockup build (see the screeps-mockup-install
// memory). Runs on demand via `npm run test:integration`, never per-commit.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ScreepsServer, TerrainMatrix } from "screeps-server-mockup";
import { EnergyMetrics, observeTick, type RawObj } from "./energyMetrics";

const REPO_ROOT = process.cwd();

// ---------------------------------------------------------------------------
// Bot bundle
// ---------------------------------------------------------------------------

let cachedBundle: string | undefined;

/**
 * Build the shipped bot bundle with rollup (no DEST/LOCAL env → compile only,
 * no upload, no copy to the live client) and return `dist/main.js` as a string
 * ready to hand to the mockup as the `main` module. Memoised per process so a
 * suite of scenarios only pays the ~1s build once. Runs under the same Node
 * that runs the tests via `process.execPath`.
 */
export function bundleBot(): string {
  if (cachedBundle) return cachedBundle;
  const rollupBin = path.join(REPO_ROOT, "node_modules", "rollup", "dist", "bin", "rollup");
  execFileSync(process.execPath, [rollupBin, "-c"], { cwd: REPO_ROOT, stdio: "ignore" });
  cachedBundle = readFileSync(path.join(REPO_ROOT, "dist", "main.js"), "utf8");
  return cachedBundle;
}

// ---------------------------------------------------------------------------
// World observation types
// ---------------------------------------------------------------------------

/** Raw room object as stored in the mockup db (loosely typed — engine schema). */
export interface RoomObject {
  type: string;
  x: number;
  y: number;
  user?: string;
  level?: number;
  progress?: number;
  progressTotal?: number;
  store?: Record<string, number>;
  spawning?: unknown;
  [k: string]: unknown;
}

export interface ControllerState {
  level: number;
  progress: number;
}

// ---------------------------------------------------------------------------
// Booted colony
// ---------------------------------------------------------------------------

export interface BootOptions {
  /** Bundled bot code (from bundleBot()). */
  botCode: string;
  /** Owned room. Must be one of stubWorld()'s 9 rooms. Default "W0N1". */
  room?: string;
  /** Spawn position. Default (20, 30) — a plain tile in the stub rooms. */
  spawnX?: number;
  spawnY?: number;
  username?: string;
  /** Storage port. Default 21077 to dodge the standard 21025 private server. */
  port?: number;
  /**
   * Replace the stub room's terrain before the first tick. Required by any
   * scenario that exercises the bunker layout — see `bunkerTerrain()`.
   */
  terrain?: TerrainMatrix;
}

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

/**
 * A room the bunker can actually be anchored in.
 *
 * `stubWorld()`'s rooms are rugged mazes whose maximum distance-to-wall
 * clearance is 4, but `BUNKER_RADIUS` is 6 — the layout needs a 13x13 open
 * pocket. In a stub room `pickAnchor` therefore (correctly) returns null,
 * no anchor is ever cached, and `planBuilding` skips the colony entirely, so
 * nothing downstream of layout placement can be exercised at all.
 *
 * This lays down an open room with a wall border and two interior wall bands
 * well clear of the centre. The bands matter: on a wholly blank grid every
 * interior tile qualifies and the anchor search would be a formality. Here it
 * has to discriminate, while the centre still offers clearance well above 6.
 */
export function bunkerTerrain(): TerrainMatrix {
  const terrain = new TerrainMatrix();
  // Room border — the engine treats edge tiles as unbuildable anyway, and a
  // solid rim keeps the distance transform's edge handling honest.
  for (let i = 0; i < 50; i++) {
    terrain.set(i, 0, "wall");
    terrain.set(i, 49, "wall");
    terrain.set(0, i, "wall");
    terrain.set(49, i, "wall");
  }
  // Interior obstacles, kept >6 tiles from the centre so they shape the search
  // without shrinking the bunker pocket below its required radius.
  for (let y = 3; y < 16; y++) {
    terrain.set(6, y, "wall");
    terrain.set(7, y, "wall");
  }
  for (let x = 34; x < 46; x++) {
    terrain.set(x, 40, "wall");
    terrain.set(x, 41, "wall");
  }
  return terrain;
}

export class BootedColony {
  /**
   * Creep ids already charged to the energy accounting. Lives on the colony so
   * sampling across several runUntil legs stays one continuous record.
   */
  private readonly seenCreeps = new Set<string>();

  private constructor(
    readonly server: ScreepsServer,
    readonly bot: Awaited<ReturnType<ScreepsServer["world"]["addBot"]>>,
    readonly room: string
  ) {}

  static async boot(opts: BootOptions): Promise<BootedColony> {
    const room = opts.room ?? "W0N1";
    const server = new ScreepsServer({ port: opts.port ?? 21077 });
    await server.world.stubWorld();
    // Before addBot: the spawn is placed into the room as it then stands, so
    // reshaping terrain afterwards could bury it in rock.
    if (opts.terrain) await server.world.setTerrain(room, opts.terrain);
    const bot = await server.world.addBot({
      username: opts.username ?? "kendalor",
      room,
      x: opts.spawnX ?? 20,
      y: opts.spawnY ?? 30,
      modules: { main: opts.botCode }
    });
    await server.start();
    return new BootedColony(server, bot, room);
  }

  /** All room objects in the colony room (walls excluded — engine object rows). */
  async roomObjects(): Promise<RoomObject[]> {
    return (await this.server.world.roomObjects(this.room)) as RoomObject[];
  }

  async controller(): Promise<ControllerState> {
    const c = (await this.roomObjects()).find(o => o.type === "controller");
    return { level: c?.level ?? 0, progress: c?.progress ?? 0 };
  }

  /**
   * Inject a controller level (and optional progress) directly into the
   * mockup DB, skipping the natural upgrade grind. Call between `boot()` and
   * the first `runTicks`/`runUntil` to start a scenario at a given RCL.
   */
  async setControllerLevel(level: number, progress = 0): Promise<void> {
    const { db } = await this.server.world.load();
    await db["rooms.objects"].update({ room: this.room, type: "controller" }, { $set: { level, progress } });
  }

  /**
   * Inject a structure (or construction site) directly into the mockup DB,
   * skipping the natural build grind. Call between `boot()` and the first
   * `runTicks`/`runUntil` to place structures the bot would otherwise build
   * itself, e.g. `addStructure("container", 22, 30, { store: { energy: 0 },
   * storeCapacity: 2000 })`.
   */
  async addStructure(type: string, x: number, y: number, attrs: Record<string, unknown> = {}): Promise<void> {
    await this.server.world.addRoomObject(this.room, type, x, y, attrs);
  }

  /**
   * Construction sites the bot has placed itself. Distinct from `structures()`
   * — a site is intent, a structure is a finished build.
   */
  async sites(): Promise<RoomObject[]> {
    const id = this.bot.id;
    return (await this.roomObjects()).filter(o => o.type === "constructionSite" && o.user === id);
  }

  /** Finished structures of `type` owned by the room (walls/controller excluded). */
  async structures(type: string): Promise<RoomObject[]> {
    return (await this.roomObjects()).filter(o => o.type === type);
  }

  /**
   * The bunker anchor the bot computed and cached in Memory, or null before it
   * has run its layout planning. Read from Memory rather than inferred from
   * placements — this is the planner's own recorded decision.
   */
  async anchor(): Promise<{ x: number; y: number } | null> {
    const mem = (await this.memory()) as {
      colonies?: Record<string, { anchor?: { x: number; y: number } }>;
    };
    return mem.colonies?.[this.room]?.anchor ?? null;
  }

  /** Living creeps owned by the bot (includes still-spawning ones). */
  async creepCount(): Promise<number> {
    const id = this.bot.id;
    return (await this.roomObjects()).filter(o => o.type === "creep" && o.user === id).length;
  }

  /**
   * Roles of the creeps the bot currently has in Memory. Read from Memory
   * rather than the world because role is the bot's own labelling — the engine
   * only knows "creep". Use `hasRole` for the common membership check.
   *
   * Genuinely "alive" since the tick loop reaps dead creeps' Memory (#24);
   * before that fix this over-reported as "every role ever spawned".
   */
  async rolesAlive(): Promise<string[]> {
    const mem = (await this.memory()) as { creeps?: Record<string, { role?: string }> };
    return Object.values(mem.creeps ?? {})
      .map(c => c.role)
      .filter((r): r is string => r !== undefined);
  }

  async hasRole(role: string): Promise<boolean> {
    return (await this.rolesAlive()).includes(role);
  }

  /** Total energy sitting in structures of `type` (containers, storage, ...). */
  async energyIn(type: string): Promise<number> {
    return (await this.structures(type)).reduce(
      (sum, s) => sum + ((s.store?.energy as number | undefined) ?? 0),
      0
    );
  }

  /**
   * Fold the current tick's world state into `metrics`. Call from an `onTick`
   * hook so a scenario accumulates energy accounting as it runs:
   *
   *   const metrics = new EnergyMetrics();
   *   await colony.runUntil(pred, 1500, () => colony.sampleEnergy(metrics));
   *
   * The `seenCreeps` set that attributes each body cost exactly once lives on
   * the colony, so repeated calls across several runUntil legs keep one
   * continuous accounting rather than double-counting creeps already alive.
   */
  async sampleEnergy(metrics: EnergyMetrics): Promise<void> {
    metrics.sample(observeTick((await this.roomObjects()) as RawObj[], this.seenCreeps));
  }

  /** Parsed bot Memory (or {} before the first tick writes it). */
  async memory(): Promise<Record<string, unknown>> {
    const raw = await this.bot.memory;
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  }

  /**
   * Advance `n` ticks, invoking `onTick(tick)` after each so scenarios can
   * sample gauges / evaluate checkpoints. Returns the final game tick count.
   */
  async runTicks(n: number, onTick?: (tick: number) => void | Promise<void>): Promise<number> {
    let tick = 0;
    for (let i = 0; i < n; i++) {
      await this.server.tick();
      tick = await this.server.world.gameTime;
      if (onTick) await onTick(tick);
    }
    return tick;
  }

  /**
   * Tick until `pred` is satisfied or `maxTicks` elapse. `onTick` still runs
   * every tick (for telemetry sampling). Resolves with the tick it was reached
   * on, or null if the budget ran out.
   */
  async runUntil(
    pred: () => boolean | Promise<boolean>,
    maxTicks: number,
    onTick?: (tick: number) => void | Promise<void>
  ): Promise<number | null> {
    for (let i = 0; i < maxTicks; i++) {
      await this.server.tick();
      const tick = await this.server.world.gameTime;
      if (onTick) await onTick(tick);
      if (await pred()) return tick;
    }
    return null;
  }

  /** Kill the server child processes. Call in afterAll. */
  stop(): void {
    this.server.stop();
  }
}

// ---------------------------------------------------------------------------
// Checkpoint ladder (docs/rewrite-skeleton.md §8)
// ---------------------------------------------------------------------------
//
// Scenarios assert sub-milestones with tick windows rather than one final
// assert, so a failure names the first rung missed and the phase is known
// before reading any data. Rungs are checked in order every tick; the first
// tick each predicate holds is recorded, and a rung is "missed" if that tick
// exceeds its `by` budget (or it never held).

export interface Rung {
  name: string;
  /** Latest tick by which this sub-milestone must hold. */
  by: number;
  reached?: number;
}

export class CheckpointLadder {
  constructor(private readonly rungs: Rung[]) {}

  /** Record any newly-satisfied rungs at the current tick. */
  async sample(tick: number, holds: (name: string) => boolean | Promise<boolean>): Promise<void> {
    for (const r of this.rungs) {
      if (r.reached === undefined && (await holds(r.name))) r.reached = tick;
    }
  }

  /** The first rung not reached within its budget, or null if all passed. */
  firstMissed(): Rung | null {
    return this.rungs.find(r => r.reached === undefined || r.reached > r.by) ?? null;
  }

  report(): string {
    return this.rungs
      .map(r => {
        const status =
          r.reached === undefined ? "MISSED" : r.reached > r.by ? `LATE@${r.reached}` : `ok@${r.reached}`;
        return `  ${r.name} (by ${r.by}): ${status}`;
      })
      .join("\n");
  }
}
