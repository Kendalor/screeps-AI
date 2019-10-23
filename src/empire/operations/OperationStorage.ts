import {BuildOperation} from "./Operations/BuildOperation";
import {ClaimOperation} from "./Operations/ClaimOperation";
import {ColonizeOperation} from "./Operations/ColonizeOperation";
import {DefenseOperation} from "./Operations/DefenseOperation";
import {FlagListener} from "./Operations/FlagListener";
import {HaulerOperation} from "./Operations/HaulerOperation";
import  {InitialRoomOperation} from "./Operations/InitialBuildUpPhase/InitRoomOperation";
import {MinerOperation} from "./Operations/MinerOperation";
import {RemoteMiningOperation} from "./Operations/RemoteMiningOperation";
import RepairOperation from "./Operations/RepairOperation";
import SupplyOperation from "./Operations/SupplyOperation";
import {UpgradeOperation} from "./Operations/UpgradeOperation";

export const OP_STORAGE: any = {RemoteMiningOperation, InitialRoomOperation, ClaimOperation, ColonizeOperation, MinerOperation, HaulerOperation, DefenseOperation, UpgradeOperation, SupplyOperation, RepairOperation, BuildOperation, FlagListener};