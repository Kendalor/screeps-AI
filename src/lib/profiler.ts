// Vendored & adapted from screepers/screeps-typescript-profiler (MIT). Original wraps class prototype
// methods (`@profile` decorator) by mutating `prototype[key]` in place — that still works here
// (profileClass) since class prototypes are ordinary mutable objects.
//
// This codebase is mostly plain exported functions, not classes, so the original approach doesn't
// reach most of it. The natural extension — profileModule(), mutating a module namespace object's
// exports after `import * as ns` — does NOT work under rollup: rollup emits namespace objects via
// `Object.freeze(...)`, so every export is a non-configurable, non-writable data property and any
// attempt to reassign it throws `TypeError: Cannot assign to read only property`. Internal call sites
// wouldn't have seen the mutation anyway — rollup resolves cross-file references directly at bundle
// time, never through the namespace object — so mutate-after-import was a dead end twice over.
// wrapFn() is the replacement: it wraps a single function value and returns the wrapped replacement,
// applied at the function's own declaration site (see e.g. empire/creeps.ts's `export const
// runCreepBehaviors = wrapFn(...)`), which real callers do observe since it changes the actual binding.
//
// Gated by __PROFILER_ENABLED__, a compile-time constant substituted by rollup (see rollup.config.mjs).
// When false, wrapFn/profileClass are no-ops (wrapFn returns its argument unchanged) — zero runtime
// cost in a normal push-main/push-dev build, though the `if` and a handful of extra bytes remain at
// each wrapFn call site (unlike the old profileModule, this isn't behind one central dead branch).
//
// Data accumulates in Memory.profiler.data for as long as the profiler has been started (across tick
// boundaries and deploys, since it's Memory) — suited to a long, unattended pserver capture. Pull it
// out any time via the console (Profiler.output()) or externally via screeps-api reading Memory.

declare const __PROFILER_ENABLED__: boolean;

interface ProfilerData {
  calls: number;
  time: number;
}

interface ProfilerMemory {
  data: Record<string, ProfilerData>;
  start?: number;
  total: number;
}

export interface ProfilerCli {
  start(): string;
  stop(): string | undefined;
  status(): string;
  clear(): string;
  output(): string;
}

declare global {
  interface Memory {
    profiler?: ProfilerMemory;
  }
  var Profiler: ProfilerCli | undefined;
}

function mem(): ProfilerMemory {
  return (Memory.profiler ??= { data: {}, total: 0 });
}

function isEnabled(): boolean {
  return mem().start !== undefined;
}

function record(key: string, time: number): void {
  const data = mem().data;
  const entry = (data[key] ??= { calls: 0, time: 0 });
  entry.calls++;
  entry.time += time;
}

/**
 * Records `time` CPU under `key` directly, for call sites that need finer breakdown than wrapFn's
 * whole-function timing can give (e.g. one branch of a big switch) and so measure a sub-span by hand.
 * Respects the same start/stop gate as wrapFn — a no-op while the profiler isn't running. Callers
 * should still guard the `Game.cpu.getUsed()` timing calls themselves behind __PROFILER_ENABLED__, the
 * same as every other profiler call site, so the timing itself compiles out of a normal build too.
 */
export function recordManual(key: string, time: number): void {
  if (!__PROFILER_ENABLED__ || !isEnabled()) return;
  record(key, time);
}

// Wraps obj[key] in place with a CPU-timing shim. Used by profileClass only — class prototypes are
// ordinary mutable objects, unlike rollup's frozen module namespace objects (see the file header).
function wrapProperty(obj: Record<PropertyKey, unknown>, key: PropertyKey, label: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(obj, key);
  if (!descriptor || descriptor.get || descriptor.set || descriptor.writable === false) return;

  const original = descriptor.value;
  if (typeof original !== "function") return;

  const tag = `__profiled_${String(key)}__`;
  if (Reflect.has(obj, tag)) return;
  Reflect.set(obj, tag, true);

  obj[key] = wrapFn(original as (...args: unknown[]) => unknown, `${label}:${String(key)}`);
}

