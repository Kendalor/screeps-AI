import { OperationsManager } from "empire/OperationsManager";
import { RoomMemoryUtil } from "utils/RoomMemoryUtil";
import { BuildOperation } from "../../economy/BuildOperation";
import { OperationMineMinerals } from "../../economy/MineMInerals";
import { MinerOperation } from "../../economy/MinerOperation";
import { RoomLogisticsOperation } from "../../economy/RoomLogisticsOperation";
import { RoomOperation, RoomOperationData, RoomOperationProto } from "../RoomOperation";
import { RoomPlannerOperation } from "../roomPlanner/RoomPlannerOperation";
import SupplyOperation from "../../economy/SupplyOperation";
import { UpgradeOperation } from "../../economy/UpgradeOperation";

export interface BaseProto extends RoomOperationProto {
    data: BaseData;
}

export interface BaseData extends RoomOperationData {
    children: Partial<Record<OPERATION,string>>;

}


export class InitialRoomOperation extends RoomOperation implements IInitialRoomOperation {
    private opList = [OPERATION.ROOMPLANNER, OPERATION.SUPPLY, OPERATION.BUILD, OPERATION.REPAIR,OPERATION.HAUL,OPERATION.UPGRADE,OPERATION.ROOMLOGISTICS, OPERATION.MINING, OPERATION.DEFEND, OPERATION.MINE_MINERALS];

    constructor(name: string,manager: OperationsManager, entry: BaseProto) {
        super(name,manager,entry);
        this.data = entry.data;
        this.type = OPERATION.BASE;
        this.priority = 99;
    }


    public setRoomPlanner(name: string){
        this.data.roomPlanner = name;
    }

    private enqueOps(): void {
        for(const i of this.opList){
            this.enqueRoomOp(i);
        }
    }

    private enqueRoomOp(t: OPERATION): void {
        if(this.data.children == null){
            this.data.children = {};
        }
        if(this.data.children[t] == null){
            this.data.children[t] = this.manager.enque({type: t, data: {parent: this.name, roomName: this.room.name},pause: 1});
        } else {
            if( !this.manager.entryExists(this.data.children[t])){
                delete this.data.children[t];
            }
        }
    }

    public cleanUpOps(): void {
        for(const type in this.data.children){
            if(!this.manager.entryExists(this.data.children[type])){
                delete this.data.children[type];
            }
        }
    }

    public enqueRemoteOp(t: OPERATION, targetRoom: string, flag?: Flag): string | undefined {
        let name;
        if(this.data.children == null){
            this.data.children = {};
        }
        if(this.data.children[t] == null){
            if(flag == null){
                name = this.manager.enque({type: t, data: {parent: this.name, roomName: this.room.name, remoteRoom: targetRoom},pause: 1});
            } else {
                name = this.manager.enque({type: t, data: {parent: this.name, roomName: this.room.name, remoteRoom: targetRoom, flag: flag.name},pause: 1});
            }
            this.data.children[t] = name;
        } else {
            if( !this.manager.entryExists(this.data.children[t])){
                delete this.data.children[t];
            }
        }
        return name;
    }

    public unpauseOps(): void{
        for(const type in this.data.children){
            const op = this.manager.getEntryByName(this.data.children[type]);
            if(op != null){
                if(op.pause !== 0){
                    op.pause = 0;
                }
            }
        }
    }

    private isRoomMy(){
        if(this.room.controller != null){
            if(this.room.controller.my === false){
                this.removeSelf();
            }
        }
    }

    private checkForControllerLevelChange(){
        if(this.room.controller != null){
            if(this.data.controllerLvl == null){
                this.data.controllerLvl = this.room.controller.level;
                this.unpauseOps();
            } else {
                if(!(this.data.controllerLvl === this.room.controller.level) ){
                    this.data.controllerLvl = this.room.controller.level;
                    this.unpauseOps();
                }
            }
        }
    }

