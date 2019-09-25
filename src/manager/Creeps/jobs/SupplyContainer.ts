import { Job } from "./Job";

class SupplyContainer extends Job {

    public static run(creep: Creep): void {
        const target: StructureContainer | null = Game.getObjectById(creep.memory.targetId);
        // CANCEL CONDITION
        if(creep.carry.energy === 0 || target === null ) {
            this.cancel(creep);
        // HAS TAREGT CONTAINER/STORAGE
        } else {
            if ( creep.inRangeTo(target,1)){
                creep.transfer(target, RESOURCE_ENERGY);
            }else{
                creep.moveTo(target);
            }
        }
    }

    public static runCondition(creep: Creep): boolean {
        if(creep.carry.energy > 0 && this.getTargetId(creep) !== null){
            return true;
        }
        return false;
    }

    public static getTargetId(creep: Creep): string | null {
        if ( creep.memory.conatinerId !== null) {
            return creep.memory.containerId;
        } else {
            const containers: StructureContainer[]  = creep.room.find(FIND_STRUCTURES).filter( (str) => str.structureType === STRUCTURE_CONTAINER) as StructureContainer[];
            if(containers.length !== 0) {
                const container: StructureContainer | null = creep.pos.findClosestByPath(containers);
                if (container !== null) {
                    return container.id;
                }
            }
        return null;
        }
    }
}