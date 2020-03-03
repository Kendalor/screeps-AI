import { Job } from "./Job";

export class DeliverToHomeRoom extends Job {
    public static run(creep: Creep): void {
        super.run(creep);
        const target: StructureStorage | null = Game.getObjectById(creep.memory.targetId);
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
                    creep.travelTo(target);
                }
            } else {
                this.cancel(creep);
            }
        }
    }

    public static runCondition(creep: Creep): boolean {
        if(creep.store.getFreeCapacity() ===  0 ){
            return true;
        } else if(creep.ticksToLive != null && creep.ticksToLive <120){
            return true;
        }else if(creep.store.getUsedCapacity() > 0){
            if(creep.memory.usedCap == null){
                creep.memory.usedCap = creep.store.getUsedCapacity();
            } else {
                if(creep.memory.usedCap === creep.store.getUsedCapacity()){
                    if(creep.memory.usedCapCounter == null){
                        creep.memory.usedCapCounter = 1;
                    } else {
                        creep.memory.usedCapCounter = creep.memory.usedCapCounter +1;
                    }
                } else {
                    creep.memory.usedCapCounter = 1;
                }
            }
            if(creep.memory.usedCapCounter > 100){
                return true;
            }
        }
        return false;
    }

    public static getTargetId(creep: Creep): string | null {
        if(creep.memory.storageId){
            return creep.memory.storageId;
        } else {
            const homeRoom = Game.rooms[creep.memory.homeRoom];
            if(homeRoom != null){
                if(homeRoom.storage != null){
                    return homeRoom.storage.id;
                }
            }
        }
        return null;
    }
}