    public run() {
        super.run();
        this.cleanUpOps();
        const r: Room = this.room;
        this.checkForEmergency();
        // Validate Op

        this.isRoomMy();


        this.enqueOps();

        // Validate creeps:
        this.validateCreeps();
        //this.colonize();
            
        this.checkForControllerLevelChange();

        this.exeCutePreStorageLogic();

    }

    private exeCutePreStorageLogic(){
        if(this.room.storage == null) {
            // console.log("Storage Null");
            // Calc Body and Number
            const energyCap = Math.min(Math.max(300,this.room.energyCapacityAvailable),2400);
            let body: BodyPartConstant[] = [];
            const fullSets = Math.min(Math.max(1, Math.floor(energyCap/250)), 4);
            for (let i = 0; i < fullSets; i++){
                body = body.concat([WORK,CARRY,MOVE,MOVE]);
            }
            const numCreeps = Math.ceil(10/fullSets)*2;
            console.log("NumCreeps: " + numCreeps);

            if(this.data.creeps.length < numCreeps){
                    const name = this.manager.empire.spawnMgr.enque({
                        body: body,
                        room: this.room.name,
                        memory: {role: "Maintenance", op: this.name},
                        pause: 0,
                        priority: 100,
                        rebuild: false});
                    console.log("Maintenance Enqueued Creep: " + name);
                    this.data.creeps.push(name);
            }
        }
    }

    private colonize(): void {
        //console.log("Should Colonize ?");
        if(Math.random() < 0.01){
            //console.log("Can Colonzie?");
            if(this.canColonize()){
                const room = RoomMemoryUtil.getNearestColonizeAbleRoom(this.room.name);
                console.log("Want to colonize Room: " + room);
                if( room != null){
                    this.createColonizeOperation(room);
                    RoomMemoryUtil.reserveRoom(room);
                }
            }
        }
    }

    private canColonize(): boolean {
        if(this.room.energyCapacityAvailable >= 650 && this.manager.empire.canColonize()){
            this.checkColonizeOperation();
            if(this.data.children[OPERATION.COLONIZE]== null){
                return true;
            }
        }
        return false;
    }

    private checkColonizeOperation(): void {
        if(this.data.children[OPERATION.COLONIZE] != null != null){
            if( !this.manager.entryExists(this.data.children[OPERATION.COLONIZE])){
                delete this.data.children[OPERATION.COLONIZE];
            }
        }
    }
    
    private createColonizeOperation(targetRoom: string): void {
        console.log("Create colonize op:");
        if(this.data.children[OPERATION.COLONIZE] != null){
            if( !this.manager.entryExists(this.data.children[OPERATION.COLONIZE])){
                console.log("Deleting old op");
                delete this.data.children[OPERATION.COLONIZE];
            }
        } else {
            this.data.children[OPERATION.COLONIZE] = this.manager.enque({type: OPERATION.COLONIZE, data: {roomName: this.room.name, parent: this.name, spawnRoom: this.room.name, remoteRoom: targetRoom},pause: 1});
        }
        
    }

    private checkForEmergency(): void {
        if(this.data.emergencyCounter == null){
            this.data.emergencyCounter = 0;
        }
        if(this.room.energyAvailable <= 300 ){
            this.data.emergencyCounter += 1; 
        } else if(this.room.energyAvailable >= this.room.energyCapacityAvailable -300) {
            this.data.emergencyCounter = 0;
        }
        if(this.data.emergencyCounter > 1000){
            Game.notify("Shard: " + Game.shard.name + " Room: " + this.room.name + " Emergency Couner: " + this.data.emergencyCounter);
            this.data.creepsMax = 10;
            this.validateCreeps();
            if(this.data.creepsMax > this.data.creeps.length){
                for(let j=0; j< this.data.creepsMax - (this.data.creeps.length); j++){
                    const name = this.manager.empire.spawnMgr.enque({
                        room: this.room.name,
                        memory: {role: "Maintenance", op: this.name},
                        pause: 0,
                        body: undefined,
                        priority: 101,
                        rebuild: false});
                    this.data.creeps.push(name);
                }
            }

        }
    }

