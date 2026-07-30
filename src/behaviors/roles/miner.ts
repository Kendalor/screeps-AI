import { bodyCost, parts } from "../../spawn/body";
import type { BodyContext, Step } from "../types";
import { Role } from "./role";

// A source yields 10 energy/tick and one WORK harvests 2/tick (5 WORK is exact); provisioned
// slightly above that to absorb the walk to the source and the gap between a miner dying and
// its replacement arriving. Exported so mining.ts's per-source WORK target can't drift from what
// a single body can actually carry.
export const SOURCE_SATURATING_WORK = 6;

// An unreserved remote source regens at half rate (5/tick vs 10/tick reserved) — 3 WORK (6/tick
// capacity) already outpaces the supply, so staffing it to the full local/reserved target would
// only buy idle WORK parts. Exported so mining.ts's per-source WORK target can't drift from what an
// unreserved remote's body actually carries.
export const REMOTE_UNRESERVED_WORK = 3;

// Below this a body is too tight to spare a CARRY part at all.
const MIN_CARRY_ENERGY = 350;

// Every miner gets exactly one CARRY once the room can afford it, regardless of container/link/site —
// it ferries overflow into whatever it's standing near (container, link, or just its own next trip),
// and remote miners need it to shuttle into a container that may not exist yet.
function minerBody(energy: number, ctx: BodyContext): BodyPartConstant[] {
  const workTarget = ctx.remote && !ctx.reserved ? REMOTE_UNRESERVED_WORK : SOURCE_SATURATING_WORK;
  const carry: 0 | 1 = energy >= MIN_CARRY_ENERGY ? 1 : 0;

  // A remote can't assume a road home yet, so it needs the full 1 MOVE per non-MOVE part to keep
  // fatigue at zero; a local miner rides the bunker's paved roads and gets by on half that.
  const moveRatio = ctx.remote ? 1 : 0.5;

  // Search down from the WORK ceiling for the richest count whose MOVE ratio still fits the budget —
  // sizing WORK first and handing MOVE the leftovers (as a naive split would) can max out WORK while
  // starving MOVE, silently breaking the zero-fatigue guarantee above right when a remote needs it most.
  let work = 1;
  for (let w = workTarget; w >= 1; w--) {
    const move = Math.max(1, Math.ceil(w * moveRatio));
    if (bodyCost([...parts(WORK, w), ...parts(CARRY, carry), ...parts(MOVE, move)]) <= energy) {
      work = w;
      break;
    }
  }
  const move = Math.max(1, Math.ceil(work * moveRatio));

  return [...parts(WORK, work), ...parts(CARRY, carry), ...parts(MOVE, move)];
}

export class Miner extends Role {
  static override readonly priority = 95;
  static override body(energy: number, ctx: BodyContext): BodyPartConstant[] {
    return minerBody(energy, ctx);
  }
  // A miner keeps its own source container alive: it repairs it once it has decayed past 70%, and helps
  // build it while it is still a construction site. Both share harvest's WORK pipeline, so they cost a
  // harvest tick when they fire — but a spend step with an empty store is skipped by firstRunnableStep,
  // so a miner below the CARRY energy threshold (or one that just emptied its store) falls straight
  // through to harvest; these steps only engage once the miner is both carrying energy and the container
  // actually needs work. Repair before build before harvest so upkeep of an existing container wins, and
  // construction of a new one comes before topping the store; both self-limit as the store empties and
  // refills.
  //
  // Standing on the container, harvest overflow already lands in it and the transfer steps no-op;
  // otherwise (an overflow CARRY miner sharing a source, or feeding a link) they fire the same tick as
  // harvest — transfer is its own engine pipeline, independent of harvest's WORK pipeline.
  static override readonly steps: Step[] = [
    // Remote miners walk to their source's room first (targetRoom set at spawn). A local miner has no
    // targetRoom, so this no-ops and the interpreter advances straight to harvesting.
    { do: "moveToRoom", to: "targetRoom" },
    { do: "repair", at: { find: "structure", type: [STRUCTURE_CONTAINER], where: "damaged", near: "assignedSource", repairBelow: 0.7 } },
    { do: "build", at: { find: "constructionSite", structureType: STRUCTURE_CONTAINER, near: "assignedSource" } },
    { do: "harvest", from: { find: "source" } },
    { do: "transfer", to: { find: "structure", type: [STRUCTURE_LINK], where: "notFull", near: "assignedSource" } },
    { do: "transfer", to: { find: "structure", type: [STRUCTURE_CONTAINER], where: "notFull", near: "assignedSource" } }
  ];
}
