import { Job } from "./Job";

export class PickupTombstone extends Job {
    public static run(creep: Creep): void {
        super.run(creep);
        // RUN CODE
        const tombstone: Tombstone | null = Game.getObjectById(creep.memory.targetId);
        if(tombstone !== null && creep.carry.energy < creep.carryCapacity){
            if(tombstone.store.energy > 0){
                if (creep.inRangeTo(tombstone,1)){
                    creep.withdraw(tombstone,RESOURCE_ENERGY);
                }else{
                    creep.moveTo(tombstone);
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
        return creep.carry.energy <= creep.carryCapacity;
    }

    public static getTargetId(creep: Creep): string | null {
        const resources = creep.room.find(FIND_TOMBSTONES).filter(
            (res) => res.store.energy >= 100 && res.pos.findPathTo(creep).length < res.store.energy/4
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