    public getRoomPlannerOperation(): RoomPlannerOperation {
        if(this.data.children[OPERATION.ROOMPLANNER] != null){
            const op = this.manager.getEntryByName<RoomPlannerOperation>(this.data.children[OPERATION.ROOMPLANNER]);
            if( op != null){
                return op;
            }
        }
        this.enqueRoomOp(OPERATION.ROOMPLANNER);
        return this.getRoomPlannerOperation();
    }

    public getMiningOperation(): MinerOperation {
        if(this.data.children[OPERATION.MINING] != null){
            const op = this.manager.getEntryByName<MinerOperation>(this.data.children[OPERATION.MINING]);
            if( op != null){
                return op;
            }
        }
        this.enqueRoomOp(OPERATION.MINING)
        return this.getMiningOperation(); 
    }

    public getBuildingList(): BuildEntry[] {
        //onsole.log("Get Complete BuildingsList for room: " + this.room.name);
        const out = super.getBuildingList();
        this.getRoomPlannerOperation().updateBuildingCostMatrix(out);
        const miningOp = this.getMiningOperation().getBuildingList();
        this.getRoomPlannerOperation().updateBuildingCostMatrix(miningOp);
        const upgrade = this.getUpgradeOperation().getBuildingList();
        this.getRoomPlannerOperation().updateBuildingCostMatrix(upgrade);
        const mineral = this.getMineMineralOperation().getBuildingList();
        this.getRoomPlannerOperation().updateBuildingCostMatrix(mineral);
        return out.concat(miningOp).concat(upgrade).concat(mineral);
    }

    public getMineMineralOperation(): OperationMineMinerals {
        if(this.data.children[OPERATION.MINE_MINERALS] != null){
            const op = this.manager.getEntryByName<OperationMineMinerals>(this.data.children[OPERATION.MINE_MINERALS]);
            if( op != null){
                return op;
            }
        }
        this.enqueRoomOp(OPERATION.MINE_MINERALS)
        return this.getMineMineralOperation(); 
    }


    public getSupplyOperation(): SupplyOperation {
        if(this.data.children[OPERATION.SUPPLY] != null){
            const op = this.manager.getEntryByName<SupplyOperation>(this.data.children[OPERATION.SUPPLY]);
            if( op != null){
                return op;
            }
        } 
        this.enqueRoomOp(OPERATION.SUPPLY)
        return this.getSupplyOperation(); 

    }

    public getRoomLogisticsOperation(): RoomLogisticsOperation {
        if(this.data.children[OPERATION.ROOMLOGISTICS] != null){
            const op = this.manager.getEntryByName<RoomLogisticsOperation>(this.data.children[OPERATION.ROOMLOGISTICS]);
            if( op != null){
                return op;
            }
        }
        this.enqueRoomOp(OPERATION.ROOMLOGISTICS);
        return this.getRoomLogisticsOperation(); 
    }



    public getBuildOperation(): BuildOperation {
        if(this.data.children[OPERATION.BUILD] != null){
            const op = this.manager.getEntryByName<BuildOperation>(this.data.children[OPERATION.BUILD]);
            if( op != null){
                return op;
            }
        }
        this.enqueRoomOp(OPERATION.BUILD);
        return this.getBuildOperation(); 
    }


    public getUpgradeOperation(): UpgradeOperation {
        if(this.data.children[OPERATION.UPGRADE] != null){
            const op = this.manager.getEntryByName<UpgradeOperation>(this.data.children[OPERATION.UPGRADE]);
            if( op != null){
                return op;
            }
        }
        this.enqueRoomOp(OPERATION.UPGRADE)
        return this.getUpgradeOperation(); 
    }


}