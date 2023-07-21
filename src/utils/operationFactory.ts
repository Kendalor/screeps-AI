import { Operation } from "empire/operations/Operation";
import { BuildOperation } from "empire/operations/economy/BuildOperation";
import { ClaimOperation } from "empire/operations/expansion/ClaimOperation";
import { ColonizeOperation } from "empire/operations/expansion/ColonizeOperation";
import { DefenseOperation } from "empire/operations/defense/DefenseOperation";
import { FlagListener } from "empire/operations/static/FlagListener";
import { FlagOperationProto } from "empire/operations/Operations/FlagOperation";
import { HaulerOperation } from "empire/operations/economy/HaulerOperation";
import { BaseProto, InitialRoomOperation } from "empire/operations/Operations/InitialBuildUpPhase/InitRoomOperation";
import { InitOperation } from "empire/operations/Operations/InitOperation";
import { OperationMineMinerals } from "empire/operations/economy/MineMInerals";
import { MinerOperation } from "empire/operations/economy/MinerOperation";
import { OperationMineDeposit, OperationMineDepositProto } from "empire/operations/economy/OperationMineDeposit";
import { OperationMinePower, OperationMinePowerProto } from "empire/operations/economy/OperationMinePower";
import { OperationScoutingManager } from "empire/operations/static/OperationScoutingManager";
import { RemoteMiningOperation } from "empire/operations/economy/RemoteMiningOperation";
import { RemoveInvaderOperation } from "empire/operations/defense/RemoveInvaderOperation";
import RepairOperation from "empire/operations/economy/RepairOperation";
import { RoomLogisticsOperation } from "empire/operations/economy/RoomLogisticsOperation";
import { RoomOperationProto } from "empire/operations/Operations/RoomOperation";
import { RoomPlannerOperation } from "empire/operations/Operations/roomPlanner/RoomPlannerOperation";
import SupplyOperation from "empire/operations/economy/SupplyOperation";
import { TradingOperation } from "empire/operations/static/TradingOperation";
import { UpgradeOperation } from "empire/operations/economy/UpgradeOperation";
import { OperationsManager } from "empire/OperationsManager";
import { ColonizePortal } from "empire/operations/expansion/ColonizePortal";
import { RemoteOperationProto, RemoteOperationData } from "empire/operations/Operations/RemoteOperation";



export function opFactory(name: string, manager: OperationsManager, entry: IOperationMemory): Operation | undefined{
    let op: Operation | undefined;
    switch(entry.type){
        case OPERATION.BASE:
            op = new InitialRoomOperation(name,manager,entry as BaseProto);
            break;
        case OPERATION.TRADING:
            op = new TradingOperation(name,manager,entry as IOperationMemory);
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
            op = new ColonizeOperation(name,manager,entry as FlagOperationProto);
            break;
        case OPERATION.INIT:
            op = new InitOperation(name,manager,entry as IOperationMemory);
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
            op = new FlagListener(name,manager,entry as IOperationMemory);
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
            op = new OperationScoutingManager(name,manager,entry as IOperationMemory);
            break;
        case OPERATION.REMOVEINVADER:
            op = new RemoveInvaderOperation(name,manager,entry as IOperationMemory);
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
