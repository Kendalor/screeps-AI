// Role table: one class per role, each grouping its body calculator, step list and default spawn
// priority. Adding a role is adding a class here and a row in ROLES.

import type { RoleName } from "../../memory/schema";
import type { RoleDef } from "../types";
import { Bootstrap } from "./bootstrap";
import { Builder } from "./builder";
import { Hauler } from "./hauler";
import { Miner } from "./miner";
import { Scout } from "./scout";
import { Supply } from "./supply";
import { Upgrader } from "./upgrader";

export const ROLES = {
  bootstrap: Bootstrap,
  builder: Builder,
  upgrader: Upgrader,
  miner: Miner,
  supply: Supply,
  scout: Scout,
  hauler: Hauler
} satisfies Partial<Record<RoleName, RoleDef>>;

export function roleDef(role: RoleName): RoleDef | undefined {
  return (ROLES as Partial<Record<RoleName, RoleDef>>)[role];
}
