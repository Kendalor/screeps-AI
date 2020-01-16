import { OperationsManager } from "empire/OperationsManager";
import { Operation } from "../Operation";
import { OperationMemory } from "./OperationMemory";
import { RoomMemoryUtil } from "utils/RoomMemoryUtil";







/**
 * This Phase is Active preStorage after the first Spawn,
 * it should also activate if room is in decline and needs recovery. 
 */
export class RemoveInvaderOperation extends Operation{
    public numCreeps: number = 1;

    constructor(name: string, manager: OperationsManager, entry: OperationMemory) {
        super(name, manager,entry);
        this.type = "RemoveInvaderOperation";
    }


    public run() {
        
        this.validateCreeps();
        const r = Game.rooms[this.data.room];
        
        if(r != null){
            if(r.controller != null){
                if(r.controller.reservation != null){
                    if(r.controller.reservation.username !== 'Invader' && r.controller.reservation.username !== 'Kendalor'){
                        this.numCreeps = 2;
                    }
                }
            }
            this.cancelOp();
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
        this.enqueueCreeps();
    }

    public cancelOp(): void {
        const r = Game.rooms[this.data.room];
        if( r != null && r.controller != null && r.controller.my) {
            RoomMemoryUtil.setOwner(r);
            this.removeSelf();
        }
    }


    public enqueueCreeps(): void {
        if(this.data.creeps.length < this.numCreeps){
            const roomName = this.data.spawnRoom;
            if(roomName != null){
                for( let i=this.data.creeps.length; i< this.numCreeps; i++){
                    const name = this.manager.empire.spawnMgr.enque({
                        room: roomName,
                        body: undefined,
                        memory: {role: "RemoveInvader",targetRoom: this.data.room, op: this.name},
                        pause: 0,
                        priority: 72,
                        rebuild: false});
                    this.data.creeps.push(name);
                }
            } else {
                this.removeSelf();
            }
        }
    }


}