import { Job } from "./Job";

export class PlaceMiningContainer extends Job {
    public static run(creep: Creep): void {
        super.run(creep);
        const source: Source | null = Game.getObjectById(creep.memory.targetId);
        if( source !== null ){       
            if(creep.pos.inRangeTo(source,1)) {
                creep.pos.createConstructionSite(STRUCTURE_CONTAINER);
                this.cancel(creep);
            }else{
                creep.travelTo(source, {ignoreCreeps: false, range: 1});
            }
        } else {
            this.cancel(creep);
        }
    }


    public static runCondition(creep: Creep): boolean {
        if( creep.memory.sourceId != null && creep.memory.containerId == null){
            return true;
        }
        return false;
    }

    public static getTargetId(creep: Creep): string | null {
        return creep.memory.sourceId;
    }
}