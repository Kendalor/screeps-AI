import { OperationsManager } from "empire/OperationsManager";
import { RoomMemoryUtil } from "utils/RoomMemoryUtil";
import { Operation } from "../Operation";
import { FlagOperation, FlagOperationProto } from "../Operations/FlagOperation";
import { RemoteOperationProto } from "../Operations/RemoteOperation";







/**
 * This Phase is Active preStorage after the first Spawn,
 * it should also activate if room is in decline and needs recovery. 
 */
export class ColonizePortal extends FlagOperation{
    public numCreeps: number = 1;

    constructor(name: string, manager: OperationsManager, entry: FlagOperationProto) {
        super(name, manager,entry);
        this.type = OPERATION.COLONIZE_PORTAL;
        this.priority=28;
    }



    public run() {
        console.log("COlonize Portal");
        if(this.flag != null){

            this.validateCreeps();

            this.enqueueCreeps();
        }


        super.run();
    }



    private enqueueCreeps(): void {
        if(this.data.creeps.length < this.numCreeps){
            const roomName = this.room.name;
            console.log("Colonize: enque creeps with roomname: " + this.room.name);
            if(roomName != null){
                for( let i=this.data.creeps.length; i< this.numCreeps; i++){
                    const name = this.manager.empire.spawnMgr.enque({
                        room: roomName,
                        body: undefined,
                        memory: {role: "Colonize",targetRoom: this.data.flag == null ? this.data.remoteRoom : undefined, homeRoom: this.room.name, op: this.name,flag: this.data.flag},
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