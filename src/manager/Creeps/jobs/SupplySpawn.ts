import { Job } from "./Job";

export class SupplySpawn extends Job {
    public static run(creep: Creep): void {
        super.run(creep);
        const target: StructureSpawn | null = Game.getObjectById(creep.memory.targetId);
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
        const spawns: StructureSpawn[]  = creep.room.find(FIND_MY_SPAWNS).filter( (str) => str.structureType === STRUCTURE_SPAWN) as StructureSpawn[];
        if(spawns.length !== 0) {
            const spawn: StructureSpawn | null = creep.pos.findClosestByPath(spawns);
            if (spawn !== null) {
                return spawn.id;
            }
        }
        return null;
    }
}