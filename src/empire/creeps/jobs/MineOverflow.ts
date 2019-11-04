import { Job } from "./Job";

export class MineOverflow extends Job {
    // ETERNAL JOB DOES NOT CANCEL 
    public static run(creep: Creep): void {
        super.run(creep);
        const source: Source | null = Game.getObjectById(creep.memory.targetId);
        if( source != null ){
            if(creep.pos.inRangeTo(source,1)) {
                if (source.energy){
                    creep.harvest(source);
                }
            }else{
                creep.moveTo(source, {ignoreCreeps: true, range: 1});
            }
        }
    }

    public static runCondition(creep: Creep): boolean {
        return creep.memory.sourceId != null;
    }

    public static getTargetId(creep: Creep): string | null {
        if( creep.memory.sourceId != null  ){
            return creep.memory.sourceId;   
        }
        return null;
    }
}