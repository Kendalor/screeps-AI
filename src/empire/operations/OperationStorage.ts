import { OperationsManager } from "empire/OperationsManager";
import { Operation } from "./Operation";
import {BuildOperation} from "./Operations/BuildOperation";
import {ClaimOperation} from "./Operations/ClaimOperation";
import {ColonizeOperation} from "./Operations/ColonizeOperation";
import {DefenseOperation} from "./Operations/DefenseOperation";
import {FlagListener} from "./Operations/FlagListener";
import {HaulerOperation} from "./Operations/HaulerOperation";
import  {InitialRoomOperation} from "./Operations/InitialBuildUpPhase/InitRoomOperation";
import {InitOperation} from "./Operations/InitOperation";
import {MinerOperation} from "./Operations/MinerOperation";
import {OperationScoutingManager} from "./Operations/OperationScoutingManager";
import {RemoteMiningOperation} from "./Operations/RemoteMiningOperation";
import {RemoveInvaderOperation} from "./Operations/RemoveInvaderOperation";
import RepairOperation from "./Operations/RepairOperation";
import {RoomLogisticsOperation} from "./Operations/RoomLogisticsOperation";
import {RoomPlannerOperation} from "./Operations/roomPlanner/RoomPlannerOperation";
import SupplyOperation from "./Operations/SupplyOperation";
import {UpdateRoomMemory} from "./Operations/UpdateRoomMemory";
import {UpgradeOperation} from "./Operations/UpgradeOperation";


export const OP_STORAGE: (any) = {
        RoomLogisticsOperation,
        RoomPlannerOperation,
        UpdateRoomMemory,
        RemoveInvaderOperation,
        OperationScoutingManager,
        InitOperation,
        RemoteMiningOperation,
        InitialRoomOperation,
        ClaimOperation,
        ColonizeOperation,
        MinerOperation,
        HaulerOperation,
        DefenseOperation,
        UpgradeOperation,
        SupplyOperation,
        RepairOperation,
        BuildOperation,
        FlagListener};
