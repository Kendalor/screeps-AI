import { Job } from "./Job";

/**
 *  Harvest Energy from ANY Source with nearest Path
 */
export class Harvest extends Job{


    public static run(creep: Creep): void {
        super.run(creep);
        // IS HARVEST CREEP AND ENERGY NOT FULL and HAS SOURCE
        if(creep.carry.energy < creep.carryCapacity){
            // JOB EXECUTION
            const source: Source | null = Game.getObjectById(creep.memory.targetId);
            if( source != null && source.energy > 0){
                if(creep.pos.inRangeTo(source,1)) {
                    if (source.energy > 0){
                        creep.harvest(source);
                    }
                }else{
                    creep.travelTo(source);
                }
            } else {
                this.cancel(creep);
            }

        }

        // CANCEL CONDITION
        if(creep.carry.energy === creep.carryCapacity){
            this.cancel(creep);
        }
    }

    public static runCondition(creep: Creep): boolean {
        return creep.store.getFreeCapacity() > 0;
    }

    public static getTargetId(creep: Creep): string | null {
        const sources = creep.room.find(FIND_SOURCES).filter(
            (src) => src.energy > 0
        ); 
        const source = creep.pos.findClosestByPath(sources, {ignoreCreeps: false});
        // Found Harvest Target ?
        if (source !== null) {
            return source.id
        } else {
            return null
        }
    }


}
