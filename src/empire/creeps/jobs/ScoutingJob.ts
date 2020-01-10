import { OperationScoutingManager } from "empire/operations/Operations/OperationScoutingManager";
import { RoomMemoryUtil } from "utils/RoomMemoryUtil";
import { Job } from "./Job";


export class ScoutingJob extends Job {

    public static run(creep: Creep): void {
        super.run(creep);

        const op =global.empire.opMgr.getEntryByName<OperationScoutingManager>(creep.memory.op);
        if(op != null){
            if(creep.memory.targetRoom != null){ // RoomName
                console.log("Creep: " + creep.name + " is in Room: " + creep.room.name);
                if(creep.room.name !== creep.memory.targetRoom){
                    console.log("Creep: " + creep.name + " is not in TargetRoom: " + creep.memory.targetRoom );
                    // const targetPos =new RoomPosition(25,25,creep.memory.targetRoom);
                    this.travel(creep);
                } else {
                    if(RoomMemoryUtil.checkIfRoomNeedsScouting(creep.memory.targetRoom)){
                        RoomMemoryUtil.setRoomMemory(creep.room);
                        op.setChanged(true);
                    } else {
                        creep.memory.targetRoom = null;
                        creep.memory.path = null;
                        
                    }
                }
            } else {
                creep.memory.targetRoom = op.getNearestTodo(creep.room.name);
            }
        }

    }

    public static travel(creep: Creep): void {
        if(creep.memory.path != null && creep.memory.path.length > 0  ){
            console.log(creep.memory.path.length);
            const target = creep.memory.path.shift() as RoomPosition;
            console.log("target: " + JSON.stringify(target));
            const direction = creep.pos.getDirectionTo(new RoomPosition(target.x,target.y,target.roomName));
            console.log( "Direction: " + direction);
            const err = creep.move(direction);

        
            console.log("Creep: " + creep.name+ " in Room: " + creep.room.name + " Code: " + err);
        } else {
            const targetPos =new RoomPosition(25,25,creep.memory.targetRoom);
            creep.memory.path = RoomMemoryUtil.findPath(creep.pos,targetPos);
        }
    }

    public static runCondition(creep: Creep): boolean {
        return true;
    }

    public static getTargetId(creep: Creep): string | null {
        return "";
    }




}