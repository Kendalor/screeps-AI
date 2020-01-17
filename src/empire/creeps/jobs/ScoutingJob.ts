import { OperationScoutingManager } from "empire/operations/Operations/OperationScoutingManager";
import { RoomMemoryUtil } from "utils/RoomMemoryUtil";
import { Job } from "./Job";


export class ScoutingJob extends Job {

    public static run(creep: Creep): void {
        super.run(creep);

        const op =global.empire.opMgr.getEntryByName<OperationScoutingManager>(creep.memory.op);
        if(op != null){
            if(creep.memory.targetRoom != null){ // RoomName
                if(creep.room.name !== creep.memory.targetRoom){
                    creep.travelTo(new RoomPosition( 25,25,creep.memory.targetRoom), {range: 20});
                } else {
                    this.leaveBorder(creep);
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


    public static leaveBorder(creep: Creep): void {
        const x = creep.pos.x;
        const y = creep.pos.y;
        if( y === 0 ){
            creep.move(BOTTOM);
        } else if( y === 49){
            creep.move(TOP);
        }else if( x === 49){
            creep.move(LEFT)
        }else if(x === 0){
            creep.move(RIGHT);
        }

    }


    public static runCondition(creep: Creep): boolean {
        return true;
    }

    public static getTargetId(creep: Creep): string | null {
        return "";
    }




}