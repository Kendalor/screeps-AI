import { RoomMemoryUtil } from "utils/RoomMemoryUtil";
import { Job } from "./Job";


export class GoToTargetRoom extends Job {

    public static run(creep: Creep): void {
        super.run(creep);

        if(creep.memory.targetRoom != null){
            if(creep.room.name !== creep.memory.targetRoom){
                this.travel2(creep);
            }else {
                this.leaveBorder(creep);
                this.cancel(creep);
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
    public static travel2(creep: Creep): void {
        if(creep.memory.route == null){
            creep.memory.route = RoomMemoryUtil.getRoute(creep.room.name, creep.memory.targetRoom);
        } else {
            if(creep.memory.route.length > 0){
                if(creep.room.name === creep.memory.route[0].room){
                    creep.memory.route.shift();
                }
                if(creep.memory.route.length > 0){
                    const target = new RoomPosition(25,25,creep.memory.route[0].room);
    
    
                        if(target != null){
                            const r =creep.travelTo(target);
                        }
                        if(creep.room.name === creep.memory.route[0].room){
                            creep.memory.route.shift();
                            RoomMemoryUtil.setLastSeen(creep.room);
                        }
                    }

            } else {
                creep.memory.route = null;
                this.leaveBorder(creep);
            }
        }
    }

    public static runCondition(creep: Creep): boolean {
        return creep.memory.targetRoom != null && creep.memory.targetRoom !== creep.room.name;
    }

    public static getTargetId(creep: Creep): string | null {
        return "";
    }




}