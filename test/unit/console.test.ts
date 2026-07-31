import { beforeEach, describe, expect, it } from "vitest";
import { installConsoleCommands } from "../../src/commands/console";

beforeEach(() => {
  (globalThis as Record<string, unknown>).Memory = {};
  installConsoleCommands();
});

describe("console: setLogLevel", () => {
  it("writes a valid level to Memory.logLevel", () => {
    global.setLogLevel("info");
    expect(Memory.logLevel).toBe("info");
  });

  it("rejects an invalid level without touching memory", () => {
    const result = global.setLogLevel("verbose" as never);
    expect(result).toMatch(/invalid/i);
    expect(Memory.logLevel).toBeUndefined();
  });
});

describe("console: setDebugMetrics", () => {
  it("toggles Memory.debugMetrics on", () => {
    global.setDebugMetrics(true);
    expect(Memory.debugMetrics).toBe(true);
  });

  it("toggles Memory.debugMetrics off", () => {
    global.setDebugMetrics(true);
    global.setDebugMetrics(false);
    expect(Memory.debugMetrics).toBe(false);
  });
});

describe("console: help", () => {
  it("lists every registered command", () => {
    const text = global.help();
    expect(text).toContain("setLogLevel");
    expect(text).toContain("setDebugMetrics");
    expect(text).toContain("help()");
  });

  it("does not duplicate entries across repeated installs", () => {
    installConsoleCommands(); // simulate a second global reset within the same module scope
    const lines = global.help().split("\n");
    const setLogLevelLines = lines.filter(l => l.startsWith("setLogLevel"));
    expect(setLogLevelLines).toHaveLength(1);
  });
});
