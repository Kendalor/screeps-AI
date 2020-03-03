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
                    const t = Game.cpu.getUsed();
                    if(Game.time % 20 === 0){
                        if(RoomMemoryUtil.checkIfRoomNeedsScouting(creep.room.name)){
                            RoomMemoryUtil.setRoomMemory(creep.room);
                            op.setChanged(true);
                        }
                    }
                    
                    const code =creep.travelTo(new RoomPosition( 25,25,creep.memory.targetRoom), {range: 15});
                    if(creep.memory.antistuck == null){
                        creep.memory.antistuck = { target: "", counter: 0};
                    } else {
                        if(creep.memory.antistuck.target === creep.memory.targetRoom){
                            creep.memory.antistuck.counter = creep.memory.antistuck.counter+1;
                            if(creep.memory.antistuck.counter > 1000){
                                RoomMemoryUtil.skipRoom(creep.memory.targetRoom);
                                op.setChanged(true);
                                creep.memory.targetRoom = null;
                                creep.memory.path = null;
                            }
                        } else {
                            creep.memory.antistuck.counter = 0;
                            creep.memory.antistuck.target = creep.memory.targetRoom;
                        }
                    }
                    

                    // TODO:  Temporary NewbieRoom Fix, would like a more elegant Solution for this
                    // if(creep.memory._trav != null){
                    //     if(creep.memory._trav.state != null){
                    //         if(creep.memory._trav.state[3] > 2000){
                    //             console.log("Scout: " + creep.name + " skipped Room: " + creep.memory.targetRoom);
                    //             RoomMemoryUtil.skipRoom(creep.memory.targetRoom);
                    //             op.setChanged(true);
                    //             creep.memory.targetRoom = null;
                    //             creep.memory.path = null;

                    //         }
                    //     }
                    // }
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
                console.log("Scout: " + creep.name + " got new Target with Distance: " + Game.map.getRoomLinearDistance(creep.room.name, creep.memory.targetRoom));
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