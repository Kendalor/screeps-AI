import { Job } from "./Job";

export class LogisticJob extends Job {
    public static run(creep: Creep): void {
        if(!creep.spawning){
            super.run(creep);
            // RUN CODE
            const container: StructureTerminal | null = Game.getObjectById(creep.memory.targetId);
            if(container !== null && creep.carry.energy < creep.carryCapacity){
                if (creep.pos.inRangeTo(container,1)){
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

    }

    public static runCondition(creep: Creep): boolean {
        return true;
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