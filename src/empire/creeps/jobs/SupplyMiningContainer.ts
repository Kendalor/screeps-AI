import { SupplyContainer } from "./SupplyContainer";

export class SupplyMiningContainer extends SupplyContainer {

    public static getTargetId(creep: Creep): string | null {
        if ( creep.memory.conatinerId !== null && creep.memory.containerId !== undefined) {
            console.log("Returning containerId froM memory: " + creep.memory.containerId);
            return creep.memory.containerId;
        } else {
            const source:  Source | null = Game.getObjectById(creep.memory.sourceId);
            if( source != null ){
                const containers: StructureContainer[]  = creep.room.find(FIND_STRUCTURES).filter(
                    (str) => str.structureType === STRUCTURE_CONTAINER && str.pos.inRangeTo(source.pos.x,source.pos.y , 1)
                ) as StructureContainer[];
                if(containers.length > 0){
                    const container = containers.pop();
                    if(container != null ){
                        creep.memory.containerId = container.id;
                        creep.memory.pos_x = container.pos.x;
                        creep.memory.pos_y = container.pos.y;
                        return container.id;
                    }
                }
            }
        return null;
        }
    }

    public static run(creep: Creep): void {
        super.run(creep);
        const container: StructureContainer | null  = Game.getObjectById(creep.memory.targetId);
        if ( container != null) {
            if(creep.pos === container.pos){
                creep.drop(RESOURCE_ENERGY);
            } else {
                super.run(creep);
            }
        }
    }
}