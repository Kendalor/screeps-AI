import { Harvest } from "./Harvest";

export class Mine extends Harvest {

    public static run(creep: Creep): void {
        // SETUP HAS SOURCE ID, HAS CONTAINER ID


        // IS HARVEST CREEP AND ENERGY NOT FULL and HAS SOURCE
        if(creep.carry.energy < creep.carryCapacity){
            // JOB EXECUTION
            const source: Source | null = Game.getObjectById(creep.memory.targetId);
            if( source !== null ){
                console.log("Source not null");
                if(creep.inRangeTo(source,1)) {
                    if (source.energy){
                        creep.harvest(source);
                    }
                }else{
                    creep.moveTo(source);
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
        return creep.carry.energy < creep.carryCapacity;
    }

    public static getTargetId(creep: Creep): string | null {
        if( creep.memory.sourceId !== null || creep.memory.sourceId !== undefined ){
            return super.getTargetId(creep);
        } else {
            return creep.memory.sourceId;
        }
    }
}