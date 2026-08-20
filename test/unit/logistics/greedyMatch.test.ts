// Unit coverage for greedyMatch.ts's pickBestPair — the shared greedy cross-resource pairing algorithm
// both Transport (behaviors/transportTaskRunner.ts) and Steward (behaviors/stewardTaskRunner.ts) drive
// their own request pool through. The core rule under test: a resource is only ever a candidate if BOTH a
// real output and a real input exist for it right now — a one-sided want or have, however large, must
// never be scored or win (this is the gh #59 fix: Steward's own copy of this logic previously scored each
// resource's single best request in isolation, letting a permanently-unfillable want win by magnitude
// alone and starve every real, fulfillable request behind it).

import { describe, expect, it } from "vitest";
import { pickBestPair } from "../../../src/logistics/greedyMatch";
import { requestInput, requestOutput, type LogisticsRequest } from "../../../src/logistics/request";

function target(id: string): _HasId & { pos: RoomPosition } {
  return { id: id as Id<_HasId>, pos: { x: 0, y: 0, roomName: "W1N1" } as RoomPosition };
}

const CONST_DISTANCE = () => 1;

describe("pickBestPair", () => {
  it("returns undefined for an empty pool", () => {
    expect(pickBestPair([], CONST_DISTANCE)).toBeUndefined();
  });

  it("skips a resource with only an output (no matching input) — never wins, however large", () => {
    const pool: LogisticsRequest[] = [requestOutput(target("t1"), "X", 999_999)];
    expect(pickBestPair(pool, CONST_DISTANCE)).toBeUndefined();
  });

  it("skips a resource with only an input (no matching output) — never wins, however large", () => {
    const pool: LogisticsRequest[] = [requestInput(target("t1"), "X", 999_999)];
    expect(pickBestPair(pool, CONST_DISTANCE)).toBeUndefined();
  });

  it("pairs a real output with a real input for the same resource", () => {
    const output = requestOutput(target("out1"), "X", 500);
    const input = requestInput(target("in1"), "X", 500);
    const pool: LogisticsRequest[] = [output, input];

    const pair = pickBestPair(pool, CONST_DISTANCE);

    expect(pair).toBeDefined();
    expect(pair?.resource).toBe("X");
    expect(pair?.output).toBe(output);
    expect(pair?.input).toBe(input);
  });

  it("a one-sided phantom want never blocks a different resource's real, fulfillable pair — even when the phantom's raw amount is larger", () => {
    // Reproduces the live bug directly: GO has only a one-sided (unfulfillable) want at a huge amount; X
    // has a real, smaller, two-sided pair. The old single-sided scoring let GO's larger raw amount win by
    // magnitude alone; pickBestPair must skip GO (no counterpart) and pick X instead.
    const phantomWant = requestInput(target("storage"), "GO", 999_999); // no matching GO output anywhere
    const xOutput = requestOutput(target("terminal"), "X", 2200);
    const xInput = requestInput(target("storage"), "X", 2200);
    const pool: LogisticsRequest[] = [phantomWant, xOutput, xInput];

    const pair = pickBestPair(pool, CONST_DISTANCE);

    expect(pair).toBeDefined();
    expect(pair?.resource).toBe("X");
  });

  it("among multiple real pairs, picks the higher-scoring one by amount", () => {
    const smallOutput = requestOutput(target("small-out"), "energy", 10);
    const smallInput = requestInput(target("small-in"), "energy", 10);
    const bigOutput = requestOutput(target("big-out"), "GO", 50_000);
    const bigInput = requestInput(target("big-in"), "GO", 50_000);
    const pool: LogisticsRequest[] = [smallOutput, smallInput, bigOutput, bigInput];

    const pair = pickBestPair(pool, CONST_DISTANCE);

    expect(pair?.resource).toBe("GO");
  });

  it("excludes a candidate input whose target is the SAME as the chosen output's target (no same-structure pair)", () => {
    // A structure that registers BOTH an implicit output and input for the same resource (e.g. Steward's
    // storage always offering "has energy" and "wants energy" simultaneously) must never pair with
    // itself — a same-structure withdraw+deliver task is meaningless.
    const storage = target("storage");
    const selfOutput = requestOutput(storage, "energy", 500_000);
    const selfInput = requestInput(storage, "energy", 500_000);
    const realInput = requestInput(target("other"), "energy", 100);
    const pool: LogisticsRequest[] = [selfOutput, selfInput, realInput];

    const pair = pickBestPair(pool, CONST_DISTANCE);

    expect(pair).toBeDefined();
    expect(pair?.output.target.id).toBe("storage");
    expect(pair?.input.target.id).toBe("other"); // never pairs storage's own output with its own input
  });

  it("respects a custom amountOf discount when scoring", () => {
    const output = requestOutput(target("out1"), "energy", 1000);
    const input = requestInput(target("in1"), "energy", 1000);
    const pool: LogisticsRequest[] = [output, input];

    // Discount the output down to 0 — the pair should still form (both sides still real requests) but a
    // caller checking the discounted amount would see it read as fully covered elsewhere.
    const discounted = pickBestPair(pool, CONST_DISTANCE, r => (r === output ? 0 : Math.abs(r.amount)));

    // amountOf(output) <= 0 means pickBestInDirection's own `if (amount <= 0) continue` skips it entirely.
    expect(discounted).toBeUndefined();
  });

  it("uses distanceFromOutput (not distanceFromCreep) to rank the input side, once an output is chosen", () => {
    const chosenOutput = requestOutput(target("out1"), "energy", 1000);
    const nearInput = requestInput(target("near"), "energy", 10);
    const farInput = requestInput(target("far"), "energy", 10);
    const pool: LogisticsRequest[] = [chosenOutput, nearInput, farInput];

    const pair = pickBestPair(
      pool,
      () => 5, // distanceFromCreep: irrelevant to the input ranking here
      undefined,
      (_output, input) => (input.target.id === "near" ? 1 : 100) // near scores higher only via this function
    );

    expect(pair?.input.target.id).toBe("near");
  });
});
