import {BuildOperation} from "./BuildOperation";
import {DefenseOperation} from "./DefenseOperation";
import {HaulerOperation} from "./HaulerOperation";
import  {InitialBuildUpPhase } from "./InitialBuildUpPhase/InitialBuildupPhase";
import {MinerOperation} from "./MinerOperation";
import {RepairOperation} from "./RepairOperation";
import {SimpleCounter} from "./simpleCounter/SimpleCounterOp";
import {SupplyOperation} from "./SupplyOperation";
import {UpgradeOperation} from "./UpgradeOperation";

export const OP_STORAGE: any = {SimpleCounter, InitialBuildUpPhase, MinerOperation, HaulerOperation, DefenseOperation, UpgradeOperation, SupplyOperation, RepairOperation, BuildOperation};