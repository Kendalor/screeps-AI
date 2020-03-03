import { Job } from "./Job";

export class SupplyTerminal extends Job {
    public static run(creep: Creep): void {
        super.run(creep);
        const target: StructureTerminal | null = Game.getObjectById(creep.memory.targetId);
        // CANCEL CONDITION
        if(creep.store.getUsedCapacity() === 0 || target == null) {
            this.cancel(creep);
        // HAS TAREGT CONTAINER/STORAGE
        } else {
            if(target.store.getFreeCapacity() > 0) {
                if ( creep.pos.inRangeTo(target,1)){
                    if(creep.store.getUsedCapacity() > 0) {
                        for(const type in creep.store){
                            if(creep.store.getUsedCapacity(type as ResourceConstant) > 0){
                                creep.transfer(target,type as ResourceConstant);
                            }
                        }
                    } else {
                        this.cancel(creep);
                    }
                }else{
                    creep.travelTo(target);
                }
            } else {
                this.cancel(creep);
            }
        }
    }

    public static runCondition(creep: Creep): boolean {
        if(creep.store.getUsedCapacity() >0){
            let amount =0;
            for(const type in creep.store){
                if(type !== RESOURCE_ENERGY){
                    if(creep.store.getUsedCapacity(type as ResourceConstant) > 0){
                        amount = amount + creep.store.getUsedCapacity(type as ResourceConstant);
                    }
                }
            }
            return amount>0;
        }
        return false
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