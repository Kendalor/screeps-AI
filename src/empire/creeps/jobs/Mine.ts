import { Job } from "./Job";

export class Mine extends Job {

    public static run(creep: Creep): void {
        super.run(creep);

        if(creep.carry.energy < creep.carryCapacity){
            const source: Source | null = Game.getObjectById<Source>(creep.memory.targetId);
            if( source !== null ){
                
                if(creep.pos.inRangeTo(source,1)) {
                    if (source.energy){
                        creep.harvest(source);
                    }
                }else{
                    creep.travelTo(source, {ignoreCreeps: true});
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
        if( creep.memory.sourceId != null ){
            return creep.memory.sourceId;  
        } else {
            return super.getTargetId(creep);
        }
    }
}