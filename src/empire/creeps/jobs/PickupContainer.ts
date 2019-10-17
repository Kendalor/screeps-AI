import { Job } from "./Job";

export class PickupContainer extends Job {
    public static run(creep: Creep): void {
        super.run(creep);
        // RUN CODE
        const container: StructureContainer | null = Game.getObjectById(creep.memory.targetId);
        if(container !== null && creep.carry.energy < creep.carryCapacity){
            if (creep.pos.inRangeTo(container,1)){
                if(container.store.energy >= creep.carryCapacity-creep.carry.energy ){
                    creep.withdraw(container,RESOURCE_ENERGY);
                }
            }else{
                creep.moveTo(container);
            }
        // CANCEL CONDITION
        } else {
            this.cancel(creep);
        }
    }

    public static runCondition(creep: Creep): boolean {
        return creep.carry.energy <= creep.carryCapacity;
    }

    public static getTargetId(creep: Creep): string | null {
        if(creep.memory.containerId){
            return creep.memory.containerId;
        } else {
            const containers: StructureContainer[] = creep.room.find(FIND_STRUCTURES).filter(
                (str) => str.structureType === STRUCTURE_CONTAINER && 
                str.store.energy > creep.carryCapacity
            ) as StructureContainer[];
            if ( containers.length > 0 && containers !== null ){
                const container = containers.sort((str1: StructureContainer, str2: StructureContainer) => str1.store.energy - str2.store.energy).pop();
                if(container !== null && container !== undefined ){
                    return container.id;
                }
            }
        }
        return null;
    }
}