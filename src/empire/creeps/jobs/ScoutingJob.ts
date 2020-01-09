import { OperationScoutingManager } from "empire/operations/Operations/OperationScoutingManager";
import { RoomMemoryUtil } from "utils/RoomMemoryUtil";
import { Job } from "./Job";


export class ScoutingJob extends Job {

    public static run(creep: Creep): void {
        super.run(creep);

        const op =global.empire.opMgr.getEntryByName<OperationScoutingManager>(creep.memory.op);
        if(op != null){
            console.log("Op != null");
            if(creep.memory.targetRoom != null){ // RoomName
                console.log("Creep has TargetRoom:" + creep.memory.targetRoom);
                if(creep.room.name !== creep.memory.targetRoom){
                    console.log("Creep Not in TargetRoom: "+ creep.memory.targetRoom);
                    const exitDir = Game.map.findExit(creep.room, creep.memory.targetRoom);
                    if(exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS){
                        const exit = creep.pos.findClosestByRange(exitDir);
                        if(exit != null){
                            console.log("Creep Move to Exit: "+ creep.memory.targetRoom);
                            creep.moveTo(exit, {reusePath: 50} ); 
                        }
                    }
                } else {
                    console.log("Creep in TargetRoom");
                    if(RoomMemoryUtil.checkIfRoomNeedsScouting(creep.memory.targetRoom)){
                        RoomMemoryUtil.setRoomMemory(creep.room);
                    } else {
                        creep.memory.targetRoom = null;
                        op.wakeup();
                    }
                }
            } else {
                creep.memory.targetRoom = op.getNearestTodo(creep.room.name);
            }
        }

    }

    public static runCondition(creep: Creep): boolean {
        return true;
    }

    public static getTargetId(creep: Creep): string | null {
        return "";
    }




}