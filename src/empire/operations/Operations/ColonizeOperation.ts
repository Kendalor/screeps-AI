import { OperationsManager } from "empire/OperationsManager";
import { Operation } from "../Operation";
import { FlagOperation } from "./FlagOperation";
import { OperationMemory } from "./OperationMemory";
import { RoomOperation } from "./RoomOperation";
import { RoomMemoryUtil } from "utils/RoomMemoryUtil";







/**
 * This Phase is Active preStorage after the first Spawn,
 * it should also activate if room is in decline and needs recovery. 
 */
export class ColonizeOperation extends Operation{
    public numCreeps: number = 6;

    constructor(name: string, manager: OperationsManager, entry: OperationMemory) {
        super(name, manager,entry);
        this.type = "ColonizeOperation";
    }



    public run() {
        super.run();
        this.validateCreeps();
        this.enqueueCreeps();
        


        const r = Game.rooms[this.data.room];
        if(r != null){
            if( r != null){
                if(r.controller != null){
                    if(r.controller.reservation != null){
                        if(r.controller.reservation.username !== 'Kendalor'){
                            if(this.data.cancelCounter != null){
                                this.data.cancelCounter = this.data.cancelCounter +1;
                                if(this.data.cancelCounter > 1000){
                                    this.wrapUp(r);
                                }
                            } else {
                                this.data.cancelCounter = 0;
                            }
                        }
                    } else {
                        if(r.controller.my ){
                            this.initialCleanup();
                            if(this.data.roomPlanner == null){
                                this.data.roomPlanner = this.manager.enque({type: "RoomPlannerOperation", data: {roomName: r.name, parent: this.name}, priority: 20, pause: 1});
                            }
                        }
                    }

                }
                this.wrapUp(r);
            }
        } else {
            if(this.data.claim == null){
                const r = Game.rooms[this.data.room];
                if( r == null){
                    this.checkClaimOperation();
                } else {
                    if(r.controller != null){
                        if(r.controller.my !== true){
                            this.checkClaimOperation();
                        }
                    }
                }
                
            }
        }
    }

    private wrapUp(r: Room): void {
        if(r.storage != null && r.storage.my){
            this.manager.enque({type: "InitialRoomOperation", data: {roomName: r.name}, priority: 100,pause: 1});
            for(const creep of this.data.creeps){
                if(Game.creeps[creep] != null){
                    Game.creeps[creep].memory.role = "Maintenance";
                } else {
                    this.manager.empire.spawnMgr.dequeueByName(creep);
                }
            }
            RoomMemoryUtil.setOwner(this.data.room);
            this.removeSelf();
        }
        if(Game.time % 1000 === 0){
            if(RoomMemoryUtil.getDistance(this.data.spawnRoom, this.data.room) > 10){
                this.removeSelf();
                for(const creep of this.data.creeps){
                    if(Game.creeps[creep] != null){
                        Game.creeps[creep].memory.role = "Maintenance";
                    } else {
                        this.manager.empire.spawnMgr.dequeueByName(creep);
                    }
                }
                RoomMemoryUtil.setOwner(this.data.room);
            }
        }
        if(this.data.parent != null){
            const parent = this.manager.getEntryByName(this.data.parent);
            if(parent == null){
                this.removeSelf();
                for(const creep of this.data.creeps){
                    if(Game.creeps[creep] != null){
                        Game.creeps[creep].memory.role = "Maintenance";
                    } else {
                        this.manager.empire.spawnMgr.dequeueByName(creep);
                    }
                }
                RoomMemoryUtil.setOwner(this.data.room);
            }
        }
        if(this.data.cancelCounter > 1000){
            this.removeSelf();
            for(const creep of this.data.creeps){
                if(Game.creeps[creep] != null){
                    Game.creeps[creep].memory.role = "Maintenance";
                } else {
                    this.manager.empire.spawnMgr.dequeueByName(creep);
                }
            }
            RoomMemoryUtil.setOwner(this.data.room);
        }
    }

    private initialCleanup(): void {
        if(this.data.initialCleanup !== true){
            const r = Game.rooms[this.data.room];
            if(r != null){
                const structs = r.find(FIND_STRUCTURES);
                if( structs.length > 0){
                    for(const i of structs){
                        i.destroy();
                    }
                    this.data.initialCleanup = true;
                } 
            }
        }
    }

    private checkClaimOperation(): void {
        if(this.data.claim == null){
            this.createClaimOperation();
        } else {
            if( !this.manager.entryExists(this.data.claim )){
                this.data.colonize = null;
            }
        }
    }
    private createClaimOperation(): void {
        console.log("Create ClaimOperation");
        this.data.claim = this.manager.enque({type: "ClaimOperation", data: {room: this.data.room, spawnRoom: this.data.spawnRoom, parent: this.name}, priority: 51,pause: 1});
    }

    private enqueueCreeps(): void {
        if(this.data.creeps.length < this.numCreeps){
            const roomName = this.data.spawnRoom;
            if(roomName != null){
                for( let i=this.data.creeps.length; i< this.numCreeps; i++){
                    const name = this.manager.empire.spawnMgr.enque({
                        room: roomName,
                        body: undefined,
                        memory: {role: "Colonize",targetRoom: this.data.room, op: this.name},
                        pause: 0,
                        priority: 20,
                        rebuild: false});
                    this.data.creeps.push(name);
                }
            } else {
                this.removeSelf();
            }
        }
    }


}