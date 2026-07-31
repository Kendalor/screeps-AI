// Role table: one class per role, each grouping its body calculator, step list and default spawn
// priority. Adding a role is adding a class here and a row in ROLES.

import type { RoleName } from "../../memory/schema";
import type { RoleDef } from "../types";
import { Bootstrap } from "./bootstrap";
import { Builder } from "./builder";
import { Claimer } from "./claimer";
import { Defender } from "./defender";
import { Hauler } from "./hauler";
import { Miner } from "./miner";
import { Repair } from "./repair";
import { Scout } from "./scout";
import { Supply } from "./supply";
import { Transport } from "./transport";
import { Upgrader } from "./upgrader";

export const ROLES = {
  bootstrap: Bootstrap,
  builder: Builder,
  upgrader: Upgrader,
  miner: Miner,
  repair: Repair,
  supply: Supply,
  scout: Scout,
  claimer: Claimer,
  hauler: Hauler,
  transport: Transport,
  defender: Defender
} satisfies Partial<Record<RoleName, RoleDef>>;

export function roleDef(role: RoleName): RoleDef | undefined {
  return (ROLES as Partial<Record<RoleName, RoleDef>>)[role];
}
