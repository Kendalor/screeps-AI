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
            if ( creep.pos.inRangeTo(target,0) && target.store.energy < target.storeCapacity){
                creep.drop(RESOURCE_ENERGY);
            }else{
                creep.moveTo(target);
            }
        }
    }

    public static runCondition(creep: Creep): boolean {
        console.log("Run Condition for SupplyContainer: " + String(creep.carry.energy > 0) + " " + String(this.getTargetId(creep) !== null));
        if(creep.carry.energy > 0 ){
            return true;
        }
        return false;
    }

    public static getTargetId(creep: Creep): string | null {
        if ( creep.memory.conatinerId !== null && creep.memory.containerId !== undefined) {
            console.log("Returning containerId froM memory: " + creep.memory.containerId);
            return creep.memory.containerId;
        } else {
            const containers: StructureContainer[]  = creep.room.find(FIND_STRUCTURES).filter( (str) => str.structureType === STRUCTURE_CONTAINER && str.pos.isNearTo(creep.pos) && str.store.energy < str.storeCapacity) as StructureContainer[];
            if(containers.length !== 0) {
                const container: StructureContainer | null = creep.pos.findClosestByPath(containers);
                if (container !== null) {
                    console.log("Return Code Contaier Id: " + container.id);
                    return container.id;
                }
            }
        return null;
        }
    }
}