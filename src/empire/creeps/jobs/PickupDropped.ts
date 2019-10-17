import { Job } from "./Job";

export class PickupDropped extends Job {
    public static run(creep: Creep): void {
        super.run(creep);
        // RUN CODE
        const res: Resource | null = Game.getObjectById(creep.memory.targetId);
        if(res !== null && creep.carry.energy < creep.carryCapacity){
            if (creep.pos.inRangeTo(res,1)){
                creep.pickup(res);
            }else{
                creep.moveTo(res);
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
        const resources = creep.room.find(FIND_DROPPED_RESOURCES).filter(
            (res) => res.resourceType === RESOURCE_ENERGY &&
            res.amount >= creep.carryCapacity/2 && res.pos.findPathTo(creep).length < res.amount/4
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