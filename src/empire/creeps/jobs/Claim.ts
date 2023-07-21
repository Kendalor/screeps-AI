import { Job } from "./Job";

export class Claim extends Job {

    public static run(creep: Creep): void {
        super.run(creep);
        const target: StructureController | null = Game.getObjectById(creep.memory.targetId) as StructureController;
        if(target != null){
            if(creep.pos.inRangeTo(target,1)){
                if(target.reservation == null){
                    creep.claimController(target);
                }else {
                    creep.attackController(target);
                }
                
            } else {
                creep.travelTo(target);
            }
        } else {
            this.cancel(creep);
        }
    }

    public static runCondition(creep: Creep): boolean {
        return creep.room.controller != null && creep.room.controller.level === 0 && creep.room.name === creep.memory.targetRoom;
    }

    public static getTargetId(creep: Creep): string | null {
        console.log("GET TARGET CLAIM: " + creep.room.name);
        if(creep.room.controller != null){
            if(!creep.room.controller.owner){
                return creep.room.controller.id;
            }
        }
        return null;
    }
}