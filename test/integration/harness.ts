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
import { ScreepsServer } from "screeps-server-mockup";

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
}

export class BootedColony {
  private constructor(
    readonly server: ScreepsServer,
    readonly bot: Awaited<ReturnType<ScreepsServer["world"]["addBot"]>>,
    readonly room: string
  ) {}

  static async boot(opts: BootOptions): Promise<BootedColony> {
    const room = opts.room ?? "W0N1";
    const server = new ScreepsServer({ port: opts.port ?? 21077 });
    await server.world.stubWorld();
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

  /** Living creeps owned by the bot (includes still-spawning ones). */
  async creepCount(): Promise<number> {
    const id = this.bot.id;
    return (await this.roomObjects()).filter(o => o.type === "creep" && o.user === id).length;
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