/**
 * Wraps a single function with CPU timing, recorded under `key`. Apply at the function's own
 * declaration/export site so real callers observe the wrapped version, e.g.:
 *
 *   export const runCreepBehaviors = wrapFn(function runCreepBehaviors(): void { ... }, "creeps:runCreepBehaviors");
 *
 * Returns `fn` unchanged (and dead-code-eliminates the wrapper) when __PROFILER_ENABLED__ is false.
 */
export function wrapFn<F extends (...args: any[]) => unknown>(fn: F, key: string): F {
  if (!__PROFILER_ENABLED__) return fn;
  const wrapped = function profiled(this: unknown, ...args: Parameters<F>): ReturnType<F> {
    if (!isEnabled()) return fn.apply(this, args) as ReturnType<F>;
    const start = Game.cpu.getUsed();
    const result = fn.apply(this, args) as ReturnType<F>;
    record(key, Game.cpu.getUsed() - start);
    return result;
  };
  return wrapped as F;
}

type Ctor = new (...args: never[]) => unknown;

/**
 * Wraps every method on a class's prototype (own properties only — not inherited ones, so a subclass
 * that doesn't override a base method isn't double-counted under both names) with CPU timing, recorded
 * under `${label ?? className}:${methodName}`. For real classes (Operation subclasses, Colony, Empire)
 * as opposed to profileModule's plain-function modules. Call once per class at import time:
 *
 *   profileClass(Mining);
 */
export function profileClass(ctor: Ctor, label = ctor.name): void {
  if (!__PROFILER_ENABLED__) return;
  const proto = ctor.prototype as Record<PropertyKey, unknown>;
  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key === "constructor") continue;
    wrapProperty(proto, key, label);
  }
}

export function initProfiler(): ProfilerCli {
  return {
    start(): string {
      mem().start = Game.time;
      return "Profiler started";
    },
    stop(): string | undefined {
      const m = mem();
      if (m.start === undefined) return undefined;
      m.total += Game.time - m.start;
      delete m.start;
      return "Profiler stopped";
    },
    status(): string {
      return isEnabled() ? "Profiler is running" : "Profiler is stopped";
    },
    clear(): string {
      const running = isEnabled();
      Memory.profiler = { data: {}, total: 0, start: running ? Game.time : undefined };
      return "Profiler memory cleared";
    },
    output(): string {
      const text = formatProfilerData();
      console.log(text);
      return text;
    }
  };
}

function formatProfilerData(): string {
  const m = mem();
  let totalTicks = m.total;
  if (m.start !== undefined) totalTicks += Game.time - m.start;
  if (totalTicks <= 0) return "No profiler data yet — call Profiler.start() first.";

  const rows = Object.entries(m.data)
    .map(([name, { calls, time }]) => ({
      name,
      calls,
      cpuPerCall: time / calls,
      callsPerTick: calls / totalTicks,
      cpuPerTick: time / totalTicks
    }))
    .sort((a, b) => b.cpuPerTick - a.cpuPerTick);

  const totalCpu = rows.reduce((sum, r) => sum + r.cpuPerTick, 0);
  const nameWidth = Math.max(8, ...rows.map(r => r.name.length)) + 2;

  const header =
    "Function".padEnd(nameWidth) +
    "Tot Calls".padStart(12) +
    "CPU/Call".padStart(12) +
    "Calls/Tick".padStart(12) +
    "CPU/Tick".padStart(12) +
    "% of Tot".padStart(12);

  const lines = rows.map(
    r =>
      r.name.padEnd(nameWidth) +
      String(r.calls).padStart(12) +
      `${r.cpuPerCall.toFixed(3)}ms`.padStart(12) +
      r.callsPerTick.toFixed(2).padStart(12) +
      `${r.cpuPerTick.toFixed(3)}ms`.padStart(12) +
      `${totalCpu > 0 ? ((r.cpuPerTick / totalCpu) * 100).toFixed(0) : "0"} %`.padStart(12)
  );

  const footer = `${totalTicks} ticks measured, ${totalCpu.toFixed(2)} avg CPU/tick profiled`;

  return [header, ...lines, footer].join("\n");
}
