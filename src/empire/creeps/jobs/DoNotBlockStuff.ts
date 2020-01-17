import { Job } from "./Job";

export class DoNotBlockStuff extends Job {

    public static run(creep: Creep): void {
        super.run(creep);

       if(creep.room.storage != null){
           const anchor = new RoomPosition(creep.room.storage.pos.x-1, creep.room.storage.pos.y, creep.room.name);
           if(creep.pos.getRangeTo(anchor) < 6){
               creep.travelTo(new RoomPosition(anchor.x-6, anchor.y-1, creep.room.name));
           } else {
               this.cancel(creep);
           }
       } 
    }


    public static runCondition(creep: Creep): boolean {
        return creep.room.storage!= null;
    }

    public static getTargetId(creep: Creep): string | null {
        return "";
    }
}