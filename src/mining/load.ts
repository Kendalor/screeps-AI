// The miner body a remote source would spawn, sized exactly as Mining's own remote request does.

import { orderBody } from "../spawn/body";
import type { BodyContext } from "../behaviors/types";
import { roleDef } from "../behaviors/roles";

/** The miner body a candidate source would spawn, sized exactly as Mining's own remote request would. */
export function remoteMinerBody(energyCapacity: number, reserved: boolean): BodyPartConstant[] {
  const ctx: BodyContext = { hasContainer: false, hasLink: false, remote: true, reserved };
  return orderBody(roleDef("miner")?.body(energyCapacity, ctx) ?? []);
}
