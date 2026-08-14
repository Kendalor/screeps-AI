import { Job } from "./Job";

export class DoNotBlockStuff extends Job {

    public static run(creep: Creep): void {
        super.run(creep);

       if(creep.room.storage != null){
           const anchor = new RoomPosition(creep.room.storage.pos.x-1, creep.room.storage.pos.y, creep.room.name);
           if(creep.pos.getRangeTo(anchor) < 7){
               creep.travelTo(new RoomPosition(anchor.x-7, anchor.y-1, creep.room.name));
           } else {
               this.cancel(creep);
           }
       }  else {
        const spawn = creep.pos.findInRange(FIND_MY_SPAWNS,6).pop();
        if(spawn != null){
            if(creep.pos.getRangeTo(spawn) < 7){
                creep.travelTo(new RoomPosition(spawn.pos.x-7, spawn.pos.y-1, creep.room.name));
            } else {
                this.cancel(creep);
            }
        } 
       }       
    }


    public static runCondition(creep: Creep): boolean {
        return creep.room.storage!= null || creep.pos.findInRange(FIND_MY_SPAWNS,1).pop() != null;
    }

    public static getTargetId(creep: Creep): string | null {
        return "";
    }
}