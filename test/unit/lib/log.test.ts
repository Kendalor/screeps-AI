import { beforeEach, describe, expect, it, vi } from "vitest";
import { log } from "../../../src/lib/log";

beforeEach(() => {
  (globalThis as Record<string, unknown>).Memory = {};
  (globalThis as Record<string, unknown>).Game = { time: 123 };
});

describe("log.debugCreep", () => {
  it("stays silent when the creep is not in Memory.debugCreeps", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    log.debugCreep("Miner1", "hello");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("prints when the creep is listed in Memory.debugCreeps", () => {
    Memory.debugCreeps = ["Miner1"];
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    log.debugCreep("Miner1", "hello");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("Miner1: hello"));
    spy.mockRestore();
  });

  it("stays silent for a different creep than the one listed", () => {
    Memory.debugCreeps = ["Miner1"];
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    log.debugCreep("Miner2", "hello");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("is unaffected by Memory.logLevel — prints even at the default error-only level", () => {
    Memory.debugCreeps = ["Miner1"];
    Memory.logLevel = undefined;
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    log.debugCreep("Miner1", "hello");
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe("log.debugRoom", () => {
  it("stays silent when the room is not in Memory.debugColonies", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    log.debugRoom("W1N1", "hello");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("prints when the room is listed in Memory.debugColonies", () => {
    Memory.debugColonies = ["W1N1"];
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    log.debugRoom("W1N1", "hello");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("W1N1: hello"));
    spy.mockRestore();
  });
});
