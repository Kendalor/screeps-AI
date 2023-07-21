import { Job } from "./Job";

export class MineMineral extends Job {

    public static run(creep: Creep): void {
        if(creep.memory.containerId != null ){
            const container: StructureContainer | null = Game.getObjectById<StructureContainer>(creep.memory.containerId);
            if(container != null ){
                if(creep.pos.inRangeTo(container,0)) {
                    const extractor = Game.getObjectById<StructureExtractor>(creep.memory.extractorId);
                    if(extractor != null){
                        if(extractor.isActive()){
                            if(extractor.cooldown === 0){
                                const target = Game.getObjectById<Mineral>(creep.memory.targetId);
                                if(target != null){
                                    if(target.mineralAmount > 0){
                                        creep.harvest(target);
                                    }
                                }
                            }
                        }
                    }
                } else{
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
            if(creep.memory.extractorId != null){
                const source = Game.getObjectById<StructureExtractor>(creep.memory.extractorId);
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
        const mineralId = creep.room.find(FIND_MINERALS)[0].id;
        console.log("MineMineral Target: " + mineralId);
        return mineralId;
    }
}