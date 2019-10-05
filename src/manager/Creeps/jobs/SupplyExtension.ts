import { Job } from "./Job";

export class SupplyExtension extends Job {
    public static run(creep: Creep): void {
        super.run(creep);
        const target: StructureExtension | null = Game.getObjectById(creep.memory.targetId);
        // CANCEL CONDITION
        if(creep.carry.energy === 0 || target === null || target === undefined ) {
            this.cancel(creep);
        // HAS TAREGT CONTAINER/STORAGE
        } else {
            if(target.energy < target.energyCapacity) {
                if ( creep.inRangeTo(target,1)){
                    creep.transfer(target, RESOURCE_ENERGY);
                }else{
                    creep.moveTo(target);
                }
            } else {
                this.cancel(creep);
            }
        }
    }

    public static runCondition(creep: Creep): boolean {
        if(creep.carry.energy > 0 ){
            return true;
        }
        return false;
    }

    public static getTargetId(creep: Creep): string | null {
        const extensions: StructureExtension[]  = creep.room.find(FIND_STRUCTURES).filter( (str) => str.structureType === STRUCTURE_EXTENSION && str.energy < str.energyCapacity) as StructureExtension[];
        if(extensions.length !== 0) {
            const extension: StructureExtension | null = creep.pos.findClosestByPath(extensions);
            if (extension !== null) {
                return extension.id;
            }
        }
        return null;
    }
}