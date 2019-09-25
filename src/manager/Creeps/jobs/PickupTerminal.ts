import { Job } from "./Job";

export class PickupTerminal extends Job {
    public static run(creep: Creep): void {
        // RUN CODE
        const container: StructureTerminal | null = Game.getObjectById(creep.memory.targetId);
        if(container !== null && creep.carry.energy < creep.carryCapacity){
            if (creep.inRangeTo(container,1)){
                if(container.store.energy >= creep.carryCapacity-creep.carry.energy ){
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
        return this.getTargetId(creep) !== null  && creep.carry.energy <= creep.carryCapacity;
    }

    public static getTargetId(creep: Creep): string | null {
        if(creep.memory.terminal){
            return creep.memory.terminalId;
        } else {
            if( creep.room.terminal !== undefined ){
                return creep.room.terminal.id
            }
        }
        return null;
    }
}