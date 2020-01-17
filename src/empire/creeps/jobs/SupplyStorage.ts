import { Job } from "./Job";

export class SupplyStorage extends Job {
    public static run(creep: Creep): void {
        super.run(creep);
        const target: StructureStorage | null = Game.getObjectById(creep.memory.targetId);
        // CANCEL CONDITION
        if(creep.carry.energy === 0 || target === null || target === undefined ) {
            this.cancel(creep);
        // HAS TAREGT CONTAINER/STORAGE
        } else {
            if(target.store.energy < target.storeCapacity) {
                if ( creep.pos.inRangeTo(target,1)){
                    creep.transfer(target, RESOURCE_ENERGY);
                }else{
                    creep.travelTo(target, {ignoreCreeps: false});
                }
            } else {
                this.cancel(creep);
            }
        }
    }

    public static runCondition(creep: Creep): boolean {
        if(creep.carry.energy === creep.carryCapacity ){
            return true;
        }
        return false;
    }

    public static getTargetId(creep: Creep): string | null {
        if(creep.memory.storageId){
            return creep.memory.storageId;
        } else {
            const storage: StructureStorage | undefined = creep.room.storage;
            if (storage !== undefined ) {
                return storage.id;
            }
        }
        return null;
    }
}