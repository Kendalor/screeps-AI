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
                creep.travelTo(source, {ignoreCreeps: false, range: 1});
            }
        }
    }

    public static runCondition(creep: Creep): boolean {
        if(creep.memory.sourceId != null){
            if(creep.memory.sourceId.length >= 1){
                return true;
            }
        }
        return false;
    }

    public static getTargetId(creep: Creep): string | null {
        if( creep.memory.sourceId != null  ){
            if(creep.memory.sourceId.length === 1){
                return creep.memory.sourceId[0];  
            } else {
                for(const c of creep.memory.sourceId){
                    const source = Game.getObjectById<Source>(c);
                    if(source != null){
                        if(source.energy){
                            return source.id;
                        }
                    }
                }
            }
             
        }
        return null;
    }
}