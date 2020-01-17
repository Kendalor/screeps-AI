import { Job } from "./Job";

export class PickupStorage extends Job {
    public static run(creep: Creep): void {
        super.run(creep);
        // RUN CODE
        const container: StructureStorage | null = Game.getObjectById(creep.memory.targetId);
        if(container !== null && creep.carry.energy < creep.carryCapacity && container.store.energy > 0){
            if (creep.pos.inRangeTo(container,1)){
                if(container.store.energy >= creep.carryCapacity-creep.carry.energy ){
                    creep.withdraw(container,RESOURCE_ENERGY);
                } else {
                    this.cancel(creep);
                }
            }else{
                creep.travelTo(container);
            }
        // CANCEL CONDITION
        } else {
            this.cancel(creep);
        }
    }

    public static runCondition(creep: Creep): boolean {
        return creep.carry.energy < creep.carryCapacity;
    }

    public static getTargetId(creep: Creep): string | null {
        if(creep.memory.storageId){
            return creep.memory.storageId;
        } else {
            if( creep.room.storage != null && creep.room.storage.store.energy > 0 ){
                return creep.room.storage.id;
            }
        }
        return null;
    }
}