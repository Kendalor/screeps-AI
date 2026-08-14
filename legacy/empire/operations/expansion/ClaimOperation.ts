import { OperationsManager } from "empire/OperationsManager";
import { RoomMemoryUtil } from "utils/RoomMemoryUtil";
import { Operation } from "../Operation";
import { FlagOperation, FlagOperationProto } from "../Operations/FlagOperation";







/**
 * This Phase is Active preStorage after the first Spawn,
 * it should also activate if room is in decline and needs recovery. 
 */
export class ClaimOperation extends FlagOperation{
    public numCreeps: number = 1;

    constructor(name: string, manager: OperationsManager, entry: FlagOperationProto) {
        super(name, manager,entry);
        this.type = OPERATION.CLAIM;
        this.priority=29;
    }


    public run() {
        super.run();
        if(this.flag != null && this.room != null){
            this.validateCreeps();
            const r = Game.rooms[this.data.room];
            this.enqueueCreeps();
            if(this.remoteRoom){
                this.cancelOp();
                this.enqueueCreeps();
                this.removeInvader();
            }
        }
    }

    public cancelOp(): void {
        if( this.remoteRoom && this.remoteRoom.controller != null && this.remoteRoom.controller.my) {
            RoomMemoryUtil.setOwner(this.remoteRoom);
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
        if(this.remoteRoom){
            if(this.remoteRoom.controller != null){
                if(this.remoteRoom.controller.reservation != null){
                    if(this.remoteRoom.controller.reservation.username !== 'Kendalor'){
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
            const roomName = this.room.name;
            if(roomName != null){
                for( let i=this.data.creeps.length; i< this.numCreeps; i++){
                    const name = this.manager.empire.spawnMgr.enque({
                        room: roomName,
                        body: [CLAIM,MOVE,MOVE,MOVE,MOVE,MOVE],
                        memory: {role: "Claimer",targetRoom: this.remoteRoomName, homeRoom: this.room.name, op: this.name,flag: this.data.flag},
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