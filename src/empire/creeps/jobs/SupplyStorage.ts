import { Job } from "./Job";

export class SupplyStorage extends Job {
    public static run(creep: Creep): void {
        super.run(creep);
        const target: StructureStorage | null = <StructureStorage> Game.getObjectById(creep.memory.targetId);
        // CANCEL CONDITION
        if(creep.store.getUsedCapacity() === 0 || target == null) {
            this.cancel(creep);
        // HAS TAREGT CONTAINER/STORAGE
        } else {
            if(target.store.getFreeCapacity() > 0) {
                if ( creep.pos.inRangeTo(target,1)){
                    if(creep.store.getUsedCapacity() > 0) {
                        for(const type in creep.store){
                            if(creep.store.getUsedCapacity(type as ResourceConstant) > 0){
                                creep.transfer(target,type as ResourceConstant);
                            }
                        }
                    } else {
                        this.cancel(creep);
                    }
                }else{
                    creep.travelTo(target, {ignoreCreeps: false});
                }
            } else {
                this.cancel(creep);
            }
        }
    }

    public static runCondition(creep: Creep): boolean {
        if(creep.store.getUsedCapacity() >  0 ){
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