import { Operation } from "empire/operations/Operation";
import { OperationsManager } from "empire/OperationsManager";
import { OperationMemory } from "../OperationMemory";






/**
 * This Phase is Active preStorage after the first Spawn,
 * it should also activate if room is in decline and needs recovery. 
 */
export class InitialRoomOperation extends Operation{
    

    constructor(manager: OperationsManager, entry: OperationMemory) {
        super(manager,entry);
        this.type = "InitialRoomOperation";
    }

    public run() {
        super.run();
        const r: Room = Game.rooms[this.data.roomName];

        // Validate Op


        if(r != null){
            // Add Missing RoomOps
            if(r. storage != null){
                if(this.data.supply == null){
                    this.data.supply = this.manager.enque({type: "SupplyOperation", data: {roomName: r.name}, priority: 80,pause: 1, lastRun: false});
                } else {
                    if( !this.manager.entryExists(this.data.supply)){
                        this.data.supply = null;
                    }
                }
                if(this.data.build == null){
                    this.data.build = this.manager.enque({type: "BuildOperation", data: {roomName: r.name}, priority: 60,pause: 1, lastRun: false});
                } else {
                    if( !this.manager.entryExists(this.data.build)){
                        this.data.build = null;
                    }
                }
                if(this.data.repair == null){
                    this.data.repair = this.manager.enque({type: "RepairOperation", data: {roomName: r.name}, priority: 65,pause: 1, lastRun: false});  
                } else {
                    if( !this.manager.entryExists(this.data.repair)){
                        this.data.repair = null;
                    }
                }
                if(this.data.haul == null ){
                    this.data.haul = this.manager.enque({type: "HaulerOperation", data: {roomName: r.name}, priority: 89,pause: 1, lastRun: false});
                } else {
                    if( !this.manager.entryExists(this.data.haul)){
                        this.data.haul = null;
                    }
                }
                if( this.data.upgrade == null){
                    this.data.upgrade = this.manager.enque({type: "UpgradeOperation", data: {roomName: r.name}, priority: 70,pause: 1,lastRun: false});
                } else {
                    if( !this.manager.entryExists(this.data.upgrade)){
                        this.data.upgrade = null;
                    }
                }
            }
            if(r.controller!.level >= 3){
                if(this.data.mine == null ){
                    this.data.mine = this.manager.enque({type: "MinerOperation", data: {roomName: r.name}, priority: 90,pause: 1, lastRun: false});
                } else {
                    if( !this.manager.entryExists(this.data.mine)){
                        this.data.mine = null;
                    }
                }
                if(this.data.defense == null){
                    this.data.defense = this.manager.enque({ type: "DefenseOperation", data: {roomName: r.name}, priority: 91,pause: 1, lastRun: false});
                } else {
                    if( !this.manager.entryExists(this.data.defense)){
                        this.data.defense = null;
                    }
                }
            }

            // Validate creeps:
            this.validateCreeps();

            if(r.storage == null) {
                if(this.data.creeps.length < 6){
                    if(r.find(FIND_MY_CREEPS).length === 0){
                        const name = this.manager.empire.spawnMgr.enque({
                            room: r.name,
                            memory: {role: "Maintenance"},
                            pause: 0,
                            priority: 100,
                            rebuild: false});
                        this.data.creeps.push(name);
                    }
                }
            } else {
                if(this.data.creeps.length === 0){
                    if(r.find(FIND_MY_CREEPS).length === 0){
                        const name = this.manager.empire.spawnMgr.enque({
                            room: r.name,
                            memory: {role: "Maintenance"},
                            pause: 0,
                            priority: 100,
                            rebuild: false});
                        this.data.creeps.push(name);
                    }
                }
            }
        }

    }

}