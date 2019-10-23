import { Job } from "./Job";

export class Renew extends Job {

    public static run(creep: Creep): void {
        super.run(creep);
        const target = Game.getObjectById(creep.memory.targetId) as StructureSpawn;
        if(target != null){
            if(creep.pos.inRangeTo(target,1 )){
                const err = target.renewCreep(creep);
                if( err !== OK){
                    this.cancel(creep);
                }
            } else {
                creep.moveTo(target);
            }
        } else {
            this.cancel(creep);
        }

    }


    public static runCondition(creep: Creep): boolean {
        if(creep.spawning){
            return false;
        } else {
            return creep.ticksToLive != null && creep.ticksToLive <= 100 
        }

    }

    public static getTargetId(creep: Creep): string | null {
        const targets = creep.room.find(FIND_MY_SPAWNS).filter( (str) => str.spawning === null && str.energy > 0);
        if(targets.length > 0){
            const target = creep.pos.findClosestByPath(targets);
            if(target != null){
                return target.id;
            }
        }
        return null;
    }
}