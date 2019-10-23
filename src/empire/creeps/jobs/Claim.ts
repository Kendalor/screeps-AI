import { Job } from "./Job";

export class Claim extends Job {

    public static run(creep: Creep): void {
        super.run(creep);
        const target: StructureController | null = Game.getObjectById(creep.memory.targetId) as StructureController;
        if(target != null){
            if(creep.pos.inRangeTo(target,1)){
                creep.claimController(target);
            } else {
                creep.moveTo(target);
            }
        } else {
            this.cancel(creep);
        }
    }

    public static runCondition(creep: Creep): boolean {
        return creep.room.controller != null && creep.room.controller.level === 0;
    }

    public static getTargetId(creep: Creep): string | null {
        if(creep.room.controller != null){
            if(creep.room.controller.my === false){
                if(creep.room.controller.level === 0){
                    return creep.room.controller.id;
                }
            }
        }
        return null;
    }
}