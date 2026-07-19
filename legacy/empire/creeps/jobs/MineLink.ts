import { MineOverflow } from "./MineOverflow";

export class MineLink extends MineOverflow {

    public static run(creep: Creep): void {
        super.run(creep);
        if(creep.store.getFreeCapacity(RESOURCE_ENERGY) <= creep.getActiveBodyparts(WORK) * 4){
            if(creep.memory.linkId != null){
                const link = Game.getObjectById<StructureLink>(creep.memory.linkId);
                if(link != null){
                    if(creep.pos.inRangeTo(link,1)){
                        if(link.store.getFreeCapacity(RESOURCE_ENERGY) > 0){
                            creep.transfer(link,RESOURCE_ENERGY);
                        }
                    } else {
                        creep.travelTo(link);
                    } 
                } else {
                    this.cancel(creep);
                }
            } else {
                this.cancel(creep);
            }
        }
    }




    public static runCondition(creep: Creep): boolean {
        if(creep.memory.linkId != null){
            const container = Game.getObjectById<StructureLink>(creep.memory.linkId);
            if(container != null){
                return true;
            } else {
                delete creep.memory.linkId;
            }
        } else {
            if(creep.memory.sourceId != null){
                const sourceId = this.getTargetId(creep);
                if(sourceId != null){
                    const source = Game.getObjectById<Source>(sourceId);
                    if(source != null){
                        const links = source.pos.findInRange(FIND_STRUCTURES,2).filter( str => str.structureType === STRUCTURE_LINK);
                        if( links.length > 0){
                            const link = links.pop();
                            if( link != null){
                                creep.memory.linkId = link.id;
                                return true;
                            }
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