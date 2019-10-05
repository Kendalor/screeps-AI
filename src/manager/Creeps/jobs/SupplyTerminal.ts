import { Job } from "./Job";

export class SupplyTerminal extends Job {
    public static run(creep: Creep): void {
        super.run(creep);
        const target: StructureTerminal | null = Game.getObjectById(creep.memory.targetId);
        // CANCEL CONDITION
        if(creep.carry.energy === 0 || target === null || target === undefined ) {
            this.cancel(creep);
        // HAS TAREGT CONTAINER/STORAGE
        } else {
            if(target.store.energy < target.storeCapacity) {
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
        const terminals: StructureTerminal[]  = creep.room.find(FIND_STRUCTURES).filter( (str) => str.structureType === STRUCTURE_TERMINAL) as StructureTerminal[];
        if(terminals.length !== 0) {
            const terminal: StructureTerminal | null = creep.pos.findClosestByPath(terminals);
            if (terminal !== null) {
                return terminal.id;
            }
        }
        return null;
    }
}