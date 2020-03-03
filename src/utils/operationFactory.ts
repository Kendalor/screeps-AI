import { Operation } from "empire/operations/Operation";
import { BuildOperation } from "empire/operations/Operations/BuildOperation";
import { ClaimOperation } from "empire/operations/Operations/ClaimOperation";
import { ColonizeOperation } from "empire/operations/Operations/ColonizeOperation";
import { DefenseOperation } from "empire/operations/Operations/DefenseOperation";
import { FlagListener } from "empire/operations/Operations/FlagListener";
import { FlagOperationProto } from "empire/operations/Operations/FlagOperation";
import { HaulerOperation } from "empire/operations/Operations/HaulerOperation";
import { BaseProto, InitialRoomOperation } from "empire/operations/Operations/InitialBuildUpPhase/InitRoomOperation";
import { InitOperation } from "empire/operations/Operations/InitOperation";
import { OperationMineMinerals } from "empire/operations/Operations/MineMInerals";
import { MinerOperation } from "empire/operations/Operations/MinerOperation";
import { OperationMineDeposit, OperationMineDepositProto } from "empire/operations/Operations/OperationMineDeposit";
import { OperationMinePower, OperationMinePowerProto } from "empire/operations/Operations/OperationMinePower";
import { OperationScoutingManager } from "empire/operations/Operations/OperationScoutingManager";
import { RemoteMiningOperation } from "empire/operations/Operations/RemoteMiningOperation";
import { RemoveInvaderOperation } from "empire/operations/Operations/RemoveInvaderOperation";
import RepairOperation from "empire/operations/Operations/RepairOperation";
import { RoomLogisticsOperation } from "empire/operations/Operations/RoomLogisticsOperation";
import { RoomOperationProto } from "empire/operations/Operations/RoomOperation";
import { RoomPlannerOperation } from "empire/operations/Operations/roomPlanner/RoomPlannerOperation";
import SupplyOperation from "empire/operations/Operations/SupplyOperation";
import { TradingOperation } from "empire/operations/Operations/TradingOperation";
import { UpgradeOperation } from "empire/operations/Operations/UpgradeOperation";
import { OperationsManager } from "empire/OperationsManager";
import { OPERATION, OperationConstructor, OperationMemory, OperationProto } from "./constants";
import { ColonizePortal } from "empire/operations/Operations/ColonizePortal";
import { RemoteOperationProto, RemoteOperationData } from "empire/operations/Operations/RemoteOperation";



export function opFactory(name: string, manager: OperationsManager, entry: OperationMemory): Operation | undefined{
    let op: Operation | undefined;
    switch(entry.type){
        case OPERATION.BASE:
            op = new InitialRoomOperation(name,manager,entry as BaseProto);
            break;
        case OPERATION.TRADING:
            op = new TradingOperation(name,manager,entry as OperationMemory);
            break;
        case OPERATION.UPGRADE:
            op = new UpgradeOperation(name,manager,entry as RoomOperationProto);
            break;
        case OPERATION.DEFEND:
            op = new DefenseOperation(name, manager, entry as RoomOperationProto );
            break;
        case OPERATION.MINING:
            op = new MinerOperation(name,manager,entry as RoomOperationProto);
            break;
        case OPERATION.CLAIM:
            op = new ClaimOperation(name,manager,entry as FlagOperationProto);
            break;
        case OPERATION.COLONIZE:
            op = new ColonizeOperation(name,manager,entry as RemoteOperationProto);
            break;
        case OPERATION.INIT:
            op = new InitOperation(name,manager,entry as OperationMemory);
            break;
        case OPERATION.SUPPLY:
            op = new SupplyOperation(name,manager,entry as RoomOperationProto);
            break;
        case OPERATION.REPAIR:
            op = new RepairOperation(name,manager,entry as RoomOperationProto);
            break;
        case OPERATION.BUILD:
            op = new BuildOperation(name,manager,entry as RoomOperationProto);
            break;
        case OPERATION.FLAGLISTENER:
            op = new FlagListener(name,manager,entry as OperationMemory);
            break;
        case OPERATION.ROOMLOGISTICS:
            op = new RoomLogisticsOperation(name,manager,entry as RoomOperationProto);
            break;
        case OPERATION.ROOMPLANNER:
            op = new RoomPlannerOperation(name,manager,entry as RoomOperationProto);
            break;
        case OPERATION.REMOTEMINING:
            op = new RemoteMiningOperation(name,manager,entry as FlagOperationProto);
            break;
        case OPERATION.SCOUTINGMANAGER:
            op = new OperationScoutingManager(name,manager,entry as OperationMemory);
            break;
        case OPERATION.REMOVEINVADER:
            op = new RemoveInvaderOperation(name,manager,entry as OperationMemory);
            break;
        case OPERATION.HAUL:
            op = new HaulerOperation(name,manager,entry as RoomOperationProto);
            break;
        case OPERATION.MINE_MINERALS:
            op = new OperationMineMinerals(name,manager,entry as RoomOperationProto);
            break;
        case OPERATION.MINE_POWER:
            op = new OperationMinePower(name,manager,entry as OperationMinePowerProto);
            break;
        case OPERATION.MINE_DEPOSIT:
            op = new OperationMineDeposit(name,manager,entry as OperationMineDepositProto);
            break;
        case OPERATION.COLONIZE_PORTAL:
            op = new ColonizePortal(name,manager,entry as FlagOperationProto);
            break;
            
        
    }
    return op;
}
