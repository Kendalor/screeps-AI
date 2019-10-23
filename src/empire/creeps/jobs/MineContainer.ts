import { Mine } from "./Mine";

export class MineContainer extends Mine {

    public static run(creep: Creep): void {
        // SETUP HAS SOURCE ID, HAS CONTAINER ID
        if(creep.memory.containerId != null ){
            const container: StructureContainer | null = Game.getObjectById(creep.memory.containerId);
            if(container != null ){
                if(creep.memory.sourceId != null){
                    const source: Source | null = Game.getObjectById(creep.memory.sourceId);
                    if( source != null && source.energy > 0){
                        if(creep.pos.inRangeTo(container,0)) {
                            if (source.energy > 0){
                                creep.harvest(source);
                            }
                        }else{
                            creep.moveTo(container);
                        }  
                    }
                } else {
                    this.cancel(creep);
                }   
            } else {
                this.cancel(creep);
            }
        } else {
            this.cancel(creep);
        }
    }

    public static runCondition(creep: Creep): boolean {
        console.log("MIne condition for RunContaienr");
        if(creep.memory.containerId != null){
            const container: StructureContainer | null = Game.getObjectById(creep.memory.containerId);
            if(container != null){
                return true;
            } 
        }else {
            if(creep.memory.sourceId != null){
                const source: Source | null = Game.getObjectById(creep.memory.sourceId);
                if(source != null){
                    const newContainer = creep.room.find(FIND_STRUCTURES).filter(str => str.structureType === STRUCTURE_CONTAINER).filter( str => str.pos.inRangeTo(source.pos.x, source.pos.y, 1));
                    if(newContainer.length === 1){
                        const c = newContainer.pop();
                        if(c != null){
                            creep.memory.containerId = c.id;
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    }

    public static getTargetId(creep: Creep): string | null {
        return super.getTargetId(creep);
    }
}