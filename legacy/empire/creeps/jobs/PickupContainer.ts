import { Job } from "./Job";

export class PickupContainer extends Job {
    public static run(creep: Creep): void {
        super.run(creep);
        // RUN CODE
        const container: StructureContainer | null =  <StructureContainer> Game.getObjectById(creep.memory.targetId);
        if(container !== null && creep.store.getFreeCapacity() > 0){
            if (creep.pos.inRangeTo(container,1)){
                // Grab Everything
                if(container.store.getUsedCapacity() > 0) {
                    for(const type in container.store){
                        if(container.store.getUsedCapacity(type as ResourceConstant) > 0){
                            creep.withdraw(container,type as ResourceConstant);
                        }
                    }
                } else {
                    this.cancel(creep);
                }
            }else{
                creep.travelTo(container, {ignoreCreeps: false});
            }
        // CANCEL CONDITION
        } else {
            this.cancel(creep);
        }
    }

    public static runCondition(creep: Creep): boolean {
        return creep.store.getFreeCapacity() > 0;
    }

    public static getTargetId(creep: Creep): string | null {
        const containers: StructureContainer[] = creep.room.find(FIND_STRUCTURES).filter(
            (str) => str.structureType === STRUCTURE_CONTAINER && 
            str.store.getUsedCapacity() > 0
        ) as StructureContainer[];
        if ( containers.length > 0 && containers != null ){
            const container = containers.sort((str1: StructureContainer, str2: StructureContainer) => str1.store.getUsedCapacity() - str2.store.getUsedCapacity()).pop();
            if(container != null ){
                return container.id;
            }
        }

        return null;
    }
}