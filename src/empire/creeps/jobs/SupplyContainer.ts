import { Job } from "./Job";

export class SupplyContainer extends Job {

    public static run(creep: Creep): void {
        super.run(creep);
        const target: StructureContainer | null = Game.getObjectById(creep.memory.targetId);
        // CANCEL CONDITION
        if(creep.carry.energy === 0 || target === null ) {
            this.cancel(creep);
        // HAS TAREGT CONTAINER/STORAGE
        } else {
            if(target.store.energy < target.storeCapacity) {
                if ( creep.pos.inRangeTo(target,1)){
                    creep.transfer(target, RESOURCE_ENERGY);
                }else{
                    creep.moveTo(target);
                }
            } else {
                this.cancel(creep);
            }
        }
    }

    public static runCondition(creep: Creep): boolean {
        if(creep.carry.energy > 0 ){
            return true;
        }
        return false;
    }

    public static getTargetId(creep: Creep): string | null {
        const containers: StructureContainer[]  = creep.room.find(FIND_STRUCTURES).filter( (str) => str.structureType === STRUCTURE_CONTAINER && str.store.energy < str.storeCapacity) as StructureContainer[];
        if(containers.length !== 0) {
            const container: StructureContainer | null = creep.pos.findClosestByPath(containers);
            if (container !== null) {
                return container.id;
            }
        }
        return null;
        
    }
}