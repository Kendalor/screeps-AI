import { MineOverflow } from "./MineOverflow";

export class MineContainer extends MineOverflow {

    public static run(creep: Creep): void {
        if(creep.memory.containerId != null ){
            const container: StructureContainer | null = <StructureContainer> Game.getObjectById(creep.memory.containerId);
            if(container != null ){
                if(creep.pos.inRangeTo(container,0)) {
                    super.run(creep);
                }else{
                    creep.travelTo(container);
                }  
            } else {
                this.cancel(creep);
            }
        } else {
            this.cancel(creep);
        }
    }

    public static runCondition(creep: Creep): boolean {
        if(creep.memory.containerId != null){
            const container: StructureContainer | null = Game.getObjectById<StructureContainer>(creep.memory.containerId);
            if(container != null){
                return true;
            } 
        } else {
            if(creep.memory.sourceId != null){
                const source = Game.getObjectById<Source>(creep.memory.sourceId);
                if(source != null){
                    const containers = source.pos.findInRange(FIND_STRUCTURES,1).filter( str => str.structureType === STRUCTURE_CONTAINER);
                    if( containers.length > 0){
                        const container = containers.pop();
                        if( container != null){
                            creep.memory.containerId = container.id;
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