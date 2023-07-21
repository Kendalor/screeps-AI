import { Job } from "./Job";

export class PickupTombstone extends Job {
    public static run(creep: Creep): void {
        super.run(creep);
        // RUN CODE
        const tombstone: Tombstone | null =  <Tombstone> Game.getObjectById(creep.memory.targetId);
        if(tombstone != null && creep.store.getFreeCapacity() >0){
            if(tombstone.store.getUsedCapacity() > 0){
                if (creep.pos.inRangeTo(tombstone,1)){
                    for(const type in tombstone.store){
                        if(tombstone.store.getUsedCapacity(type as ResourceConstant) > 0){
                            console.log("Withdraw: " + type);
                            creep.withdraw(tombstone,type as ResourceConstant);
                        }
                    }
                }else{
                    creep.travelTo(tombstone);
                }
            } else {
                this.cancel(creep);
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
        const resources = creep.room.find(FIND_TOMBSTONES).filter(
            (res) => res.store.getUsedCapacity() >= 100 && res.pos.findPathTo(creep).length < res.store.getUsedCapacity()/4
        );
        if (resources.length !== 0){
            const resource = creep.pos.findClosestByPath(resources);
            if(resource !== null && resource !== undefined) {
                return resource.id;
            }
        }
        return null;
    }
}