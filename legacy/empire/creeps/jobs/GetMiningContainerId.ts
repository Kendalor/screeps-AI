import { Job } from "./Job";

export class GetMiningContainerId extends Job {

    public static run(creep: Creep): void {
        if(creep.memory.containerId == null ){
            if(creep.memory.sourceId != null){
                const source: Source | null = Game.getObjectById<Source>(creep.memory.sourceId);
                if(source != null){
                    const newContainer = creep.room.find(FIND_STRUCTURES).filter(str => str.structureType === STRUCTURE_CONTAINER).filter( str => str.pos.inRangeTo(source.pos.x, source.pos.y, 1));
                    if(newContainer.length === 1){
                        const c = newContainer.pop();
                        if(c != null){
                            creep.memory.containerId = c.id;
                            this.cancel(creep);
                        }
                    } else if (newContainer.length === 2){
                        const otherSources = creep.room.find(FIND_SOURCES).filter( s => s.id !== creep.memory.sourceId);
                        if( otherSources.length > 0){
                            const otherSource = otherSources.pop();
                            if(otherSource != null){
                                const otherContainers = otherSource.pos.findInRange(FIND_STRUCTURES,1).filter( str => str.structureType === STRUCTURE_CONTAINER);
                                if( otherContainers.length > 0 ) {
                                    const otherContainer = otherContainers.pop();
                                    if(otherContainer != null) {
                                        const finalContainer = newContainer.filter( c => c.id !== otherContainer.id);
                                        if( finalContainer.length > 0){
                                            const c = finalContainer.pop();
                                            if(c != null){
                                                creep.memory.containerId = c.id;
                                                this.cancel(creep);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    } else {
                        this.cancel(creep);
                    }
                }
            }
        } else {
            this.cancel(creep);
        }
    }

    public static runCondition(creep: Creep): boolean {
        if(creep.memory.sourceId != null && creep.memory.containerId == null){
            const source: Source | null = Game.getObjectById<Source>(creep.memory.sourceId);
            if(source != null){
                return true;
            } 
         }
        return false;
    }

    public static getTargetId(creep: Creep): string | null {
        return creep.memory.sourceId; // Anything not null ?!
    }
}