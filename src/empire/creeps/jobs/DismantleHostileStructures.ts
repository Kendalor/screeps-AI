import { Attack } from "./Attack";

export class DismantleHostileStructures extends Attack {

    public static run(creep: Creep): void {
        super.run(creep);
        // RUN LOGIC 
        const target: Structure | null= Game.getObjectById(creep.memory.targetId);
        // RUN CONDITIONS + HAS TARGET
        // JOB CANCEL CONDITIONS
        if((target == null)){
            this.cancel(creep);
        } else {
            if(creep.pos.inRangeTo(target,3)){
                const err = creep.dismantle(target);
                if(err === ERR_INVALID_TARGET){
                    // TARGET INVALID => Target is Already Built or Destroyed
                    this.cancel(creep);
                }
            }else{
                creep.travelTo(target, {range: 1});
            }

        }

        // JOB CANCEL CONDITIONS
        if((target == null || creep.carry.energy === 0)){
            this.cancel(creep);
        }
    }


    public static runCondition(creep: Creep): boolean {
        return creep.getActiveBodyparts(WORK) > 0;
    }

    public static getTargetId(creep: Creep): string | null {
        const targets = creep.room.find(FIND_HOSTILE_STRUCTURES);
        if(targets.length > 0){
            const target = creep.pos.findClosestByPath(targets);
            if(target != null){
                return target.id;
            }
        }
        return null;
    }

}