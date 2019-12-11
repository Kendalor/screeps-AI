import { Job } from "./Job";

export class PickupExtension extends Job {
    public static run(creep: Creep): void {
        super.run(creep);
        // RUN CODE
        const container: StructureExtension | null = Game.getObjectById(creep.memory.targetId);
        if(container !== null && creep.carry.energy < creep.carryCapacity){
            if (creep.pos.inRangeTo(container,1)){
                if(container.energy === container.energyCapacity ){
                    creep.withdraw(container,RESOURCE_ENERGY);
                } else {
                    this.cancel(creep);
                }
            }else{
                creep.moveTo(container, {ignoreCreeps: false});
            }
        // CANCEL CONDITION
        } else {
            this.cancel(creep);
        }
    }

    public static runCondition(creep: Creep): boolean {
        console.log("Checking Target Condition PickupExtension");
        return creep.carry.energy < creep.carryCapacity;
    }

    public static getTargetId(creep: Creep): string | null {
        console.log("Checking Target Condition PickupExtension");
        if(creep.memory.targetId){
            return creep.memory.targetId;
        } else {
            const extensions: StructureExtension[] = creep.room.find(FIND_STRUCTURES).filter(
                (str) => str.structureType === STRUCTURE_EXTENSION && 
                str.energy > 0
            ) as StructureExtension[];
            if ( extensions.length > 0 && extensions !== null ){
                const extension = creep.pos.findClosestByPath(extensions);
                if(extension !== null && extension !== undefined ){
                    return extension.id;
                }
            }
        }
        return null;
    }
}