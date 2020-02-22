import { OperationsManager } from "empire/OperationsManager";
import { OPERATION, OperationMemory } from "utils/constants";
import { RoomMemoryUtil } from "utils/RoomMemoryUtil";
import { Operation } from "../Operation";







/**
 * This Phase is Active preStorage after the first Spawn,
 * it should also activate if room is in decline and needs recovery. 
 */
export class ClaimOperation extends Operation{
    public numCreeps: number = 1;

    constructor(name: string, manager: OperationsManager, entry: OperationMemory) {
        super(name, manager,entry);
        this.type = OPERATION.CLAIM;
        this.priority=29;
    }


    public run() {
        
        this.validateCreeps();
        const r = Game.rooms[this.data.room];
        if(r != null){
            this.cancelOp();
            this.enqueueCreeps();
            this.removeInvader();
        }
        super.run();
    }

    public cancelOp(): void {
        const r = Game.rooms[this.data.room];
        if( r != null && r.controller != null && r.controller.my) {
            RoomMemoryUtil.setOwner(r);
            this.removeSelf();
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
            }
        }
    }

    public removeInvader(): void {
        const r = Game.rooms[this.data.room];
        if(r != null){
            if(r.controller != null){
                if(r.controller.reservation != null){
                    if(r.controller.reservation.username !== 'Kendalor'){
                        this.checkKillInvaderOperation();
                    } 
                }
            }

        }
    }

    private checkKillInvaderOperation(): void {
        if(this.data.killInvader == null){
            this.createKillInvaderOperation();
        } else {
            if( !this.manager.entryExists(this.data.killInvader)){
                this.data.killInvader = null;
            }
        }
    }
    private createKillInvaderOperation(): void {
        this.data.killInvader = this.manager.enque({type: OPERATION.REMOVEINVADER, data: {room: this.data.room, spawnRoom: this.data.spawnRoom, parent: this.name},pause: 1});
    }

    public enqueueCreeps(): void {
        if(this.data.creeps.length < this.numCreeps){
            const roomName = this.data.spawnRoom;
            if(roomName != null){
                for( let i=this.data.creeps.length; i< this.numCreeps; i++){
                    const name = this.manager.empire.spawnMgr.enque({
                        room: roomName,
                        body: undefined,
                        memory: {role: "Claimer",targetRoom: this.data.room, op: this.name},
                        pause: 0,
                        priority: 71,
                        rebuild: false});
                    this.data.creeps.push(name);
                }
            } else {
                this.removeSelf();
            }
        }
    }


}