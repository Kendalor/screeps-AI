// Regression test for a real stuck-formation bug confirmed live on shard0 (2026-08-05): a drain healer
// exactly at its squadTargetPos on some tick (moveToPos no-ops that tick, "already there") fell through
// same-tick into heal, which resolved a damaged-but-out-of-range squadmate and called ITS OWN travelTo —
// grabbing primary-step status permanently, since heal is also a "move"-kind step that never
// self-completes (see interpreter.ts's isComplete). From then on the healer chased whichever squadmate
// heal picked instead of its assigned 2x2 formation slot, and drifted out of the formation for good.
// standStill:true on DrainHealer's heal step (behaviors/types.ts's Step.standStill) fixes this: heal may
// only act in range, never travel, whether it's the primary step or a co-fired bonus — formation
// position is exclusively moveToPos's job. Driven through runCreepBehaviors (the public entry point),
// same convention as creepDispatch.test.ts, so this survives refactors of the dispatch internals.

import { describe, expect, it } from "vitest";
import { runCreepBehaviors } from "../../../src/empire/creeps";
import { stubGame } from "../../helpers";

describe("DrainHealer formation latch regression", () => {
  it("does not travel toward an out-of-range squadmate when already at its formation slot (moveToPos no-ops)", () => {
    const travelCalls: unknown[] = [];
    const healed: string[] = [];

    // A damaged squadmate far outside heal range (range 1) or ranged-heal-assist range (range 3).
    const mate = {
      id: "mate1",
      pos: { x: 40, y: 40, roomName: "W1N1" },
      hits: 100,
      hitsMax: 500,
      memory: { op: "drain:W1N1", role: "drainAttacker" }
    };

    const fx = 20;
    const fy = 20;
    const creep = {
      name: "healer1",
      spawning: false,
      hits: 500,
      hitsMax: 500,
      memory: {
        role: "drainHealer",
        op: "drain:W1N1",
        // Already exactly at its formation slot — the coincidental tick that used to trigger the latch.
        squadTargetPos: { x: fx, y: fy, room: "W1N1" },
        task: { step: 0 }
      },
      pos: {
        x: fx,
        y: fy,
        roomName: "W1N1",
        isEqualTo: (x: number, y: number) => x === fx && y === fy,
        inRangeTo: (pos: { x: number; y: number }, range: number) => Math.max(Math.abs(fx - pos.x), Math.abs(fy - pos.y)) <= range,
        getRangeTo: (pos: { x: number; y: number }) => Math.max(Math.abs(fx - pos.x), Math.abs(fy - pos.y)),
        findClosestByPath: (list: object[]) => list[0] ?? null
      },
      room: { find: () => [mate] }, // squadMate resolution finds the damaged mate, nothing else
      store: { getFreeCapacity: () => 0, getUsedCapacity: () => 0 },
      heal: (t: { id: string }) => healed.push(t.id),
      rangedHeal: () => undefined,
      travelTo: (...args: unknown[]) => travelCalls.push(args)
    };
    stubGame({ objects: { mate1: mate } });
    Game.creeps = { healer1: creep as unknown as Creep };

    runCreepBehaviors();

    expect(healed).toEqual([]); // out of range — never actually healed
    expect(travelCalls).toEqual([]); // and never dragged off toward the out-of-range squadmate either
    // Falls back to step 0 (moveToPos), ready to pick up a fresh squadTargetPos next tick — not latched on heal.
    expect((creep.memory as { task: { step: number } }).task.step).toBe(0);
  });

  // A second, independent way to reach the same stuck state: task.step already sitting on heal (from
  // whatever earlier tick), the healer NOT at its formation slot, but "squadMate" resolves to something
  // already in range — including the acting creep itself (an undamaged healer can always trivially
  // "heal" itself, a no-op call that still reports acted:true) — so the ordinary forward-scanning
  // dispatch would keep re-selecting heal as primary forever, never reaching moveToPos again. The
  // moveToPos-preemption check in runOne (empire/creeps.ts) must force travel regardless of task.step.
  it("still travels toward its formation slot when task.step is already on heal and it can trivially self-heal", () => {
    const travelCalls: unknown[] = [];
    const healed: string[] = [];

    const fx = 20;
    const fy = 20;
    // One tile from its assigned slot — close enough that "squadMate" (which includes the acting creep
    // itself, per targets.ts's squadMate case: room.find(FIND_MY_CREEPS) filtered by matching op — the
    // acting creep itself always passes that filter) always resolves someone in heal range, but not yet
    // AT the slot.
    const creep = {
      name: "healer1",
      spawning: false,
      hits: 500,
      hitsMax: 500,
      memory: {
        role: "drainHealer",
        op: "drain:W1N1",
        squadTargetPos: { x: fx + 1, y: fy, room: "W1N1" },
        task: { step: 1 } // already on heal, as if stuck from an earlier tick
      },
      pos: {
        x: fx,
        y: fy,
        roomName: "W1N1",
        isEqualTo: (x: number, y: number) => x === fx && y === fy,
        inRangeTo: () => true, // trivially in range of itself
        getRangeTo: () => 0,
        findClosestByPath: (list: object[]) => list[0] ?? null
      },
      store: { getFreeCapacity: () => 0, getUsedCapacity: () => 0 },
      heal: (t: { id: string }) => healed.push(t.id),
      rangedHeal: () => undefined,
      travelTo: (...args: unknown[]) => travelCalls.push(args)
    };
    // room.find(FIND_MY_CREEPS) includes the creep itself — the real "squadMate" resolution always finds
    // at least self, which is exactly what makes heal trivially "succeed" (a no-op self-heal) regardless
    // of position, the condition this test exists to guard against.
    (creep as unknown as { room: { find: () => object[] } }).room = { find: () => [creep] };
    stubGame({ objects: {} });
    Game.creeps = { healer1: creep as unknown as Creep };

    runCreepBehaviors();

    expect(travelCalls).toHaveLength(1); // moveToPos preempted and actually travelled
    expect((creep.memory as { task: { step: number } }).task.step).toBe(0); // latched on moveToPos, not heal
  });
});
