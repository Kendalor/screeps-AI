import { Job } from "./Job";


export class PickupControllerLink extends Job {
    public static run(creep: Creep): void {
        super.run(creep);
        // RUN CODE
        const container: StructureLink | null = Game.getObjectById(creep.memory.targetId);
        if(container !== null && creep.carry.energy < creep.carryCapacity){
            if (creep.pos.inRangeTo(container,1)){
                if(container.store.energy > 0 ){
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
        if(creep.memory.link){
            const link: StructureLink = Game.getObjectById(creep.memory.link) as StructureLink; 
            if(link != null){
                if(link.store.energy > 0){
                    return creep.memory.link;
                }
            } else {
                delete creep.memory.link;
            }
        } else {
            if(creep.room.controller != null){
                const links = creep.room.controller.pos.findInRange(FIND_MY_STRUCTURES,3).filter( str => str.structureType === STRUCTURE_LINK);
                if(links != null){
                    if(links.length > 0){
                        const link = links.pop();
                        if(link != null){
                            creep.memory.link = link.id;
                            return creep.memory.link;
                        }
                    }
                }
            }

        }
        return null;
    }
}