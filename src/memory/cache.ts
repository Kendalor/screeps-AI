// RawMemory parse-skip trick: on consecutive ticks, reinstate last tick's parsed object instead of letting the engine re-parse.

declare global {
  interface RawMemory {
    _parsed: Memory;
  }
}

let lastMemory: Memory | undefined;
let lastTick = 0;

export function loadMemory(): void {
  if (lastTick && lastMemory && Game.time === lastTick + 1) {
    delete (global as { Memory?: Memory }).Memory;
    (global as unknown as { Memory: Memory }).Memory = lastMemory;
    RawMemory._parsed = lastMemory;
  } else {
    void Memory.rooms; // forces the engine's lazy parse
    lastMemory = RawMemory._parsed;
  }
  lastTick = Game.time;
}

/** Test hook: forget the cached memory, as after a global reset. */
export function resetMemoryCache(): void {
  lastMemory = undefined;
  lastTick = 0;
}
