import { Job } from "./Job";


export class Salvage extends Job{

    public static run(creep: Creep): void {
        super.run(creep);
        // RUN PART
        if(creep.memory.job === 'Salvage' && creep.memory.targetId){
            const salvage : Resource | null = Game.getObjectById<Resource>(creep.memory.targetId);
            if (salvage != null){
                if(creep.pos.inRangeTo(salvage,1)){
                    creep.pickup(salvage);
                }else{
                    creep.travelTo(salvage);
                }
            }
            else{
                delete creep.memory.targetId;
            }
        }
        // CANCEL CONDITION
        if(creep.memory.job === 'Salvage' && (creep.room.memory.underAttack === true || !creep.memory.targetId || creep.carry.energy > 0)){
            this.cancel(creep);
        }
    }

    public static runCondition(creep: Creep): boolean {
        return (creep.room.memory.underAttack === undefined || creep.room.memory.underAttack === false) && creep.carry.energy <= creep.carryCapacity/2;
    }

    public static getTargetId(creep: Creep): string | null {
        const salvage = creep.pos.findClosestByPath(creep.room.find(FIND_TOMBSTONES), {filter: (s: Tombstone) => 
            s.creep.carry.energy > 100 &&
             creep.room.name === s.pos.roomName
             });
        if (salvage !== null){
            return salvage.id;
        }
        return null;
    }
}