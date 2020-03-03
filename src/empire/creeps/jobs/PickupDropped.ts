import { Job } from "./Job";

export class PickupDropped extends Job {
    public static run(creep: Creep): void {
        super.run(creep);
        // RUN CODE
        const res: Resource | null = Game.getObjectById(creep.memory.targetId);
        if(res != null && creep.store.getFreeCapacity() > 0){
            if (creep.pos.inRangeTo(res,1)){
                creep.pickup(res);
            }else{
                creep.travelTo(res);
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
        const resources = creep.room.find(FIND_DROPPED_RESOURCES);
        if(resources.length > 0){
            const rareStuff = resources.filter( res => res.resourceType !== RESOURCE_ENERGY).pop();
            if(rareStuff != null){
                return rareStuff.id;
            }
            const energy = resources.filter(
            (res) => 
            res.amount >= creep.carryCapacity/2 && res.pos.findPathTo(creep).length < res.amount/4
            ).pop();
            if(energy != null){
                return energy.id;
            }

        }
        return null;
    }
}